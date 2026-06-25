import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAppPaths } from '../config/app-paths';
import { log } from '../core/logger';
import {
  collectFleetStatus,
  resolveFleetProfileNames,
  type FleetProfileStatus,
} from '../runtime/fleet-status';
import { isAlive, readAndPrune } from '../runtime/registry';
import { stopProcessEntry } from '../runtime/process-control';
import { runFleetStartCli, runFleetStopCli, runBridgeCliCapture } from './spawn-bridge';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function stopForegroundBridgeProcesses(rootDir?: string): Promise<number> {
  const paths = resolveAppPaths({ rootDir });
  const running = readAndPrune(paths.userRegistryFile);
  let stopped = 0;
  for (const entry of running) {
    if (!isAlive(entry.pid)) continue;
    try {
      await stopProcessEntry(entry);
      stopped++;
    } catch {
      /* best effort */
    }
  }
  return stopped;
}

export async function clearBridgeRuntimeLocks(rootDir?: string): Promise<void> {
  const paths = resolveAppPaths({ rootDir });
  for (const sub of ['profile', 'app']) {
    const dir = join(paths.userLockDir, sub);
    try {
      const items = await readdir(dir);
      await Promise.all(items.map((f) => rm(join(dir, f), { recursive: true, force: true })));
    } catch {
      /* dir may not exist */
    }
  }
  await writeFile(paths.userRegistryFile, '{"entries": []}\n', { mode: 0o600 });
}

async function waitFleetConnected(
  profiles: string[],
  timeoutMs = 45_000,
): Promise<FleetProfileStatus[]> {
  const deadline = Date.now() + timeoutMs;
  let rows = await collectFleetStatus(profiles);
  while (Date.now() < deadline) {
    rows = await collectFleetStatus(profiles);
    if (rows.filter((r) => r.connected).length >= profiles.length) break;
    await sleep(1000);
  }
  return rows;
}

function fleetSummary(status: FleetProfileStatus[]): string {
  const connected = status.filter((r) => r.connected).length;
  return `Fleet ${connected}/${status.length} 已连接飞书`;
}

export async function runFleetControlStart(
  opts: { all?: boolean; profiles?: string[] },
  rootDir?: string,
): Promise<{ status: FleetProfileStatus[]; summary: string }> {
  await runFleetStartCli(opts);
  const profiles = await resolveFleetProfileNames(opts);
  const status = await waitFleetConnected(profiles);
  return { status, summary: fleetSummary(status) };
}

export async function runFleetControlStop(
  opts: { all?: boolean; profiles?: string[] },
  rootDir?: string,
): Promise<{ status: FleetProfileStatus[]; summary: string }> {
  await runFleetStopCli(opts);
  const profiles = await resolveFleetProfileNames({ all: opts.all ?? true, profiles: opts.profiles });
  const status = await collectFleetStatus(profiles);
  return { status, summary: `已停止 ${profiles.length} 个 profile` };
}

/** 等同 fleet-restart.bat：停前台进程 → fleet stop → 清锁 → fleet start */
export async function runFleetControlRestart(
  opts: { all?: boolean; profiles?: string[] },
  rootDir?: string,
): Promise<{ status: FleetProfileStatus[]; summary: string; stoppedForeground: number }> {
  const profiles = await resolveFleetProfileNames(opts);

  if (opts.profiles?.length) {
    log.info('fleet', 'restart-profiles', { profiles: opts.profiles });
    const args = ['fleet', 'restart', '--profiles', opts.profiles.join(',')];
    await runBridgeCliCapture(args, undefined, 180_000);
    const status = await waitFleetConnected(profiles);
    log.info('fleet', 'restart-done', { mode: 'profiles', summary: fleetSummary(status) });
    return { status, summary: fleetSummary(status), stoppedForeground: 0 };
  }

  log.info('fleet', 'restart-full-begin', { profiles });
  const stoppedForeground = await stopForegroundBridgeProcesses(rootDir);
  log.info('fleet', 'restart-stop-foreground', { stoppedForeground });
  await sleep(2000);
  try {
    await runFleetStopCli({ all: true });
    log.info('fleet', 'restart-fleet-stop', { ok: true });
  } catch (err) {
    log.warn('fleet', 'restart-fleet-stop', {
      ok: false,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  await sleep(2000);
  await clearBridgeRuntimeLocks(rootDir);
  log.info('fleet', 'restart-locks-cleared', {});

  await runFleetStartCli(opts);
  const status = await waitFleetConnected(profiles);
  log.info('fleet', 'restart-done', {
    mode: 'full',
    stoppedForeground,
    summary: fleetSummary(status),
  });
  return { status, summary: fleetSummary(status), stoppedForeground };
}
