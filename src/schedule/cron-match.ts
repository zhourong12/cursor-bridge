import { CronExpressionParser } from 'cron-parser';

export function validateCron(expr: string): string | undefined {
  try {
    CronExpressionParser.parse(expr.trim());
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Returns a slot key (YYYY-MM-DDTHH:mm) if cron fires in this minute, else null. */
export function cronSlotForNow(cron: string, now: Date): string | null {
  try {
    const parser = CronExpressionParser.parse(cron.trim(), { currentDate: now });
    const prev = parser.prev().toDate();
    if (
      prev.getFullYear() === now.getFullYear() &&
      prev.getMonth() === now.getMonth() &&
      prev.getDate() === now.getDate() &&
      prev.getHours() === now.getHours() &&
      prev.getMinutes() === now.getMinutes()
    ) {
      return formatSlot(now);
    }
    return null;
  } catch {
    return null;
  }
}

export function formatSlot(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}
