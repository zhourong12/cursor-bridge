import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log } from '../core/logger';
import { mergeProcessEnv, spawnProcess } from '../platform/spawn';
import { sendLarkCliBotImage, sendLarkCliBotMarkdown } from './lark-cli-im';
import { sendLocalImage, type SupplementaryImageSendOpts } from './supplementary-images';

const OAUTH_URL =
  /https:\/\/accounts\.(?:feishu|lark)\.(?:cn|com)\/oauth\/v1\/device\/verify[^\s"'<>]*/i;

export interface OAuthHint {
  deviceCode: string;
  verificationUrl: string;
  userCode?: string;
}

export interface SendSupplementaryAuthInput {
  channel: LarkChannel;
  chatId: string;
  sendOpts: SupplementaryImageSendOpts;
  profileDir: string;
  larkCliConfigDir: string;
  runTexts: Iterable<string>;
}

export interface AuthDeliveryGate {
  delivered: boolean;
}

/** Send auth links at most once per run (tool_result or run end). */
export async function deliverSupplementaryAuthOnce(
  gate: AuthDeliveryGate,
  input: Omit<SendSupplementaryAuthInput, 'runTexts'>,
  runTexts: Iterable<string>,
): Promise<boolean> {
  if (gate.delivered) return false;
  const sent = await sendSupplementaryAuth({ ...input, runTexts });
  if (sent) gate.delivered = true;
  return sent;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, '').trim()) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function unescapeJsonString(raw: string): string {
  return raw.replace(/\\([\\"/bfnrtu])/g, (_, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    if (ch === 'u') return '\\u';
    return ch;
  });
}

function extractFromJson(text: string): OAuthHint | undefined {
  const json = parseJsonObject(text);
  if (!json) return undefined;
  const deviceCode = stringField(json, 'device_code') ?? stringField(json, 'deviceCode');
  const verificationUrl =
    stringField(json, 'verification_url') ??
    stringField(json, 'verification_uri_complete') ??
    stringField(json, 'verification_uri') ??
    stringField(json, 'verificationUrl');
  if (!deviceCode || !verificationUrl) return undefined;
  return {
    deviceCode,
    verificationUrl,
    userCode: stringField(json, 'user_code') ?? stringField(json, 'userCode'),
  };
}

function extractFromRegex(text: string): OAuthHint | undefined {
  const urlMatch = text.match(OAUTH_URL);
  if (!urlMatch) return undefined;
  const verificationUrl = urlMatch[0]!.replace(/\\u0026/g, '&');
  const deviceMatch = text.match(/"(?:device_code|deviceCode)"\s*:\s*("(?:[^"\\]|\\.)+")/i);
  if (!deviceMatch) return undefined;
  const deviceCode = unescapeJsonString(deviceMatch[1]!.slice(1, -1));
  if (!deviceCode) return undefined;
  const userMatch = text.match(/"(?:user_code|userCode)"\s*:\s*("(?:[^"\\]|\\.)+")/i);
  const userCode = userMatch ? unescapeJsonString(userMatch[1]!.slice(1, -1)) : undefined;
  return { deviceCode, verificationUrl, userCode };
}

/** Scan run output for lark-cli OAuth device-flow hints. */
export function extractOAuthHint(texts: Iterable<string>): OAuthHint | undefined {
  for (const text of texts) {
    if (!text.trim()) continue;
    const fromJson = extractFromJson(text);
    if (fromJson) return fromJson;
    const fromRegex = extractFromRegex(text);
    if (fromRegex) return fromRegex;
  }
  return undefined;
}

/** Collect missing OAuth scopes reported by lark-cli tool errors. */
export function extractMissingScopes(texts: Iterable<string>): string[] {
  const scopes = new Set<string>();
  for (const text of texts) {
    if (!text.trim()) continue;
    collectMissingScopesFromJson(parseJsonObject(text), scopes);
    for (const match of text.matchAll(/"missing_scopes"\s*:\s*\[([^\]]*)\]/gi)) {
      for (const item of match[1]!.matchAll(/"([^"]+)"/g)) {
        scopes.add(item[1]!);
      }
    }
  }
  return [...scopes];
}

function collectMissingScopesFromJson(
  json: Record<string, unknown> | undefined,
  out: Set<string>,
): void {
  if (!json) return;
  const error = json.error;
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const missing = (error as Record<string, unknown>).missing_scopes;
    if (Array.isArray(missing)) {
      for (const scope of missing) {
        if (typeof scope === 'string' && scope) out.add(scope);
      }
    }
  }
  if (Array.isArray(json.missing_scopes)) {
    for (const scope of json.missing_scopes) {
      if (typeof scope === 'string' && scope) out.add(scope);
    }
  }
}

