import { loadRootConfig } from '../config/profile-store';
import { resolveAppPaths } from '../config/app-paths';
import { getServiceAdapter } from '../daemon/service-adapter';
import { loadFleetConfig } from '../fleet/load';
import type { FleetConfig } from '../fleet/schema';
import { listAllProfiles } from './profile-discovery';
import { readAndPrune, type ProcessEntry } from './registry';

export interface FleetProfileStatus {
  profile: string;
  agentKind: string;
  daemonRegistered: boolean;
  daemonRunning: boolean;
  connected: boolean;
  botName?: string;
  appId?: string;
  pid?: number;
}

export async function collectFleetStatus(profiles: string[]): Promise<FleetProfileStatus[]> {
  const rootPaths = resolveAppPaths();
  const running = readAndPrune(rootPaths.userRegistryFile);
  let root;
  try {
    root = await loadRootConfig(rootPaths.configFile);
  } catch {
    root = undefined;
  }

  const rows: FleetProfileStatus[] = [];
  for (const profile of profiles) {
    const adapter = getServiceAdapter(profile);
    const daemonRegistered = adapter?.fileExists() ?? false;
    const daemonRunning = adapter?.isRunning() ?? false;
    const entry = running.find((e) => e.profileName === profile);
    const profileConfig = root?.profiles[profile];
    rows.push({
      profile,
      agentKind: profileConfig?.agentKind ?? entry?.agentKind ?? '?',
      daemonRegistered,
      daemonRunning,
      connected: Boolean(entry?.botName),
      ...(entry?.botName ? { botName: entry.botName } : {}),
      ...(entry?.appId ? { appId: entry.appId } : {}),
      ...(entry?.pid ? { pid: entry.pid } : {}),
    });
  }
  return rows;
}

export async function detectDuplicateAppIds(profiles: string[]): Promise<string[]> {
  const rootPaths = resolveAppPaths();
  const root = await loadRootConfig(rootPaths.configFile);
  if (!root) return [];
  const appToProfiles = new Map<string, string[]>();
  for (const profile of profiles) {
    const appId = root.profiles[profile]?.accounts?.app?.id;
    if (!appId) continue;
    const list = appToProfiles.get(appId) ?? [];
    list.push(profile);
    appToProfiles.set(appId, list);
  }
  const dupes: string[] = [];
  for (const [, list] of appToProfiles) {
    if (list.length > 1) dupes.push(`${list.join(', ')} share appId`);
  }
  return dupes;
}

export async function resolveFleetProfileNames(opts: {
  all?: boolean;
  profiles?: string[];
}): Promise<string[]> {
  const rootPaths = resolveAppPaths();
  const fleet = await loadFleetConfig(rootPaths.rootDir);
  if (opts.profiles && opts.profiles.length > 0) return opts.profiles;
  if (opts.all) {
    const discovered = await listAllProfiles(rootPaths.rootDir);
    return discovered.map((p) => p.name);
  }
  if (fleet.autoStart && fleet.autoStart.length > 0) return [...fleet.autoStart];
  const discovered = await listAllProfiles(rootPaths.rootDir);
  return discovered.map((p) => p.name);
}

export async function loadFleetForRuntime(): Promise<FleetConfig> {
  return loadFleetConfig(resolveAppPaths().rootDir);
}

export function registryEntriesForProfiles(entries: ProcessEntry[], profiles: string[]): ProcessEntry[] {
  const set = new Set(profiles);
  return entries.filter((e) => set.has(e.profileName));
}
