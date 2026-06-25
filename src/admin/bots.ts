import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { resolveAppPaths } from '../config/app-paths';
import {
  loadRootConfig,
  readActiveProfile,
  withConfigFileLock,
  saveRootConfig,
  writeActiveProfile,
  agentKindFromString,
  markPermissionDefaultsMigration,
  createRootConfig,
} from '../config/profile-store';
import { type AgentKind } from '../config/profile-schema';
import { buildEncryptedAccountConfig } from '../config/store';
import { setSecret } from '../config/keystore';
import type { AppConfig, TenantBrand } from '../config/schema';
import { secretKeyForApp } from '../config/schema';
import { listSecretIds } from '../config/keystore';
import { getServiceAdapter } from '../daemon/service-adapter';
import { listAllProfiles } from '../runtime/profile-discovery';
import { readAndPrune } from '../runtime/registry';
import { createBootstrapProfileConfig } from '../cli/profile-bootstrap';
import { validateAppCredentials } from '../utils/feishu-auth';
import { loadFleetConfig, saveFleetConfig } from '../fleet/load';
import { syncFleetOpenIds } from './services';
import { runBridgeCli } from './spawn-bridge';
import { validateProfileName } from './validate';

export interface BotBoardRow {
  name: string;
  active: boolean;
  agentKind: string;
  appId?: string;
  tenant?: string;
  botName?: string;
  workspace?: string;
  workspaceExists: boolean;
  cursorModel?: string;
  allowedChatsCount: number;
  connected: boolean;
  pid?: number;
  daemonRegistered: boolean;
  daemonRunning: boolean;
  secretStored: boolean;
  larkCliBound: boolean;
  larkCliIdentity?: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function getBotProfileDefaults(
  name: string,
  rootDir?: string,
): Promise<{ workspace: string; autoCreate: boolean; exists: boolean }> {
  const err = validateProfileName(name);
  if (err) throw new Error(err);
  const paths = resolveAppPaths({ rootDir, profile: name.trim() });
  const workspace = paths.defaultWorkspaceDir;
  return {
    workspace,
    autoCreate: true,
    exists: await pathExists(workspace),
  };
}

export async function ensureBotProfileDefaults(
  name: string,
  rootDir?: string,
): Promise<{ workspace: string; autoCreate: boolean; exists: boolean }> {
  const base = await getBotProfileDefaults(name, rootDir);
  const { mkdir, realpath } = await import('node:fs/promises');
  await mkdir(base.workspace, { recursive: true, mode: 0o700 });
  return {
    workspace: await realpath(base.workspace),
    autoCreate: true,
    exists: true,
  };
}

async function readLarkCliBound(appPaths: ReturnType<typeof resolveAppPaths>, cfg: AppConfig): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(appPaths.larkCliTargetConfigFile, 'utf8')) as {
      apps?: Array<{ appId?: string; brand?: string }>;
    };
    return Boolean(
      raw.apps?.some(
        (a) => a.appId === cfg.accounts.app.id && a.brand === cfg.accounts.app.tenant,
      ),
    );
  } catch {
    return false;
  }
}

export async function getBotsBoard(rootDir?: string): Promise<BotBoardRow[]> {
  const paths = resolveAppPaths({ rootDir });
  const root = await loadRootConfig(paths.configFile);
  const active = (await readActiveProfile(paths.rootDir)) ?? root?.activeProfile;
  let profileNames: Array<{ name: string; active: boolean; agentKind: string }> = [];
  try {
    const discovered = await listAllProfiles(paths.rootDir);
    profileNames = discovered.map((p) => ({ name: p.name, active: p.active, agentKind: p.agentKind }));
  } catch {
    if (root?.profiles) {
      profileNames = Object.keys(root.profiles).map((name) => ({
        name,
        active: name === active,
        agentKind: root.profiles[name]!.agentKind,
      }));
    }
  }
  const running = readAndPrune(paths.userRegistryFile);
  const rows: BotBoardRow[] = [];

  for (const p of profileNames) {
    const appPaths = resolveAppPaths({ rootDir: paths.rootDir, profile: p.name });
    const profileCfg = root?.profiles[p.name];
    const entry = running.find((e) => e.profileName === p.name);
    const adapter = getServiceAdapter(p.name);
    let secretStored = false;
    try {
      const ids = await listSecretIds({
        secretsFile: appPaths.secretsFile,
        keystoreSaltFile: appPaths.keystoreSaltFile,
      });
      secretStored = ids.includes(profileCfg?.accounts.app.id ?? '');
    } catch {
      secretStored = false;
    }
    const cfg = profileCfg
      ? { accounts: profileCfg.accounts, secrets: profileCfg.secrets ?? root?.secrets }
      : undefined;
    const larkCliBound = cfg ? await readLarkCliBound(appPaths, cfg as AppConfig) : false;
    const workspace = profileCfg?.workspaces?.default;

    rows.push({
      name: p.name,
      active: p.active || active === p.name,
      agentKind: p.agentKind,
      appId: profileCfg?.accounts.app.id,
      tenant: profileCfg?.accounts.app.tenant,
      botName: entry?.botName,
      workspace,
      workspaceExists: workspace ? await pathExists(workspace) : false,
      cursorModel: profileCfg?.agentKind === 'cursor' ? profileCfg?.cursor?.model : undefined,
      allowedChatsCount: profileCfg?.access?.allowedChats?.length ?? 0,
      connected: Boolean(entry),
      pid: entry?.pid,
      daemonRegistered: adapter?.fileExists() ?? false,
      daemonRunning: adapter?.isRunning() ?? false,
      secretStored,
      larkCliBound,
      larkCliIdentity: profileCfg?.larkCli?.identityPreset,
    });
  }
  return rows;
}

