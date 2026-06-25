import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute, basename } from 'node:path';
import { dirname } from 'node:path';
import { resolveAppPaths } from '../config/app-paths';
import { validateFleetConfig } from '../fleet/validate';
import { stopProcessEntry, type StopProcessEntryResult } from '../runtime/process-control';
import { resolveTarget } from '../runtime/registry';
import { checkAuth, loadOrCreateAdminToken } from './auth';
import {
  runFleetControlRestart,
  runFleetControlStart,
  runFleetControlStop,
} from './fleet-control';
import { validateChatId, validateScheduleCwd } from './validate';
import {
  getOverview,
  getProfilesDetail,
  getProcesses,
  getAllSchedules,
  getSecretsSummary,
  syncFleetOpenIds,
  tailLogFile,
  listLogFiles,
  loadFleetConfig,
  saveFleetConfig,
  collectFleetStatus,
  validateCron,
  addTask,
  removeTask,
  publicScheduleTask,
  resolveAllowedLogFile,
} from './services';
import {
  getBotsBoard,
  createBotProfile,
  activateBotProfile,
  startBotProfile,
  stopBotProfile,
  getBotProfileDefaults,
  ensureBotProfileDefaults,
} from './bots';
import {
  startRegisterSession,
  getRegisterSession,
  consumeRegisterSession,
  renderRegisterSessionQrPng,
} from './register-session';
import { moduleDirname } from './module-dir';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const MAX_BODY_BYTES = 1024 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

let adminListen: { host: string; port: number } | undefined;

export function getAdminListen(): { host: string; port: number } | undefined {
  return adminListen;
}

export interface AdminServerOptions {
  port?: number;
  host?: string;
  rootDir?: string;
}

export function adminStaticDir(): string {
  const fromEnv = process.env.BRIDGE_ADMIN_STATIC?.trim();
  if (fromEnv) return fromEnv;
  const here = moduleDirname();
  return join(here, 'admin', 'static');
}