const CONSOLE_URL =
  /https:\/\/open\.(?:feishu|larksuite)\.(?:cn|com)\/app\/[^\s"'<>]+/i;

/** Collect bot app developer-console URLs from lark-cli scope errors. */
export function extractConsoleUrl(texts: Iterable<string>): string | undefined {
  for (const text of texts) {
    if (!text.trim()) continue;
    const json = parseJsonObject(text);
    const fromError = stringField(
      json?.error && typeof json.error === 'object' && !Array.isArray(json.error)
        ? (json.error as Record<string, unknown>)
        : undefined,
      'console_url',
    );
    if (fromError) return fromError;
    const top = stringField(json, 'console_url');
    if (top) return top;
    const match = text.match(CONSOLE_URL);
    if (match) return match[0]!.replace(/\\u0026/g, '&');
  }
  return undefined;
}

async function runLarkCliWithOutput(
  larkCliConfigDir: string,
  args: string[],
  cwd?: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const env = mergeProcessEnv(process.env, {
    LARKSUITE_CLI_CONFIG_DIR: join(larkCliConfigDir, 'lark-channel'),
  });
  return new Promise((resolve) => {
    const child = spawnProcess('lark-cli', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ exitCode: null, stdout, stderr });
    }, 60_000);
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

async function createOAuthHintForScopes(
  larkCliConfigDir: string,
  scopes: string[],
): Promise<OAuthHint | undefined> {
  if (scopes.length === 0) return undefined;
  await runLarkCliWithOutput(larkCliConfigDir, ['config', 'strict-mode', 'off']);
  await runLarkCliWithOutput(larkCliConfigDir, ['config', 'default-as', 'auto']);
  const result = await runLarkCliWithOutput(larkCliConfigDir, [
    'auth',
    'login',
    '--scope',
    scopes.join(' '),
    '--no-wait',
    '--json',
  ]);
  return extractFromJson(result.stdout);
}

async function runLarkCli(
  larkCliConfigDir: string,
  args: string[],
  cwd?: string,
): Promise<number | null> {
  const env = mergeProcessEnv(process.env, {
    LARKSUITE_CLI_CONFIG_DIR: join(larkCliConfigDir, 'lark-channel'),
  });
  return new Promise((resolve) => {
    const child = spawnProcess('lark-cli', args, { cwd, env, stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(null);
    }, 60_000);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function persistPending(profileDir: string, hint: OAuthHint): Promise<void> {
  const authDir = join(profileDir, 'lark-auth');
  await mkdir(authDir, { recursive: true });
  await writeFile(
    join(authDir, 'pending.json'),
    `${JSON.stringify(
      {
        deviceCode: hint.deviceCode,
        verificationUrl: hint.verificationUrl,
        ...(hint.userCode ? { userCode: hint.userCode } : {}),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

async function ensureAuthQrcode(
  profileDir: string,
  larkCliConfigDir: string,
  verificationUrl: string,
): Promise<string> {
  const authDir = join(profileDir, 'lark-auth');
  await mkdir(authDir, { recursive: true });
  await runLarkCli(larkCliConfigDir, ['config', 'strict-mode', 'off']);
  await runLarkCli(larkCliConfigDir, ['config', 'default-as', 'auto']);
  await runLarkCli(
    larkCliConfigDir,
    ['auth', 'qrcode', verificationUrl, '--output', './lark-auth-qrcode.png'],
    authDir,
  );
  return join(authDir, 'lark-auth-qrcode.png');
}

/** After a markdown run, send OAuth link + QR when tool output contains device-flow data. */
export async function sendSupplementaryAuth(input: SendSupplementaryAuthInput): Promise<boolean> {
  let hint = extractOAuthHint(input.runTexts);
  const missingScopes = extractMissingScopes(input.runTexts);
  const consoleUrl = extractConsoleUrl(input.runTexts);

  if (!hint && missingScopes.length > 0) {
    hint = await createOAuthHintForScopes(input.larkCliConfigDir, missingScopes);
    log.info('supplementary-auth', 'missing-scope-auth', { scopes: missingScopes.length });
  }

  let sent = false;

  if (consoleUrl) {
    const scopeLine =
      missingScopes.length > 0 ? `\n\n缺失 scope：\`${missingScopes.join('`, `')}\`` : '';
    const body = [
      '**bot 应用权限（开放平台）**',
      '',
      '需应用管理员在开放平台为 bot 开通以下权限：',
      consoleUrl,
      scopeLine,
    ].join('\n');
    try {
      await sendLarkCliBotMarkdown({
        larkCliConfigDir: input.larkCliConfigDir,
        chatId: input.chatId,
        markdown: body,
      });
      sent = true;
      log.info('supplementary-auth', 'console-url-sent', { scopes: missingScopes.length });
    } catch (err) {
      log.fail('supplementary-auth', err, { step: 'send-console-url' });
    }
  }

  if (!hint) return sent;

  try {
    await persistPending(input.profileDir, hint);
  } catch (err) {
    log.fail('supplementary-auth', err, { step: 'persist-pending' });
  }

  const body = [
    '**lark-cli 用户授权**',
    '',
    hint.verificationUrl,
    '',
    '请浏览器打开或扫下方二维码完成授权，完成后发送：`/lark-auth done`',
  ].join('\n');

  try {
    await sendLarkCliBotMarkdown({
      larkCliConfigDir: input.larkCliConfigDir,
      chatId: input.chatId,
      markdown: body,
    });
  } catch (err) {
    log.fail('supplementary-auth', err, { step: 'send-link' });
    return false;
  }

  const qrPath = await ensureAuthQrcode(input.profileDir, input.larkCliConfigDir, hint.verificationUrl);
  const qrSent = await sendLarkCliBotImage({
    larkCliConfigDir: input.larkCliConfigDir,
    chatId: input.chatId,
    imagePath: qrPath,
  });
  if (!qrSent) {
    await sendLocalImage(input.channel, input.chatId, qrPath, input.sendOpts, input.larkCliConfigDir);
  }
  log.info('supplementary-auth', qrSent ? 'sent' : 'link-only', { hasQr: qrSent });
  return true;
}
