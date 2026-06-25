import {
  runServiceRestart,
  runServiceStart,
  runServiceStatus,
  runServiceStop,
} from './service';
import {
  collectFleetStatus,
  detectDuplicateAppIds,
  resolveFleetProfileNames,
} from '../../runtime/fleet-status';

export interface FleetCommandOptions {
  all?: boolean;
  profiles?: string[];
}

function parseProfilesArg(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw.split(',').map((p) => p.trim()).filter(Boolean);
}

async function resolveProfiles(opts: FleetCommandOptions): Promise<string[]> {
  const explicit = opts.profiles;
  const names = await resolveFleetProfileNames({ all: opts.all, profiles: explicit });
  if (names.length === 0) {
    console.error('没有可操作的 profile。请先 `profile create` 或在 fleet.json 配置 autoStart。');
    process.exit(1);
  }
  return names;
}

async function reportFleetConnectSummary(
  profiles: string[],
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let rows = await collectFleetStatus(profiles);
  while (Date.now() < deadline) {
    rows = await collectFleetStatus(profiles);
    if (rows.filter((r) => r.connected).length >= profiles.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const connected = rows.filter((r) => r.connected);
  console.log('');
  if (connected.length >= profiles.length) {
    console.log(`✓ Fleet 已连接 ${connected.length}/${profiles.length} 个 bot`);
  } else {
    console.warn(
      `⚠ Fleet 已连接 ${connected.length}/${profiles.length} 个 bot（${Math.round(timeoutMs / 1000)}s 内未全部上线）`,
    );
  }
  for (const r of rows) {
    if (r.connected) {
      const bot = r.botName ?? r.profile;
      const pid = r.pid ? `  pid ${r.pid}` : '';
      console.log(`  · ${bot} (${r.profile})${pid}`);
    } else {
      console.log(`  ✗ ${r.profile} 未连接`);
    }
  }
}

export async function runFleetStart(opts: FleetCommandOptions = {}): Promise<void> {
  const profiles = await resolveProfiles(opts);
  const dupes = await detectDuplicateAppIds(profiles);
  for (const d of dupes) console.warn(`⚠ 警告: ${d} — 同 appId 不能双开`);

  for (const profile of profiles) {
    console.log(`\n▶ 启动 profile: ${profile}`);
    await runServiceStart({
      profile,
      confirmStopRuntimeLockProcess: () => true,
    });
  }
  await reportFleetConnectSummary(profiles);
  console.log(`\n✓ fleet start 完成 (${profiles.length} 个 profile)`);
}

export async function runFleetStop(opts: FleetCommandOptions = {}): Promise<void> {
  const profiles = await resolveProfiles(opts);
  for (const profile of profiles) {
    console.log(`\n■ 停止 profile: ${profile}`);
    await runServiceStop({ profile });
  }
  console.log(`\n✓ fleet stop 完成 (${profiles.length} 个 profile)`);
}

export async function runFleetRestart(opts: FleetCommandOptions = {}): Promise<void> {
  const profiles = await resolveProfiles(opts);
  for (const profile of profiles) {
    console.log(`\n↻ 重启 profile: ${profile}`);
    await runServiceRestart({ profile });
  }
  await reportFleetConnectSummary(profiles);
  console.log(`\n✓ fleet restart 完成 (${profiles.length} 个 profile)`);
}

export async function runFleetStatus(opts: FleetCommandOptions = {}): Promise<void> {
  const profiles = await resolveProfiles({ all: opts.all ?? true, profiles: opts.profiles });
  const rows = await collectFleetStatus(profiles);
  if (rows.length === 0) {
    console.log('没有 profile。');
    return;
  }
  console.log(`# Fleet 状态 (${rows.length} profiles)\n`);
  const table = rows.map((r) => ({
    profile: r.profile,
    agent: r.agentKind,
    daemon: r.daemonRunning ? 'running' : r.daemonRegistered ? 'registered' : '-',
    connected: r.connected ? 'yes' : 'no',
    bot: r.botName ?? '-',
  }));
  printTable([
    { profile: 'PROFILE', agent: 'AGENT', daemon: 'DAEMON', connected: 'CONN', bot: 'BOT' },
    ...table,
  ]);
}

function printTable(rows: Record<string, string>[]): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = Math.max(...rows.map((r) => displayWidth(r[col] ?? '')));
  }
  for (const r of rows) {
    console.log(cols.map((c) => padEndDisplay(r[c] ?? '', widths[c] ?? 0)).join('  '));
  }
}

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0x2e80 ? 2 : 1;
  }
  return w;
}

function padEndDisplay(s: string, target: number): string {
  const pad = target - displayWidth(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}

export function parseFleetProfilesFlag(value: string | undefined): string[] | undefined {
  return parseProfilesArg(value);
}
