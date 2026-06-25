import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write';

export interface BotRuntimeStatsSnapshot {
  lastRunAt?: number;
  lastRunOkAt?: number;
  lastSelfHealAt?: number;
  watchdogRuns: number;
  poolDepth?: number;
  activeRunsCount?: number;
  updatedAt: number;
}

export interface BotRuntimeStats {
  touchRun(ok: boolean): void;
  touchSelfHeal(): void;
  touchWatchdog(): void;
  updateObservability(poolDepth?: number, activeRunsCount?: number): void;
  snapshot(): BotRuntimeStatsSnapshot;
  startPersist(intervalMs?: number): void;
  stopPersist(): void;
}

const DEFAULT_PERSIST_MS = 30_000;

let boundStats: BotRuntimeStats | undefined;

export function bindBotRuntimeStats(stats: BotRuntimeStats | undefined): void {
  boundStats = stats;
}

export function touchSelfHealStats(): void {
  boundStats?.touchSelfHeal();
}

export function touchRunStats(ok: boolean): void {
  boundStats?.touchRun(ok);
}

function statsFile(profileDir: string): string {
  return join(profileDir, 'runtime-stats.json');
}

export function createBotRuntimeStats(profileDir: string): BotRuntimeStats {
  const state: BotRuntimeStatsSnapshot = {
    watchdogRuns: 0,
    updatedAt: Date.now(),
  };
  let persistTimer: ReturnType<typeof setInterval> | undefined;

  const persist = async (): Promise<void> => {
    state.updatedAt = Date.now();
    try {
      await writeFileAtomic(statsFile(profileDir), `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
      });
    } catch {
      /* non-fatal */
    }
  };

  return {
    touchRun(ok: boolean) {
      const now = Date.now();
      state.lastRunAt = now;
      if (ok) state.lastRunOkAt = now;
      void persist();
    },
    touchSelfHeal() {
      state.lastSelfHealAt = Date.now();
      void persist();
    },
    touchWatchdog() {
      state.watchdogRuns++;
      void persist();
    },
    updateObservability(poolDepth?: number, activeRunsCount?: number) {
      if (poolDepth !== undefined) state.poolDepth = poolDepth;
      if (activeRunsCount !== undefined) state.activeRunsCount = activeRunsCount;
    },
    snapshot() {
      return { ...state };
    },
    startPersist(intervalMs = DEFAULT_PERSIST_MS) {
      if (persistTimer) return;
      persistTimer = setInterval(() => void persist(), intervalMs);
      persistTimer.unref();
    },
    stopPersist() {
      if (persistTimer) {
        clearInterval(persistTimer);
        persistTimer = undefined;
      }
    },
  };
}

export async function readBotRuntimeStats(
  profileDir: string,
): Promise<BotRuntimeStatsSnapshot | undefined> {
  try {
    const raw = JSON.parse(await readFile(statsFile(profileDir), 'utf8')) as BotRuntimeStatsSnapshot;
    if (typeof raw !== 'object' || raw === null) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}
