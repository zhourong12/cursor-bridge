import { isAlive, type ProcessEntry } from './registry';

export type StopProcessEntryResult = 'terminated' | 'killed';

export async function stopProcessEntry(
  entry: Pick<ProcessEntry, 'pid'> & { id?: string },
  timeoutMs = 2000,
): Promise<StopProcessEntryResult> {
  process.kill(entry.pid, 'SIGTERM');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(entry.pid)) {
      return 'terminated';
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  process.kill(entry.pid, 'SIGKILL');
  const forceDeadline = Date.now() + timeoutMs;
  while (Date.now() < forceDeadline) {
    if (!isAlive(entry.pid)) {
      return 'killed';
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`process ${entry.pid} did not exit after SIGKILL`);
}