function tenantBrandFromString(value: string | undefined): TenantBrand {
  if (!value || value === 'feishu') return 'feishu';
  if (value === 'lark') return 'lark';
  throw new Error(`unsupported tenant: ${value}`);
}

async function storeEncryptedCredentials(
  appId: string,
  appSecret: string,
  tenant: TenantBrand,
  appPaths: ReturnType<typeof resolveAppPaths>,
): Promise<AppConfig> {
  const encrypted = await buildEncryptedAccountConfig(appId, tenant, undefined, appPaths);
  await setSecret(secretKeyForApp(appId), appSecret, appPaths);
  return encrypted;
}

export async function registerProfileInFleet(opts: {
  profileName: string;
  rootDir?: string;
  workspace?: string;
  description?: string;
}): Promise<void> {
  const paths = resolveAppPaths({ rootDir: opts.rootDir });
  const fleet = await loadFleetConfig(paths.rootDir);
  const bots = { ...(fleet.bots ?? {}) };
  const key = opts.profileName;
  const existing = bots[key];
  if (existing && existing.profile !== opts.profileName) {
    throw new Error(`fleet bot key already used: ${key}`);
  }
  bots[key] = {
    profile: opts.profileName,
    role: 'dev',
    ...(opts.workspace ? { defaultCwd: opts.workspace } : {}),
    ...(opts.description ? { description: opts.description } : {}),
  };
  const autoStart = [...new Set([...(fleet.autoStart ?? []), opts.profileName])];
  await saveFleetConfig(paths.rootDir, { ...fleet, schemaVersion: 1, autoStart, bots });
}

export interface CreateBotProfileResult {
  name: string;
  workspace: string;
  fleetRegistered: boolean;
  activated: boolean;
  started: boolean;
  startError?: string;
}

