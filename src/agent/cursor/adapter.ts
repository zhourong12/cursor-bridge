import { Agent, Cursor, SqliteLocalAgentStore } from '@cursor/sdk';
import type {
  AgentOptions,
  ListAgentsOptions,
  ListResult,
  ModelSelection,
  Run,
  RunResult,
  SDKAgent,
  SDKAgentInfo,
  SDKMessage,
} from '@cursor/sdk';

import { log } from '../../core/logger';
import { prefixBridgeSystemPrompt } from '../bridge-system-prompt';
import { AgentPreflightError, type AgentAvailability } from '../preflight';
import type {
  AgentAdapter,
  AgentBotIdentity,
  AgentEvent,
  AgentRun,
  AgentRunOptions,
} from '../types';
import { loadAlwaysApplyCursorRules } from './rules';
import {
  isActiveRunConflict,
  releaseAgentRunLockIfTerminal,
  sendWithActiveRunRetry,
} from './stale-run-cleanup';

const DEFAULT_CURSOR_MODEL = 'default';
const RUN_POLL_MS = 100;
const RUN_POLL_MAX_MS = 30_000;
const MAX_RUN_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 3000;

export type CursorAgentCreate = (options: AgentOptions) => Promise<SDKAgent>;
export type CursorAgentResume = (agentId: string, options?: Partial<AgentOptions>) => Promise<SDKAgent>;
export type CursorAgentList = (options?: ListAgentsOptions) => Promise<ListResult<SDKAgentInfo>>;
export type CursorRulesLoader = (cwd: string) => Promise<string | undefined>;
export interface CursorAdapterEnv {
  CURSOR_API_KEY?: string;
  CURSOR_RUNTIME?: string;
  CURSOR_MACHINE_NAME?: string;
  CURSOR_MACHINE_DIRECTORY?: string;
}

export interface CursorAdapterOptions {
  apiKey?: string;
  model?: string | ModelSelection;
  createAgent?: CursorAgentCreate;
  resumeAgent?: CursorAgentResume;
  listAgents?: CursorAgentList;
  loadRules?: CursorRulesLoader;
  env?: CursorAdapterEnv;
}

export class CursorAdapter implements AgentAdapter {
  readonly id = 'cursor';
  readonly displayName = 'Cursor Agent';

  private readonly apiKey: string | undefined;
  private model: string | ModelSelection | undefined;
  private readonly createAgent: CursorAgentCreate;
  private readonly resumeAgent: CursorAgentResume;
  private readonly listAgents: CursorAgentList;
  private readonly loadRules: CursorRulesLoader;
  private readonly env: CursorAdapterEnv;
  private botIdentity: AgentBotIdentity | undefined;

