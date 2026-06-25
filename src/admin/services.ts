import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { resolveAppPaths } from '../config/app-paths';
import { loadRootConfig, readActiveProfile } from '../config/profile-store';
import { listSecretIds } from '../config/keystore';
import { getServiceAdapter } from '../daemon/service-adapter';
import { loadFleetConfig, saveFleetConfig } from '../fleet/load';
import type { FleetConfig } from '../fleet/schema';
import { listAllProfiles } from '../runtime/profile-discovery';
import { collectFleetStatus, detectDuplicateAppIds } from '../runtime/fleet-status';
import { readAndPrune } from '../runtime/registry';
import { loadSchedules, addTask, removeTask } from '../schedule/store';
import type { ScheduledTask } from '../schedule/types';
import { validateCron } from '../schedule/cron-match';
import { isPathInsideBase } from './validate';
import { redactChatId } from './redact';
import { readBotRuntimeStats } from '../runtime/bot-runtime-stats';

export type PublicScheduleTask = Omit<ScheduledTask, 'chatId'> & { chatIdRedacted: string };

export function publicScheduleTask(task: ScheduledTask): PublicScheduleTask {
  const { chatId, ...rest } = task;
  return { ...rest, chatIdRedacted: redactChatId(chatId) };
}

const MAX_LOG_TAIL_BYTES = 512 * 1024;

export async function getOverview(rootDir?: string) {
  const paths = resolveAppPaths({ rootDir });
  const running = readAndPrune(paths.userRegistryFile);
  const fleet = await loadFleetConfig(paths.rootDir);
  const root = await loadRootConfig(paths.configFile);
  let profiles: Awaited<ReturnType<typeof listAllProfiles>> = [];
  try {
    profiles = await listAllProfiles(paths.rootDir);
  } catch {
    if (root?.profiles) {
      const active = (await readActiveProfile(paths.rootDir)) ?? root.activeProfile;
      profiles = Object.keys(root.profiles).map((name) => ({
        name,
        active: name === active,
        agentKind: root.profiles[name]!.agentKind,
        profileDir: resolveAppPaths({ rootDir: paths.rootDir, profile: name }).profileDir,
      }));
    }
  }
  const dupes = await detectDuplicateAppIds(profiles.map((p) => p.name));
  const active = (await readActiveProfile(paths.rootDir)) ?? (await loadRootConfig(paths.configFile))?.activeProfile;
  const profileNames = profiles.map((p) => p.name);
  const fleetStatus = profileNames.length > 0 ? await collectFleetStatus(profileNames) : [];
  const runtimeStats: Record<string, Awaited<ReturnType<typeof readBotRuntimeStats>>> = {};
  for (const proc of running) {
    const profileDir = resolveAppPaths({ rootDir: paths.rootDir, profile: proc.profileName }).profileDir;
    const stats = await readBotRuntimeStats(profileDir);
    if (stats) runtimeStats[proc.profileName] = stats;
  }
  const processes = running.map((e) => ({
    id: e.id,
    pid: e.pid,
    profileName: e.profileName,
    appId: e.appId,
    botName: e.botName,
    agentKind: e.agentKind,
    startedAt: e.startedAt,
    version: e.version,
  }));
  return {
    runningCount: running.length,
    profileCount: profiles.length,
    activeProfile: active ?? null,
    fleetAutoStart: fleet.autoStart ?? [],
    duplicateAppWarnings: dupes,
    home: paths.rootDir,
    processes,
    fleetStatus,
    runtimeStats,
  };
}

export async function getProfilesDetail(rootDir?: string) {
  const paths = resolveAppPaths({ rootDir });
  const profiles = await listAllProfiles(paths.rootDir);
  const running = readAndPrune(paths.userRegistryFile);
  const rows = [];
  for (const p of profiles) {
    const adapter = getServiceAdapter(p.name);
    const entry = running.find((e) => e.profileName === p.name);
    rows.push({
      name: p.name,
      active: p.active,
      agentKind: p.agentKind,
      daemonRegistered: adapter?.fileExists() ?? false,
      daemonRunning: adapter?.isRunning() ?? false,
      connected: Boolean(entry),
      pid: entry?.pid,
      botName: entry?.botName,
      appId: entry?.appId,
    });
  }
  return rows;
}

