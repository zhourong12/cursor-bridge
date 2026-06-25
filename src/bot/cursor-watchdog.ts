import { cleanupStaleCursorRuns, releaseAgentRunLockIfTerminal } from '../agent/cursor/stale-run-cleanup';
import { WATCHDOG_INTERVAL_MS } from '../agent/cursor/timeouts';
import { log } from '../core/logger';
import type { BotRuntimeStats } from '../runtime/bot-runtime-stats';
import type { SessionCatalog } from '../session/catalog';

export function startCursorWatchdog(deps: {
  sessionCatalog: SessionCatalog;
  profileDir: string;
  agentKind: string;
  stats?: BotRuntimeStats;
}): { stop(): void } {
  if (deps.agentKind !== 'cursor') {
    return { stop() {} };
  }

  const timer = setInterval(() => {
    void (async () => {
      log.info('cursor', 'watchdog-tick', {});
      deps.stats?.touchWatchdog();
      await cleanupStaleCursorRuns(deps.sessionCatalog);
      for (const entry of deps.sessionCatalog.entries()) {
        if (entry.agentId !== 'cursor' || entry.status !== 'active') continue;
        const agentId = entry.cursorAgentId?.trim();
        if (!agentId) continue;
        await releaseAgentRunLockIfTerminal(agentId, entry.cwdRealpath);
      }
    })().catch((err) => {
      log.warn('cursor', 'watchdog-error', { err: err instanceof Error ? err.message : String(err) });
    });
  }, WATCHDOG_INTERVAL_MS);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
