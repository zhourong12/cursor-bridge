import { spawn } from 'node:child_process';
import { log } from '../../core/logger';

const THRESHOLD = parseInt(process.env.CURSOR_AUTH_RESTART_THRESHOLD ?? '', 10) || 3;
const PERIODIC_RESTART_HOURS = (() => {
  const raw = process.env.CURSOR_PERIODIC_RESTART_HOURS;
  if (raw === undefined) return 6;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 6;
})();

let consecutiveAuthFailures = 0;
let restarting = false;
let restartContext: { profile: string } | null = null;
let periodicTimer: NodeJS.Timeout | null = null;

export function setAuthRestartContext(ctx: { profile: string }): void {
  restartContext = ctx;
  startPeriodicRestart();
}

function startPeriodicRestart(): void {
  if (periodicTimer || PERIODIC_RESTART_HOURS <= 0) return;
  const intervalMs = PERIODIC_RESTART_HOURS * 60 * 60 * 1000;
  periodicTimer = setInterval(() => triggerSelfRestart('periodic'), intervalMs);
  periodicTimer.unref();
  log.info('cursor', 'periodic-restart-scheduled', { hours: PERIODIC_RESTART_HOURS });
}

export function recordCursorRunOutcome(opts: {
  ok: boolean;
  errorKind?: string;
  sawOutput?: boolean;
}): void {
  if (opts.ok) {
    if (consecutiveAuthFailures > 0) consecutiveAuthFailures = 0;
    return;
  }
  if (opts.errorKind !== 'auth' || opts.sawOutput) return;

  consecutiveAuthFailures += 1;
  log.warn('cursor', 'auth-failure-streak', {
    count: consecutiveAuthFailures,
    threshold: THRESHOLD,
  });
  if (consecutiveAuthFailures >= THRESHOLD) triggerSelfRestart('auth-streak');
}

function triggerSelfRestart(reason: 'auth-streak' | 'periodic'): void {
  if (restarting) return;
  if (!restartContext) {
    log.warn('cursor', 'auth-restart-skipped', { reason: 'no-context' });
    return;
  }
  restarting = true;
  const cliEntry = process.argv[1];
  const { profile } = restartContext;
  log.warn('cursor', 'auth-restart-trigger', { reason, profile, consecutiveAuthFailures, cliEntry });
  try {
    const child = spawn(process.execPath, [cliEntry, 'restart', '--profile', profile], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.unref();
  } catch (err) {
    restarting = false;
    log.warn('cursor', 'auth-restart-spawn-failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