async function waitForProfileRunning(
  profileName: string,
  registryFile: string,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = readAndPrune(registryFile).find((e) => e.profileName === profileName);
    if (entry) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function onboardBotProfile(opts: {
  name: string;
  rootDir?: string;
  workspace?: string;
  botName?: string;
}): Promise<Omit<CreateBotProfileResult, 'name' | 'workspace'>> {
  const paths = resolveAppPaths({ rootDir: opts.rootDir });
  const name = opts.name.trim();
  let fleetRegistered = false;
  let activated = false;
  let started = false;
  let startError: string | undefined;

  try {
    await registerProfileInFleet({
      profileName: name,
      rootDir: paths.rootDir,
      workspace: opts.workspace,
      description: opts.botName ? `Bot: ${opts.botName}` : undefined,
    });
    fleetRegistered = true;
  } catch (err) {
    startError = `Fleet 登记失败: ${(err as Error).message}`;
    return { fleetRegistered, activated, started, startError };
  }

  try {
    await activateBotProfile(name, paths.rootDir);
    activated = true;
  } catch (err) {
    startError = `切换当前 Profile 失败: ${(err as Error).message}`;
    return { fleetRegistered, activated, started, startError };
  }

  try {
    await startBotProfile(name, paths.rootDir);
    started = true;
    if (await waitForProfileRunning(name, paths.userRegistryFile)) {
      await syncFleetOpenIds(paths.rootDir);
    }
  } catch (err) {
    startError = `启动失败: ${(err as Error).message}`;
  }

  return { fleetRegistered, activated, started, startError };
}

export async function createBotProfile(input: {
  name: string;
  agent?: string;
  workspace?: string;
  appId: string;
  appSecret: string;
  tenant?: string;
  rootDir?: string;
  botName?: string;
  autoOnboard?: boolean;
}): Promise<CreateBotProfileResult> {
  const err = validateProfileName(input.name);
  if (err) throw new Error(err);
  if (!input.appId?.trim()) throw new Error('appId required');
  if (!input.appSecret?.trim()) throw new Error('appSecret required');
  const agent = agentKindFromString(input.agent) ?? 'cursor';
  if (input.agent && !agentKindFromString(input.agent)) throw new Error('invalid agent kind');

  const name = input.name.trim();
  const tenant = tenantBrandFromString(input.tenant?.trim());
  const validation = await validateAppCredentials(input.appId.trim(), input.appSecret.trim(), tenant);
  if (!validation.ok) {
    throw new Error(`应用凭证校验失败: ${validation.reason ?? 'unknown'}`);
  }

  const paths = resolveAppPaths({ rootDir: input.rootDir });
  const appPaths = resolveAppPaths({ rootDir: paths.rootDir, profile: name });
  const explicitWorkspace = input.workspace?.trim();
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const useExplicit = Boolean(
    explicitWorkspace && norm(explicitWorkspace) !== norm(appPaths.defaultWorkspaceDir),
  );

  await withConfigFileLock(paths.configFile, async () => {
    const root = await loadRootConfig(paths.configFile);
    if (root?.profiles[name]) throw new Error(`profile already exists: ${name}`);

    const encrypted = await storeEncryptedCredentials(
      input.appId.trim(),
      input.appSecret.trim(),
      tenant,
      appPaths,
    );
    const profileConfig = await createBootstrapProfileConfig({
      agentKind: agent as AgentKind,
      accounts: encrypted.accounts,
      preferences: encrypted.preferences,
      secrets: encrypted.secrets,
      workspace: useExplicit ? explicitWorkspace : undefined,
      defaultWorkspace: appPaths.defaultWorkspaceDir,
      profileDir: appPaths.profileDir,
    });

    if (root) {
      const nextRoot = {
        ...root,
        ...(encrypted.secrets ? { secrets: root.secrets ?? encrypted.secrets } : {}),
        profiles: {
          ...root.profiles,
          [name]: { ...profileConfig, secrets: undefined },
        },
      };
      await saveRootConfig(markPermissionDefaultsMigration(nextRoot, name), paths.configFile);
      return;
    }

    const freshRoot = createRootConfig(name, profileConfig, encrypted.secrets);
    await saveRootConfig(freshRoot, paths.configFile);
    await writeActiveProfile(paths.rootDir, name);
  });

  const saved = await loadRootConfig(paths.configFile);
  const workspace = saved?.profiles[name]?.workspaces?.default ?? appPaths.defaultWorkspaceDir;
  const botName = input.botName?.trim() || validation.botName;

  if (input.autoOnboard === false) {
    return {
      name,
      workspace,
      fleetRegistered: false,
      activated: false,
      started: false,
    };
  }

  const onboard = await onboardBotProfile({
    name,
    rootDir: paths.rootDir,
    workspace,
    botName,
  });

  return { name, workspace, ...onboard };
}

export async function activateBotProfile(name: string, rootDir?: string): Promise<void> {
  const err = validateProfileName(name);
  if (err) throw new Error(err);
  const trimmed = name.trim();
  const paths = resolveAppPaths({ rootDir });
  await withConfigFileLock(paths.configFile, async () => {
    const root = await loadRootConfig(paths.configFile);
    if (!root?.profiles[trimmed]) throw new Error(`profile not found: ${trimmed}`);
    root.activeProfile = trimmed;
    await saveRootConfig(root, paths.configFile);
    await writeActiveProfile(paths.rootDir, trimmed);
  });
}

export async function startBotProfile(name: string, rootDir?: string): Promise<void> {
  const err = validateProfileName(name);
  if (err) throw new Error(err);
  const env = rootDir
    ? { LARK_CHANNEL_HOME: resolveAppPaths({ rootDir }).rootDir }
    : undefined;
  await runBridgeCli(['start', '--profile', name.trim()], env);
}

export async function stopBotProfile(name: string, rootDir?: string): Promise<void> {
  const err = validateProfileName(name);
  if (err) throw new Error(err);
  const env = rootDir
    ? { LARK_CHANNEL_HOME: resolveAppPaths({ rootDir }).rootDir }
    : undefined;
  await runBridgeCli(['stop', '--profile', name.trim()], env);
}
