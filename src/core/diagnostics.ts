/** Safe API-key fingerprint for logs (never log full secret). */
export function secretFingerprint(value: string | undefined | null): {
  present: boolean;
  len: number;
  prefix?: string;
  suffix?: string;
} {
  const v = value?.trim();
  if (!v) return { present: false, len: 0 };
  return {
    present: true,
    len: v.length,
    prefix: v.slice(0, 8),
    suffix: v.slice(-4),
  };
}

export type CursorErrorKind = 'auth' | 'network' | 'active-run' | 'timeout' | 'other';

/** Classify Cursor / agent failures for structured logs (grep: errorKind). */
export function classifyCursorError(message: string): CursorErrorKind {
  const t = message.trim();
  if (!t) return 'other';
  if (/Authentication error|unauthorized|\b401\b/i.test(t)) return 'auth';
  if (
    /fetch failed|API key exchange|ECONNREF|ETIMEDOUT|ENOTFOUND|socket hang up|Connection stalled|NGHTTP2|ECANCELED/i.test(
      t,
    )
  ) {
    return 'network';
  }
  if (/already has active run|activeRun/i.test(t)) return 'active-run';
  if (/idle.?timeout|\bidle_timeout\b/i.test(t)) return 'timeout';
  return 'other';
}