export async function getProcesses(rootDir?: string) {
  const paths = resolveAppPaths({ rootDir });
  return readAndPrune(paths.userRegistryFile).map((e) => ({
    id: e.id,
    pid: e.pid,
    profileName: e.profileName,
    appId: e.appId,
    botName: e.botName,
    agentKind: e.agentKind,
    startedAt: e.startedAt,
    version: e.version,
  }));
}

export async function getAllSchedules(rootDir?: string) {
  const paths = resolveAppPaths({ rootDir });
  const profiles = await listAllProfiles(paths.rootDir);
  const groups = await Promise.all(
    profiles.map(async (p) => {
      const store = await loadSchedules(p.profileDir);
      return {
        profile: p.name,
        tasks: store.tasks.map(publicScheduleTask),
      };
    }),
  );
  return groups;
}

export async function getSecretsSummary(rootDir?: string) {
  const paths = resolveAppPaths({ rootDir });
  const profiles = await listAllProfiles(paths.rootDir);
  return Promise.all(
    profiles.map(async (p) => {
      try {
        const appPaths = resolveAppPaths({ rootDir: paths.rootDir, profile: p.name });
        const ids = await listSecretIds({
          secretsFile: appPaths.secretsFile,
          keystoreSaltFile: appPaths.keystoreSaltFile,
        });
        return { profile: p.name, secretIds: ids };
      } catch {
        return { profile: p.name, secretIds: [] as string[] };
      }
    }),
  );
}

export async function syncFleetOpenIds(rootDir?: string): Promise<FleetConfig> {
  const paths = resolveAppPaths({ rootDir });
  const fleet = await loadFleetConfig(paths.rootDir);
  const running = readAndPrune(paths.userRegistryFile);
  const bots = { ...(fleet.bots ?? {}) };
  for (const [name, entry] of Object.entries(bots)) {
    const proc = running.find((e) => e.profileName === entry.profile);
    if (proc?.botOpenId && !entry.openId) {
      bots[name] = { ...entry, openId: proc.botOpenId };
    }
  }
  const next = { ...fleet, bots };
  await saveFleetConfig(paths.rootDir, next);
  return next;
}

export async function resolveAllowedLogFile(profileDir: string, fileRef: string): Promise<string | undefined> {
  if (!fileRef || fileRef.includes('..') || /[/\\]/.test(fileRef)) return undefined;
  const allowed = await listLogFiles(profileDir);
  const name = basename(fileRef);
  for (const f of allowed) {
    if (basename(f) === name) return f;
  }
  return undefined;
}

export async function tailLogFile(filePath: string, lines = 80): Promise<string> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return '';
    const readLen = Math.min(info.size, MAX_LOG_TAIL_BYTES);
    const content = await readFile(filePath, { encoding: 'utf8' });
    if (content.length > readLen && info.size > MAX_LOG_TAIL_BYTES) {
      const trimmed = content.slice(-readLen);
      const parts = trimmed.split('\n');
      return parts.slice(-lines).join('\n');
    }
    const parts = content.split('\n');
    return parts.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function listLogFiles(profileDir: string): Promise<string[]> {
  const logsDir = join(profileDir, 'logs');
  if (!isPathInsideBase(logsDir, profileDir)) return [];
  try {
    const entries = await readdir(logsDir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      if (e.isFile()) files.push(resolve(join(logsDir, e.name)));
    }
    const daemonDir = join(logsDir, 'daemon');
    try {
      const daemonEntries = await readdir(daemonDir, { withFileTypes: true });
      for (const e of daemonEntries) {
        if (e.isFile()) files.push(resolve(join(daemonDir, e.name)));
      }
    } catch {
      /* no daemon logs */
    }
    return files;
  } catch {
    return [];
  }
}

export { collectFleetStatus, loadFleetConfig, saveFleetConfig, validateCron, addTask, removeTask };
