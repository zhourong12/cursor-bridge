import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname } from 'node:path';
import {
  daemonLogDir,
  daemonStderrPath,
  daemonStdoutPath,
  launchAgentLabel,
  launchAgentPlistPath,
} from './paths';
import { paths } from '../config/paths';
import { DAEMON_ENV_PASSTHROUGH, collectDaemonExtraEnv, type DaemonExtraEnv } from './env';

export interface PlistInputs {
  /** Absolute path to the node binary that should run the bridge. */
  nodePath: string;
  /** Absolute path to the bridge CLI entry (the file currently executing). */
  bridgeEntryPath: string;
  /** PATH for the daemon process — captured from current shell so child
   * tools (lark-cli, claude) can be resolved by name. launchd defaults
   * to a very minimal PATH otherwise. */
  envPath: string;
  /** Profile this service instance is pinned to. */
  profile: string;
  /** Root directory for config/profile state. */
  channelHome: string;
  /** Extra environment required by selected agents. */
  extraEnv?: DaemonExtraEnv;
}

export function buildPlist(inputs: PlistInputs): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const extraEnv = Object.entries(inputs.extraEnv ?? {})
    .map(
      ([key, value]) => `        <key>${escape(key)}</key>
        <string>${escape(value)}</string>`,
    )
    .join('\n');
  const extraEnvBlock = extraEnv ? `\n${extraEnv}` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${launchAgentLabel(inputs.profile)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escape(inputs.nodePath)}</string>
        <string>${escape(inputs.bridgeEntryPath)}</string>
        <string>run</string>
        <string>--profile</string>
        <string>${escape(inputs.profile)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escape(daemonStdoutPath(inputs.profile))}</string>
    <key>StandardErrorPath</key>
    <string>${escape(daemonStderrPath(inputs.profile))}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escape(inputs.envPath)}</string>
        <key>LARK_CHANNEL_HOME</key>
        <string>${escape(inputs.channelHome)}</string>${extraEnvBlock}
    </dict>
</dict>
</plist>
`;
}

export async function writePlist(profile: string): Promise<void> {
  const bridgeEntryPath = process.argv[1];
  if (!bridgeEntryPath) {
    throw new Error('cannot determine bridge entry path (process.argv[1] is empty)');
  }
  const plistPath = launchAgentPlistPath(profile);
  const content = buildPlist({
    nodePath: process.execPath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? '',
    profile,
    channelHome: paths.rootDir,
    extraEnv: collectDaemonExtraEnv(process.env, await readExistingExtraEnv(plistPath)),
  });
  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(daemonLogDir(profile), { recursive: true });
  await writeFile(plistPath, content, 'utf8');
}

async function readExistingExtraEnv(plistPath: string): Promise<DaemonExtraEnv> {
  let content: string;
  try {
    content = await readFile(plistPath, 'utf8');
  } catch {
    return {};
  }

  const result: DaemonExtraEnv = {};
  for (const name of DAEMON_ENV_PASSTHROUGH) {
    const match = content.match(new RegExp(`<key>${escapeRegExp(name)}</key>\\s*<string>([^<]+)</string>`));
    const value = match?.[1]?.trim();
    if (value) result[name] = unescapePlistString(value);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unescapePlistString(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function plistExists(profile: string): boolean {
  return existsSync(launchAgentPlistPath(profile));
}

function userTarget(): string {
  return `gui/${userInfo().uid}`;
}

function serviceTarget(profile: string): string {
  return `${userTarget()}/${launchAgentLabel(profile)}`;
}

interface LaunchctlResult {
  ok: boolean;
  stderr: string;
  stdout: string;
}

function runLaunchctl(args: string[]): LaunchctlResult {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
}

export function bootstrap(profile: string): LaunchctlResult {
  return runLaunchctl(['bootstrap', userTarget(), launchAgentPlistPath(profile)]);
}

export function bootout(profile: string): LaunchctlResult {
  return runLaunchctl(['bootout', serviceTarget(profile)]);
}

/** kickstart -k: kill the running instance and start a new one. Service
 * must already be bootstrapped (loaded into launchd). */
export function kickstart(profile: string): LaunchctlResult {
  return runLaunchctl(['kickstart', '-k', serviceTarget(profile)]);
}

/** `launchctl print <target>` returns 0 iff the service is loaded.
 * We discard the verbose stdout for the existence check. */
export function isLoaded(profile: string): boolean {
  const r = spawnSync('launchctl', ['print', serviceTarget(profile)], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

/**
 * launchctl bootout returns synchronously, but the actual unload is async
 * at the OS level — `isLoaded()` may still be true for a brief window
 * after. If you bootstrap during that window, launchd refuses with the
 * cryptic `Bootstrap failed: 5: Input/output error`. Poll until the
 * service is truly gone.
 */
export async function waitUntilUnloaded(profile: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isLoaded(profile)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Returns the raw `launchctl print` output, parsed downstream. */
export function describeService(profile: string): string {
  const r = runLaunchctl(['print', serviceTarget(profile)]);
  return r.stdout || r.stderr || '';
}

export async function deletePlist(profile: string): Promise<void> {
  await rm(launchAgentPlistPath(profile), { force: true });
}
