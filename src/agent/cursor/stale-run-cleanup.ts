import { Agent, SqliteLocalAgentStore, getDefaultSdkStateRoot } from '@cursor/sdk';
import type { Run, SDKAgent } from '@cursor/sdk';

import { log } from '../../core/logger';
import { classifyCursorError } from '../../core/diagnostics';
import type { SessionCatalog } from '../../session/catalog';

const ACTIVE_RUN_CONFLICT = /already has active run/i;

export function isActiveRunConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return ACTIVE_RUN_CONFLICT.test(msg);
}

function workspaceRefs(cwd: string): string[] {
  const refs = [cwd];
  try {
    const stateRoot = getDefaultSdkStateRoot();
    if (stateRoot && stateRoot !== cwd) refs.push(stateRoot);
  } catch {
    /* optional */
  }
  return refs;
}

async function cancelRunById(
  agentId: string,
  cwd: string,
  runId: string,
  event: string,
): Promise<boolean> {
  try {
    const run = await Agent.getRun(runId, { runtime: 'local', cwd });
    if (run.supports('cancel')) {
      await run.cancel();
    }
    log.info('cursor', event, { agentId, runId, cwd });
    return true;
  } catch (err) {
    log.warn('cursor', 'stale-run-cancel-failed', {
      agentId,
      runId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function clearAgentActiveRunLock(agentId: string, workspaceRef: string): Promise<boolean> {
  try {
    const store = await SqliteLocalAgentStore.open({ workspaceRef });
    try {
      const doc = await store.agents.get({ agentId });
      if (!doc) return false;
      if (!doc.activeRunId && doc.status !== 'running') return false;
      await store.agents.update({
        agent: {
          ...doc,
          status: 'idle',
          activeRunId: null,
          updatedAt: Date.now(),
        },
      });
      log.info('cursor', 'agent-active-run-cleared', {
        agentId,
        workspaceRef,
        previousRunId: doc.activeRunId ?? undefined,
      });
      return true;
    } finally {
      await store.dispose();
    }
  } catch (err) {
    log.warn('cursor', 'agent-active-run-clear-failed', {
      agentId,
      workspaceRef,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Clear stale activeRunId when the pointed run is already terminal.
 * Safe before a new send — does not cancel in-flight runs.
 */
export async function releaseAgentRunLockIfTerminal(agentId: string, cwd: string): Promise<boolean> {
  let released = false;
  for (const workspaceRef of workspaceRefs(cwd)) {
    try {
      const store = await SqliteLocalAgentStore.open({ workspaceRef });
      try {
        const doc = await store.agents.get({ agentId });
        if (!doc?.activeRunId) continue;
        const run = await store.runs.get({ agentId, runId: doc.activeRunId });
        if (run && (run.status === 'running' || run.status === 'queued')) continue;
        if (await clearAgentActiveRunLock(agentId, workspaceRef)) released = true;
      } finally {
        await store.dispose();
      }
    } catch (err) {
      log.warn('cursor', 'agent-run-lock-release-failed', {
        agentId,
        workspaceRef,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return released;
}

export async function cancelRunningRunsForAgent(
  agentId: string,
  cwd: string,
  event = 'stale-run-cancelled',
): Promise<number> {
  let cancelled = 0;
  const seen = new Set<string>();

  try {
    const listed = await Agent.listRuns(agentId, { runtime: 'local', cwd, limit: 50 });
    for (const item of listed.items) {
      if (item.status !== 'running' && item.status !== 'queued') continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (await cancelRunById(agentId, cwd, item.id, event)) cancelled++;
    }
  } catch (err) {
    log.warn('cursor', 'stale-run-list-failed', {
      agentId,
      cwd,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  for (const workspaceRef of workspaceRefs(cwd)) {
    try {
      const store = await SqliteLocalAgentStore.open({ workspaceRef });
      try {
        const doc = await store.agents.get({ agentId });
        if (doc?.activeRunId && !seen.has(doc.activeRunId)) {
          seen.add(doc.activeRunId);
          if (await cancelRunById(agentId, cwd, doc.activeRunId, event)) cancelled++;
        }
        const runs = await store.runs.list({ filter: { agentIds: [agentId], limit: 50 } });
        for (const run of runs.items) {
          if (run.status !== 'running' && run.status !== 'queued') continue;
          if (seen.has(run.runId)) continue;
          seen.add(run.runId);
          if (await cancelRunById(agentId, cwd, run.runId, event)) cancelled++;
        }
      } finally {
        await store.dispose();
      }
    } catch (err) {
      log.warn('cursor', 'stale-run-store-scan-failed', {
        agentId,
        workspaceRef,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return cancelled;
}

/** Cancel runs + clear locks when ending a Cursor chat session (/new). */
export async function releaseCursorSessionResources(
  agentId: string,
  cwd: string,
  event = 'session-released',
): Promise<void> {
  log.info('cursor', 'session-release-begin', { agentId, event });
  const cancelled = await cancelRunningRunsForAgent(agentId, cwd, event);
  let locksCleared = 0;
  for (const workspaceRef of workspaceRefs(cwd)) {
    if (await clearAgentActiveRunLock(agentId, workspaceRef)) locksCleared++;
  }
  log.info('cursor', 'session-release-done', { agentId, cancelled, locksCleared, event });
}

/** Cancel runs + clear agent.activeRunId in store; reload agent only on conflict retry. */
export async function recoverActiveRunConflict(agent: SDKAgent, cwd: string): Promise<void> {
  await cancelRunningRunsForAgent(agent.agentId, cwd, 'conflict-cancelled');
  for (const workspaceRef of workspaceRefs(cwd)) {
    await clearAgentActiveRunLock(agent.agentId, workspaceRef);
  }
  await agent.reload();
  await delay(500);
}

/**
 * Send without pre-cleanup; on active-run conflict recover store state and retry once.
 */
export function sendWithActiveRunRetry(
  agent: SDKAgent,
  cwd: string,
  prompt: string,
): Promise<Run> {
  const promise = (async (): Promise<Run> => {
    try {
      return await agent.send(prompt);
    } catch (err) {
      if (!isActiveRunConflict(err)) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn('cursor', 'send-failed', {
          agentId: agent.agentId,
          errorKind: classifyCursorError(message),
          message: message.slice(0, 240),
        });
        throw err;
      }
      log.warn('cursor', 'active-run-conflict-retry', { agentId: agent.agentId, cwd });
      await recoverActiveRunConflict(agent, cwd);
      try {
        return await agent.send(prompt);
      } catch (retryErr) {
        const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
        log.warn('cursor', 'send-retry-failed', {
          agentId: agent.agentId,
          errorKind: classifyCursorError(message),
          message: message.slice(0, 240),
        });
        throw retryErr;
      }
    }
  })();
  void promise.catch(() => {
    /* avoid unhandledRejection while polling for early run */
  });
  return promise;
}

/** Cancel orphaned runs / agent locks for active Cursor sessions (bridge startup). */
export async function cleanupStaleCursorRuns(catalog: SessionCatalog): Promise<void> {
  const targets = new Map<string, string>();
  for (const entry of catalog.entries()) {
    if (entry.agentId !== 'cursor' || entry.status !== 'active') continue;
    const agentId = entry.cursorAgentId?.trim();
    if (!agentId) continue;
    targets.set(agentId, entry.cwdRealpath);
  }
  if (targets.size === 0) return;

  let cancelled = 0;
  let locksCleared = 0;
  for (const [agentId, cwd] of targets) {
    cancelled += await cancelRunningRunsForAgent(agentId, cwd);
    for (const workspaceRef of workspaceRefs(cwd)) {
      if (await clearAgentActiveRunLock(agentId, workspaceRef)) locksCleared++;
    }
  }
  if (cancelled > 0 || locksCleared > 0) {
    log.info('cursor', 'stale-run-cleanup-done', {
      cancelled,
      locksCleared,
      agents: targets.size,
      agentIds: [...targets.keys()],
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
