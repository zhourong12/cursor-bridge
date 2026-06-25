import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FleetBotEntry, FleetConfig, FleetPeer } from './schema';
import { EMPTY_FLEET } from './schema';

export function fleetConfigPath(rootDir?: string): string {
  const root = rootDir ?? process.env.LARK_CHANNEL_HOME ?? join(homedir(), '.lark-channel');
  return join(root, 'fleet.json');
}

export async function loadFleetConfig(rootDir?: string): Promise<FleetConfig> {
  const path = fleetConfigPath(rootDir);
  try {
    const raw = await readFile(path, 'utf8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(text) as FleetConfig;
    if (parsed.schemaVersion !== 1 || typeof parsed !== 'object' || parsed === null) {
      return { ...EMPTY_FLEET };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_FLEET };
    throw err;
  }
}

export async function saveFleetConfig(rootDir: string | undefined, fleet: FleetConfig): Promise<void> {
  const { writeFileAtomic } = await import('../platform/atomic-write');
  const path = fleetConfigPath(rootDir);
  await writeFileAtomic(path, `${JSON.stringify({ ...fleet, schemaVersion: 1 }, null, 2)}\n`, { mode: 0o600 });
}

/** Peers excluding the current profile's bot (by profile name match). */
export function fleetPeersForProfile(fleet: FleetConfig, currentProfile: string): FleetPeer[] {
  const bots = fleet.bots ?? {};
  const out: FleetPeer[] = [];
  for (const [name, entry] of Object.entries(bots)) {
    if (entry.profile === currentProfile) continue;
    out.push({
      name,
      profile: entry.profile,
      ...(entry.openId ? { openId: entry.openId } : {}),
      ...(entry.role ? { role: entry.role } : {}),
    });
  }
  return out;
}

export function resolveFleetBot(
  fleet: FleetConfig,
  target: string,
): { name: string; entry: FleetBotEntry } | undefined {
  const bots = fleet.bots ?? {};
  const trimmed = target.trim();
  if (!trimmed) return undefined;
  if (bots[trimmed]) return { name: trimmed, entry: bots[trimmed]! };
  const lower = trimmed.toLowerCase();
  for (const [name, entry] of Object.entries(bots)) {
    if (name.toLowerCase() === lower) return { name, entry };
    if (entry.openId === trimmed) return { name, entry };
  }
  if (trimmed.startsWith('ou_')) {
    return { name: trimmed, entry: { profile: '', openId: trimmed } };
  }
  return undefined;
}

export function resolveFleetProfiles(fleet: FleetConfig, opts: {
  all?: boolean;
  profiles?: string[];
  rootProfiles?: string[];
}): string[] {
  if (opts.profiles && opts.profiles.length > 0) return opts.profiles;
  if (fleet.autoStart && fleet.autoStart.length > 0 && !opts.all) return [...fleet.autoStart];
  if (opts.all && opts.rootProfiles) return opts.rootProfiles;
  if (fleet.autoStart && fleet.autoStart.length > 0) return [...fleet.autoStart];
  return opts.rootProfiles ?? [];
}
