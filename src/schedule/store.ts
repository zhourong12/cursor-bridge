import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write';
import type { ScheduledTask, ScheduleStore } from './types';

const EMPTY: ScheduleStore = { version: 1, tasks: [] };

export function schedulesFile(profileDir: string): string {
  return join(profileDir, 'schedules.json');
}

export async function loadSchedules(profileDir: string): Promise<ScheduleStore> {
  const path = schedulesFile(profileDir);
  try {
    const raw = await readFile(path, 'utf8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(text) as ScheduleStore;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) return { ...EMPTY };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    throw err;
  }
}

export async function saveSchedules(profileDir: string, store: ScheduleStore): Promise<void> {
  await writeFileAtomic(schedulesFile(profileDir), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export async function addTask(
  profileDir: string,
  input: Omit<ScheduledTask, 'id' | 'enabled' | 'createdAt'>,
): Promise<ScheduledTask> {
  const store = await loadSchedules(profileDir);
  const task: ScheduledTask = {
    ...input,
    id: randomUUID().slice(0, 8),
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  store.tasks.push(task);
  await saveSchedules(profileDir, store);
  return task;
}

export async function removeTask(profileDir: string, id: string): Promise<boolean> {
  const store = await loadSchedules(profileDir);
  const before = store.tasks.length;
  store.tasks = store.tasks.filter((t) => t.id !== id);
  if (store.tasks.length === before) return false;
  await saveSchedules(profileDir, store);
  return true;
}

export async function updateTask(
  profileDir: string,
  id: string,
  patch: Partial<Pick<ScheduledTask, 'lastRunAt' | 'lastRunSlot' | 'enabled'>>,
): Promise<void> {
  const store = await loadSchedules(profileDir);
  const task = store.tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, patch);
  await saveSchedules(profileDir, store);
}
