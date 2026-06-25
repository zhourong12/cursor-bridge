import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export function adminTokenPath(rootDir?: string): string {
  const root = rootDir ?? process.env.LARK_CHANNEL_HOME ?? join(homedir(), '.lark-channel');
  return join(root, 'admin-token');
}

export async function loadOrCreateAdminToken(rootDir?: string): Promise<string> {
  const env = process.env.LARK_BRIDGE_ADMIN_TOKEN?.trim();
  if (env) return env;
  const path = adminTokenPath(rootDir);
  try {
    const raw = await readFile(path, 'utf8');
    const token = raw.trim();
    if (token) return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const token = randomBytes(24).toString('hex');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  return token;
}

export function checkAuth(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice(7).trim();
  if (!provided || provided.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch {
    return false;
  }
}