  constructor(opts: CursorAdapterOptions = {}) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.createAgent = opts.createAgent ?? Agent.create;
    this.resumeAgent = opts.resumeAgent ?? Agent.resume;
    this.listAgents = opts.listAgents ?? Agent.list;
    this.loadRules = opts.loadRules ?? loadAlwaysApplyCursorRules;
    this.env = opts.env ?? process.env;
  }

  setBotIdentity(identity: AgentBotIdentity): void {
    this.botIdentity = identity;
  }

  setModel(model: string | undefined): void {
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).ok;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    if (this.resolveApiKey()) return { ok: true, version: '@cursor/sdk' };
    const diagnostic = {
      code: 'agent-version-check-empty-output',
      agentId: 'cursor',
      agentName: 'Cursor Agent',
      command: 'CURSOR_API_KEY',
      field: 'CURSOR_API_KEY',
      expected: 'non-empty string',
      actual: 'missing',
    } as const;
    const error = new AgentPreflightError(diagnostic, 'Cursor Agent preflight failed: missing CURSOR_API_KEY');
    return { ok: false, error, diagnostic };
  }

  async prepareRun(opts: AgentRunOptions): Promise<void> {
    if (!opts.sessionId || !opts.cwd) return;
    await releaseAgentRunLockIfTerminal(opts.sessionId, opts.cwd);
  }

  run(opts: AgentRunOptions): AgentRun {
    let activeRun: Run | undefined;
    let stopRequested = false;

    return {
      runId: opts.runId,
      events: this.createEventStream(opts, {
        setActiveRun(run) {
          activeRun = run;
        },
        shouldStop() {
          return stopRequested;
        },
      }),
      async stop() {
        stopRequested = true;
        if (activeRun?.supports('cancel')) {
          await activeRun.cancel();
        }
      },
      waitForExit(): Promise<boolean> {
        return Promise.resolve(true);
      },
    };
  }

  private async *createEventStream(
    opts: AgentRunOptions,
    runState: {
      setActiveRun(run: Run): void;
      shouldStop(): boolean;
    },
  ): AsyncGenerator<AgentEvent> {
    const apiKey = this.resolveApiKey();
    if (!opts.cwd) {
      yield terminalError('cwd is required for CursorAdapter.run');
      return;
    }
    if (!apiKey) {
      yield terminalError('CURSOR_API_KEY is required for CursorAdapter.run');
      return;
    }

    const model = await resolveModelSelection(
      apiKey,
      modelSelection(opts.model ?? this.model ?? DEFAULT_CURSOR_MODEL),
    );
    let agent: SDKAgent | undefined;
    let cwd: string | undefined;
    try {
      const target = await this.resolveAgentTarget(apiKey, model, opts);
      agent = target.agent;
      cwd = target.cwd;

      yield {
        type: 'system',
        sessionId: agent.agentId,
        cwd: target.cwd,
        model: model.id,
      };

      const projectRules = await this.loadRules(opts.cwd);
      const prompt = prefixBridgeSystemPrompt(opts.prompt, this.botIdentity, projectRules);
      const isResume = Boolean(opts.sessionId);

      const runResult = yield* this.attemptRun(agent, target.cwd, prompt, runState);

      if (runResult === 'ok') return;

      if (runResult === 'retryable' && !isResume) {
        log.warn('cursor', 'run-retry-same-agent', { agentId: agent.agentId });
        await releaseAgentRunLockIfTerminal(agent.agentId, target.cwd);
        await delay(RETRY_BACKOFF_MS);
        const retryResult = yield* this.attemptRun(agent, target.cwd, prompt, runState);
        if (retryResult !== 'ok') {
          yield terminalError('运行失败，请发 /new 开新会话后重试。');
        }
        return;
      }

      if (runResult === 'retryable' && isResume) {
        log.warn('cursor', 'run-fallback-fresh', { stalledAgent: agent.agentId, cwd: target.cwd });
        await releaseAgentRunLockIfTerminal(agent.agentId, target.cwd);
        await disposeAgent(agent);
        await delay(RETRY_BACKOFF_MS);

        const freshAgent = await this.createAgent({ apiKey, model, local: { cwd: target.cwd } });
        agent = freshAgent;
        yield { type: 'system', sessionId: freshAgent.agentId, cwd: target.cwd, model: model.id };

        const freshResult = yield* this.attemptRun(freshAgent, target.cwd, prompt, runState);
        if (freshResult !== 'ok') {
          yield terminalError('新会话也运行失败，请检查 Cursor IDE 是否正常。');
        }
        return;
      }
    } catch (err) {
      yield terminalError(err instanceof Error ? err.message : String(err));
    } finally {
      if (agent && cwd) {
        await releaseAgentRunLockIfTerminal(agent.agentId, cwd);
        await disposeAgent(agent);
      }
    }
  }

  private async *attemptRun(
    agent: SDKAgent,
    cwd: string,
    prompt: string,
    runState: { setActiveRun(run: Run): void; shouldStop(): boolean },
  ): AsyncGenerator<AgentEvent, 'ok' | 'retryable' | 'fatal'> {
    let sawOutput = false;
    let run: Run | undefined;

    try {
      for await (const ev of streamLiveRun(agent, cwd, prompt, runState, (resolved) => {
        run = resolved;
      })) {
        if (ev.type === 'error') {
          if (!sawOutput && isRetryableRunError(ev.message)) return 'retryable';
          yield ev;
          return 'fatal';
        }
        if (isOutputEvent(ev)) sawOutput = true;
        yield ev;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!sawOutput && isRetryableRunError(errMsg)) return 'retryable';
      yield terminalError(formatRunFailureMessage(run?.id ?? 'unknown', undefined, errMsg));
      return 'fatal';
    }

    if (!run) return 'ok';
    const result = await run.wait();
    if (result.status !== 'error') {
      yield terminalEvent(agent.agentId, result);
      return 'ok';
    }

    const errorDetail = !result.result?.trim()
      ? await readRunErrorDetail(cwd, agent.agentId, run.id)
      : undefined;
    if (!sawOutput && isRetryableRunError(result.result?.trim() || errorDetail)) {
      return 'retryable';
    }
    yield terminalEvent(agent.agentId, result, errorDetail);
    return 'fatal';
  }

  private resolveApiKey(): string | undefined {
    const apiKey = this.apiKey ?? this.env.CURSOR_API_KEY;
    return apiKey?.trim() ? apiKey : undefined;
  }

  private async resolveAgentTarget(
    apiKey: string,
    model: ModelSelection,
    opts: AgentRunOptions,
  ): Promise<{ agent: SDKAgent; cwd: string }> {
    if (this.cursorRuntime() === 'machine') {
      const machine = this.resolveMachineTarget();
      const agentId = opts.sessionId ?? (await this.discoverMachineAgentId(apiKey, machine.ref));
      return {
        agent: await this.resumeAgent(agentId, { apiKey, model }),
        cwd: machine.ref,
      };
    }

    const agentOptions = {
      apiKey,
      model,
      local: { cwd: opts.cwd },
    } satisfies AgentOptions;
    return {
      agent: opts.sessionId
        ? await this.resumeAgent(opts.sessionId, agentOptions)
        : await this.createAgent(agentOptions),
      cwd: opts.cwd!,
    };
  }

  private cursorRuntime(): 'local' | 'machine' {
    return this.env.CURSOR_RUNTIME?.trim() === 'machine' ? 'machine' : 'local';
  }

  private resolveMachineTarget(): { ref: string } {
    const name = this.env.CURSOR_MACHINE_NAME?.trim();
    const directory = this.env.CURSOR_MACHINE_DIRECTORY?.trim();
    if (!name || !directory) {
      throw new Error('CURSOR_MACHINE_NAME and CURSOR_MACHINE_DIRECTORY are required when CURSOR_RUNTIME=machine');
    }
    return { ref: `${name}#${directory}` };
  }

  private async discoverMachineAgentId(apiKey: string, machineRef: string): Promise<string> {
    let cursor: string | undefined;
    do {
      const result = await this.listAgents({
        runtime: 'cloud',
        apiKey,
        includeArchived: false,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      const match = result.items.find(
        (item) => item.runtime === 'cloud' && item.env?.type === 'machine' && item.env.name === machineRef,
      );
      if (match) return match.agentId;
      cursor = result.nextCursor;
    } while (cursor);

    throw new Error(
      `No Cursor My Machines agent found for ${machineRef}. Open that machine directory in Cursor first, then retry.`,
    );
  }
}

async function resolveModelSelection(apiKey: string, model: ModelSelection): Promise<ModelSelection> {
  if (model.params?.length) return model;
  try {
    const models = await Cursor.models.list({ apiKey });
    const item = models.find((entry) => entry.id === model.id);
    const variant = item?.variants?.find((v) => v.isDefault) ?? item?.variants?.[0];
    if (item && variant?.params?.length) {
      return { id: item.id, params: variant.params };
    }
  } catch {
    /* keep caller selection */
  }
  return model;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForActiveLocalRun(
  agentId: string,
  cwd: string,
  sendStartedAt: number,
): Promise<Run | undefined> {
  const deadline = Date.now() + RUN_POLL_MAX_MS;
  while (Date.now() < deadline) {
    try {
      const runs = await Agent.listRuns(agentId, { runtime: 'local', cwd, limit: 10 });
      const active = runs.items
        .filter((entry) => entry.status === 'running')
        .filter((entry) => !entry.createdAt || entry.createdAt >= sendStartedAt - 1000)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
      if (active) return Agent.getRun(active.id, { runtime: 'local', cwd });
    } catch {
      /* retry until deadline */
    }
    await delay(RUN_POLL_MS);
  }
  return undefined;
}

/**
 * Cursor IDE streams thinking while the run is in flight. `agent.send()` only
 * resolves after the run finishes, so waiting on send before `run.stream()`
 * leaves Feishu stuck on the initial "thinking" footer for the whole run.
 * Poll for the active local run and attach to its stream immediately.
 */
async function* streamLiveRun(
  agent: SDKAgent,
  cwd: string,
  prompt: string,
  runState: {
    setActiveRun(run: Run): void;
    shouldStop(): boolean;
  },
  setRun: (run: Run) => void,
): AsyncGenerator<AgentEvent> {
  const sendStartedAt = Date.now();
  const sendPromise = sendWithActiveRunRetry(agent, cwd, prompt);
  let earlyRun: Run | undefined;
  let streamedEarly = false;

  try {
    earlyRun = await waitForActiveLocalRun(agent.agentId, cwd, sendStartedAt);
    if (earlyRun) {
      runState.setActiveRun(earlyRun);
      if (runState.shouldStop() && earlyRun.supports('cancel')) {
        await earlyRun.cancel();
      }
      if (earlyRun.supports('stream')) {
        streamedEarly = true;
        yield* streamRunEvents(earlyRun);
      }
    }
  } catch {
    streamedEarly = false;
  }

  let run: Run;
  try {
    run = await sendPromise;
  } catch (err) {
    if (isActiveRunConflict(err)) {
      yield terminalError(
        '会话中存在未结束的 Cursor 运行，已尝试清理仍未成功。请发 /stop 后重试；仍失败可 /new 开新会话。',
      );
      return;
    }
    yield terminalError(err instanceof Error ? err.message : String(err));
    return;
  }
  setRun(run);
  runState.setActiveRun(run);
  if (runState.shouldStop() && run.supports('cancel')) {
    await run.cancel();
  }
  if ((!streamedEarly || run.id !== earlyRun?.id) && run.supports('stream')) {
    yield* streamRunEvents(run);
  }
}

async function* streamRunEvents(run: Run): AsyncGenerator<AgentEvent> {
  if (!run.supports('stream')) return;
  for await (const message of run.stream()) {
    if (message.type === 'status' && message.status === 'ERROR') {
      // Stop streaming and let run.wait()/store surface the failure detail so
      // the retry path in createEventStream can decide whether to retry.
      return;
    }
    yield* translateSdkMessage(message);
  }
}

function* translateSdkMessage(message: SDKMessage): Generator<AgentEvent> {
  switch (message.type) {
    case 'assistant':
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text) {
          yield { type: 'text', delta: block.text };
        } else if (block.type === 'tool_use') {
          yield { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        }
      }
      return;
    case 'thinking':
      if (message.text) {
        yield { type: 'thinking', delta: message.text };
      } else if (message.thinking_duration_ms !== undefined) {
        yield { type: 'thinking_done' };
      }
      return;
    case 'task':
      if (message.text?.trim()) {
        yield { type: 'thinking', delta: message.text };
      }
      return;
    case 'tool_call':
      if (message.status === 'completed' || message.status === 'error') {
        yield {
          type: 'tool_result',
          id: message.call_id,
          output: stringifyToolResult(message.result),
          isError: message.status === 'error',
        };
      }
      return;
    case 'status':
      if (message.status === 'ERROR') {
        yield {
          type: 'error',
          message: formatRunFailureMessage(message.run_id, undefined, message.message?.trim()),
          terminationReason: 'failed',
        };
      }
      return;
    default:
      return;
  }
}

function isOutputEvent(ev: AgentEvent): boolean {
  return ev.type !== 'system' && ev.type !== 'error' && ev.type !== 'done';
}

/**
 * Retryable when there is no detail (bare ERROR) or the failure is a transport
 * stall. Only used when the attempt produced no output, so re-sending the same
 * prompt cannot duplicate visible work.
 */
function isRetryableRunError(detail?: string): boolean {
  const text = detail?.trim();
  if (!text) return true;
  return /Connection stalled|NGHTTP2_ENHANCE_YOUR_CALM|ECANCELED/i.test(text);
}

function terminalEvent(agentId: string, result: RunResult, errorDetail?: string): AgentEvent {
  switch (result.status) {
    case 'finished':
      return { type: 'done', sessionId: agentId, terminationReason: 'normal' };
    case 'cancelled':
      return { type: 'done', sessionId: agentId, terminationReason: 'interrupted' };
    case 'error':
      return {
        type: 'error',
        message: formatRunFailureMessage(result.id, result.result, errorDetail),
        terminationReason: 'failed',
      };
  }
}

function formatRunFailureMessage(
  runId: string,
  result?: string,
  errorDetail?: string,
): string {
  const detail = result?.trim() || errorDetail?.trim();
  if (detail && isActiveRunConflict(detail)) {
    return '会话中存在未结束的 Cursor 运行。请再发一次；仍失败可发 /stop 或 /new。';
  }
  if (
    detail === 'Connection stalled' ||
    /NGHTTP2_ENHANCE_YOUR_CALM|ECANCELED/.test(detail ?? '')
  ) {
    return '网络连接中断（HTTP/2 传输层错误），正在自动重试。若反复出现请发 /new 开新会话。';
  }
  if (/WritableIterable is closed/i.test(detail ?? '')) {
    return '运行因 OAuth 阻塞或长时间无输出被中断。请私聊发 `/lark-auth` 完成授权，再发 `/lark-auth done` 后重试原任务。';
  }
  if (detail) return `${detail} (run id: ${runId})`;
  return `Cursor Agent 运行失败 (run id: ${runId})，请重试`;
}

async function readRunErrorDetail(
  cwd: string,
  agentId: string,
  runId: string,
): Promise<string | undefined> {
  try {
    const store = await SqliteLocalAgentStore.open({ workspaceRef: cwd });
    try {
      const doc = await store.runs.get({ agentId, runId });
      return doc?.error?.trim() || undefined;
    } finally {
      await store.dispose();
    }
  } catch {
    return undefined;
  }
}

function terminalError(message: string): AgentEvent {
  return { type: 'error', message, terminationReason: 'failed' };
}

function modelSelection(model: string | ModelSelection): ModelSelection {
  return typeof model === 'string' ? { id: model } : model;
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined) return '';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

async function disposeAgent(agent: SDKAgent): Promise<void> {
  if (typeof agent[Symbol.asyncDispose] === 'function') {
    await agent[Symbol.asyncDispose]();
    return;
  }
  agent.close();
}