function isPathInsideBase(filePath: string, baseDir: string): boolean {
  const base = resolve(baseDir);
  const file = resolve(filePath);
  const rel = relative(base, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function applySecurityHeaders(res: ServerResponse): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(k, v);
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  applySecurityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('payload too large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson<T>(raw: string): T | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const base = resolve(adminStaticDir());
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = resolve(base, `.${rel}`);
  if (!isPathInsideBase(file, base)) {
    json(res, 403, { error: 'forbidden' });
    return true;
  }
  try {
    const data = await readFile(file);
    const ext = extname(file);
    applySecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export async function startAdminServer(opts: AdminServerOptions = {}): Promise<{
  port: number;
  host: string;
  token: string;
  close: () => Promise<void>;
}> {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 3928;
  const rootDir = opts.rootDir;
  const token = await loadOrCreateAdminToken(rootDir);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      const authed = checkAuth(req.headers.authorization, token);
      if (!authed && pathname !== '/api/health') {
        json(res, 401, { error: 'unauthorized' });
        return;
      }

      try {
        await handleApi(req, res, pathname, url, rootDir);
      } catch (err) {
        const message = (err as Error).message;
        const status = message === 'payload too large' ? 413 : 500;
        json(res, status, { error: status === 500 ? 'internal error' : message });
      }
      return;
    }

    const served = await serveStatic(pathname, res);
    if (!served) {
      json(res, 404, { error: 'not found' });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveListen());
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  adminListen = { host, port: actualPort };

  return {
    port: actualPort,
    host,
    token,
    close: () => new Promise((resolveClose, reject) => {
      server.close((err) => (err ? reject(err) : resolveClose()));
    }),
  };
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  url: URL,
  rootDir?: string,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    const overview = await getOverview(rootDir);
    json(res, 200, {
      ok: true,
      ...(adminListen ?? {}),
      runtimeStats: overview.runtimeStats,
      runningCount: overview.runningCount,
    });
    return;
  }

  if (pathname === '/api/overview' && method === 'GET') {
    json(res, 200, {
      ...(await getOverview(rootDir)),
      console: adminListen ?? { host: '127.0.0.1', port: 3928 },
    });
    return;
  }

  if (pathname === '/api/profiles' && method === 'GET') {
    json(res, 200, await getProfilesDetail(rootDir));
    return;
  }

  if (pathname === '/api/bots' && method === 'GET') {
    json(res, 200, await getBotsBoard(rootDir));
    return;
  }

  if (pathname === '/api/bots/defaults' && method === 'GET') {
    const profile = url.searchParams.get('profile')?.trim();
    if (!profile) {
      json(res, 400, { error: 'profile required' });
      return;
    }
    try {
      json(res, 200, await ensureBotProfileDefaults(profile, rootDir));
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (pathname === '/api/bots' && method === 'POST') {
    const body = parseJson<{
      name?: string;
      agent?: string;
      workspace?: string;
      appId?: string;
      appSecret?: string;
      tenant?: string;
    }>(await readBody(req));
    if (!body?.name || !body.appId || !body.appSecret) {
      json(res, 400, { error: 'name, appId, appSecret required' });
      return;
    }
    try {
      const result = await createBotProfile({
        ...body,
        name: body.name,
        appId: body.appId,
        appSecret: body.appSecret,
        rootDir,
      });
      json(res, 201, { ok: true, ...result });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (pathname === '/api/bots/register/start' && method === 'POST') {
    const session = startRegisterSession();
    json(res, 201, { id: session.id, status: session.status, qrUrl: session.qrUrl, expireIn: session.expireIn });
    return;
  }

  const regMatch = pathname.match(/^\/api\/bots\/register\/([^/]+)$/);
  if (regMatch && method === 'GET') {
    const session = getRegisterSession(decodeURIComponent(regMatch[1]!));
    if (!session) {
      json(res, 404, { error: 'session not found' });
      return;
    }
    json(res, 200, session);
    return;
  }

  const regQrMatch = pathname.match(/^\/api\/bots\/register\/([^/]+)\/qrcode$/);
  if (regQrMatch && method === 'GET') {
    const png = await renderRegisterSessionQrPng(decodeURIComponent(regQrMatch[1]!));
    if (!png) {
      json(res, 404, { error: 'qr not ready' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(png);
    return;
  }

  const regCompleteMatch = pathname.match(/^\/api\/bots\/register\/([^/]+)\/complete$/);
  if (regCompleteMatch && method === 'POST') {
    const body = parseJson<{ name?: string; agent?: string; workspace?: string }>(await readBody(req));
    const session = consumeRegisterSession(decodeURIComponent(regCompleteMatch[1]!));
    if (!session?.appId || !session.appSecret) {
      json(res, 400, { error: 'registration not ready or already used' });
      return;
    }
    if (!body?.name) {
      json(res, 400, { error: 'name required' });
      return;
    }
    try {
      const result = await createBotProfile({
        name: body.name,
        agent: body.agent,
        workspace: body.workspace,
        appId: session.appId,
        appSecret: session.appSecret,
        tenant: session.tenant,
        botName: session.botName,
        rootDir,
      });
      json(res, 201, { ok: true, appId: session.appId, botName: session.botName, ...result });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  const botActionMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(use|start|stop)$/);
  if (botActionMatch && method === 'POST') {
    const profile = decodeURIComponent(botActionMatch[1]!);
    const action = botActionMatch[2];
    try {
      if (action === 'use') await activateBotProfile(profile, rootDir);
      else if (action === 'start') await startBotProfile(profile, rootDir);
      else await stopBotProfile(profile, rootDir);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (pathname === '/api/processes' && method === 'GET') {
    json(res, 200, await getProcesses(rootDir));
    return;
  }

  if (pathname === '/api/fleet' && method === 'GET') {
    const paths = resolveAppPaths({ rootDir });
    const fleet = await loadFleetConfig(paths.rootDir);
    const profileNames = [
      ...new Set([
        ...(fleet.autoStart ?? []),
        ...Object.values(fleet.bots ?? {}).map((b) => b.profile),
      ]),
    ].filter(Boolean);
    const status = profileNames.length > 0 ? await collectFleetStatus(profileNames) : [];
    json(res, 200, { config: fleet, status });
    return;
  }

  if (pathname === '/api/fleet' && method === 'PUT') {
    const body = parseJson<unknown>(await readBody(req));
    const validated = validateFleetConfig(body);
    if (!validated.ok) {
      json(res, 400, { error: validated.error });
      return;
    }
    const paths = resolveAppPaths({ rootDir });
    await saveFleetConfig(paths.rootDir, validated.config);
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/fleet/sync-openids' && method === 'POST') {
    const fleet = await syncFleetOpenIds(rootDir);
    json(res, 200, { ok: true, fleet });
    return;
  }

  if (pathname === '/api/fleet/start' && method === 'POST') {
    const body = parseJson<{ all?: boolean; profiles?: string[] }>(await readBody(req)) ?? {};
    try {
      const result = await runFleetControlStart(body, rootDir);
      json(res, 200, { ok: true, ...result });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
    return;
  }

  if (pathname === '/api/fleet/stop' && method === 'POST') {
    const body = parseJson<{ all?: boolean; profiles?: string[] }>(await readBody(req)) ?? {};
    try {
      const result = await runFleetControlStop(body, rootDir);
      json(res, 200, { ok: true, ...result });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
    return;
  }

  if (pathname === '/api/fleet/restart' && method === 'POST') {
    const body = parseJson<{ all?: boolean; profiles?: string[] }>(await readBody(req)) ?? {};
    try {
      const result = await runFleetControlRestart(body, rootDir);
      json(res, 200, { ok: true, ...result });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
    return;
  }

  if (pathname === '/api/schedules' && method === 'GET') {
    json(res, 200, await getAllSchedules(rootDir));
    return;
  }

  const scheduleDelete = pathname.match(/^\/api\/schedules\/([^/]+)\/([^/]+)$/);
  if (scheduleDelete && method === 'DELETE') {
    const [, profile, id] = scheduleDelete;
    const paths = resolveAppPaths({ rootDir, profile: decodeURIComponent(profile!) });
    const ok = await removeTask(paths.profileDir, decodeURIComponent(id!));
    json(res, ok ? 200 : 404, { ok });
    return;
  }

  const scheduleAdd = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (scheduleAdd && method === 'POST') {
    const [, profile] = scheduleAdd;
    const body = parseJson<{
      cron: string;
      prompt: string;
      chatId: string;
      cwd?: string;
      creatorId?: string;
      silent?: boolean;
      dispatch?: { target: string; prompt?: string };
    }>(await readBody(req));
    if (!body?.cron || !body.prompt || !body.chatId) {
      json(res, 400, { error: 'cron, prompt, chatId required' });
      return;
    }
    const chatErr = validateChatId(body.chatId);
    if (chatErr) {
      json(res, 400, { error: chatErr });
      return;
    }
    const cwdErr = validateScheduleCwd(body.cwd, rootDir);
    if (cwdErr) {
      json(res, 400, { error: cwdErr });
      return;
    }
    const cronErr = validateCron(body.cron);
    if (cronErr) {
      json(res, 400, { error: cronErr });
      return;
    }
    const paths = resolveAppPaths({ rootDir, profile: decodeURIComponent(profile!) });
    const task = await addTask(paths.profileDir, {
      cron: body.cron,
      prompt: body.prompt,
      chatId: body.chatId.trim(),
      cwd: body.cwd?.trim(),
      creatorId: body.creatorId ?? 'admin-console',
      silent: body.silent,
      dispatch: body.dispatch,
    });
    json(res, 201, publicScheduleTask(task));
    return;
  }

  if (pathname === '/api/secrets' && method === 'GET') {
    json(res, 200, await getSecretsSummary(rootDir));
    return;
  }

  const killMatch = pathname.match(/^\/api\/processes\/([^/]+)\/kill$/);
  if (killMatch && method === 'POST') {
    const target = decodeURIComponent(killMatch[1]!);
    const entry = resolveTarget(target);
    if (!entry) {
      json(res, 404, { error: 'process not found' });
      return;
    }
    const result: StopProcessEntryResult = await stopProcessEntry(entry);
    json(res, 200, { ok: true, result });
    return;
  }

  const logsMatch = pathname.match(/^\/api\/logs\/([^/]+)$/);
  if (logsMatch && method === 'GET') {
    const profile = decodeURIComponent(logsMatch[1]!);
    const paths = resolveAppPaths({ rootDir, profile });
    const file = url.searchParams.get('file');
    const lines = Number(url.searchParams.get('lines') ?? '80');
    if (!file) {
      const files = await listLogFiles(paths.profileDir);
      json(res, 200, { files: files.map((f) => basename(f)) });
      return;
    }
    const allowed = await resolveAllowedLogFile(paths.profileDir, decodeURIComponent(file));
    if (!allowed) {
      json(res, 403, { error: 'invalid log file' });
      return;
    }
    json(res, 200, { content: await tailLogFile(allowed, lines) });
    return;
  }

  json(res, 404, { error: 'not found' });
}
