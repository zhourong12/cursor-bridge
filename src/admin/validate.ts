import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { resolveAppPaths } from '../config/app-paths';

const CHAT_ID_RE = /^oc_[a-zA-Z0-9]+$/;
const PROFILE_RE = /^[A-Za-z0-9._-]+$/;

export function validateProfileName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'profile name required';
  if (!PROFILE_RE.test(trimmed)) return 'profile name invalid';
  return undefined;
}

export function isPathInsideBase(filePath: string, baseDir: string): boolean {
  const base = resolve(baseDir);
  const file = resolve(filePath);
  const rel = relative(base, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function validateChatId(chatId: string): string | undefined {
  const trimmed = chatId.trim();
  if (!CHAT_ID_RE.test(trimmed)) return 'chatId must match oc_xxx format';
  return undefined;
}

export function validateScheduleCwd(cwd: string | undefined, rootDir?: string): string | undefined {
  if (!cwd?.trim()) return undefined;
  const paths = resolveAppPaths({ rootDir });
  const resolved = resolve(cwd.trim());
  if (!existsSync(resolved)) return 'cwd does not exist';
  const workspacesRoot = resolve(`${paths.rootDir}-workspaces`);
  if (!isPathInsideBase(resolved, workspacesRoot) && !isPathInsideBase(resolved, paths.rootDir)) {
    return 'cwd must be under bridge workspaces or lark-channel home';
  }
  return undefined;
}
