import { TimeoutError } from '../../core/with-timeout';
import { classifyCursorError } from '../../core/diagnostics';

export const AGENT_ACQUIRE_TIMEOUT_MS = 20_000;
export const MODEL_LIST_TIMEOUT_MS = 15_000;
export const SEND_TIMEOUT_MS = parseInt(process.env.CURSOR_SEND_TIMEOUT_MS ?? '', 10) || 600_000;
export const RUN_WAIT_TIMEOUT_MS =
  parseInt(process.env.CURSOR_RUN_WAIT_TIMEOUT_MS ?? '', 10) || SEND_TIMEOUT_MS;
/** Idle time since last catalog touch before skipping Cursor resume (not agent creation age). */
export const CURSOR_RESUME_IDLE_MS =
  parseInt(process.env.CURSOR_RESUME_IDLE_MS ?? '', 10) || 30 * 60 * 1000;
/** @deprecated use CURSOR_RESUME_IDLE_MS */
export const SESSION_RESUME_TTL_MS = CURSOR_RESUME_IDLE_MS;
export const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

export function isTimeoutError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(msg)) return true;
  return classifyCursorError(msg) === 'timeout';
}
