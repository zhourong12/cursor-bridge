import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import type { AgentAdapter } from '../agent/types';
import type { ProfileConfig } from '../config/profile-schema';
import { log } from '../core/logger';
import { cronSlotForNow } from './cron-match';
import { runScheduledTask } from './run-task';
import { loadSchedules } from './store';

const TICK_MS = 60_000;

export interface ScheduleTimerDeps {
  channel: LarkChannel;
  agent: AgentAdapter;
  profileDir: string;
  profileName: string;
  profileConfig: ProfileConfig;
}

export function startScheduleTimer(deps: ScheduleTimerDeps): { stop(): void } {
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const store = await loadSchedules(deps.profileDir);
      const now = new Date();
      const defaultCwd = deps.profileConfig.workspaces.default ?? process.cwd();
      const model = deps.profileConfig.cursor?.model;

      for (const task of store.tasks) {
        if (!task.enabled) continue;
        const slot = cronSlotForNow(task.cron, now);
        if (!slot || task.lastRunSlot === slot) continue;
        void runScheduledTask(
          {
            channel: deps.channel,
            agent: deps.agent,
            profileDir: deps.profileDir,
            profileName: deps.profileName,
            defaultCwd,
            model,
          },
          task,
          slot,
        );
      }
    } catch (err) {
      log.fail('schedule', err, { step: 'tick' });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, TICK_MS);

  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
