import { randomUUID } from 'node:crypto';
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import type { AgentAdapter, AgentEvent } from '../agent/types';
import { log } from '../core/logger';
import { classifyCursorError } from '../core/diagnostics';
import { loadFleetConfig, resolveFleetBot } from '../fleet/load';
import { resolveAppPaths } from '../config/app-paths';
import { sendWithMentions } from '../bot/send-with-mentions';
import { updateTask } from './store';
import type { ScheduledTask } from './types';

export interface RunScheduledTaskDeps {
  channel: LarkChannel;
  agent: AgentAdapter;
  profileDir: string;
  defaultCwd: string;
  model?: string;
  profileName?: string;
}

async function collectAssistantText(events: AsyncIterable<AgentEvent>): Promise<string> {
  let text = '';
  let error: string | undefined;
  for await (const ev of events) {
    if (ev.type === 'text') text += ev.delta;
    if (ev.type === 'error') error = ev.message;
  }
  if (error) throw new Error(error);
  return text.trim();
}

export async function runScheduledTask(deps: RunScheduledTaskDeps, task: ScheduledTask, slot: string): Promise<void> {
  const cwd = task.cwd ?? deps.defaultCwd;
  log.info('schedule', 'run-start', { id: task.id, chatId: task.chatId, slot, silent: !!task.silent });

  try {
    const run = deps.agent.run({
      runId: randomUUID(),
      prompt: `[定时任务 ${task.id}] ${task.prompt}`,
      cwd,
      model: deps.model,
    });
    const text = await collectAssistantText(run.events);
    if (!task.silent) {
      const body = text || '（任务已完成，无文本输出）';
      await deps.channel.send(task.chatId, {
        markdown: `**定时任务** \`${task.id}\`\n\n${body}`,
      });
    }
    if (task.dispatch?.target && deps.profileName) {
      const fleet = await loadFleetConfig(resolveAppPaths({ profile: deps.profileName }).rootDir);
      const resolved = resolveFleetBot(fleet, task.dispatch.target);
      if (resolved?.entry.openId) {
        const dispatchBody =
          task.dispatch.prompt?.trim() ||
          text ||
          `[定时任务 ${task.id}] ${task.prompt}`;
        await sendWithMentions(deps.channel, task.chatId, {
          markdown: dispatchBody,
          at: [{ openId: resolved.entry.openId, name: resolved.name }],
        });
      } else {
        log.warn('schedule', 'dispatch-no-target', { id: task.id, target: task.dispatch.target });
      }
    }
    await updateTask(deps.profileDir, task.id, {
      lastRunAt: new Date().toISOString(),
      lastRunSlot: slot,
    });
    log.info('schedule', 'run-ok', { id: task.id, slot, silent: !!task.silent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.fail('schedule', err, {
      id: task.id,
      step: 'run',
      slot,
      errorKind: classifyCursorError(message),
    });
    if (!task.silent) {
      try {
        await deps.channel.send(task.chatId, {
          markdown: `**定时任务失败** \`${task.id}\`\n\n${message}`,
        });
      } catch (sendErr) {
        log.fail('schedule', sendErr, { id: task.id, step: 'notify-fail' });
      }
    }
    await updateTask(deps.profileDir, task.id, { lastRunSlot: slot });
  }
}
