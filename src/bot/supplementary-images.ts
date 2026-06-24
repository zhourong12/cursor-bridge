import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log } from '../core/logger';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const FILE_PATH_JSON = /"file_path"\s*:\s*"((?:[^"\\]|\\.)+)"/gi;
const WIN_ABS_IMAGE = /([A-Za-z]:\\[^\s"']+\.(?:png|jpe?g|gif|webp))/gi;
const POSIX_ABS_IMAGE = /(\/(?:[^\s"']+\/)*[^\s"']+\.(?:png|jpe?g|gif|webp))/gi;

export interface SupplementaryImageSendOpts {
  replyTo?: string;
  replyInThread?: boolean;
}

export interface SendSupplementaryImagesInput {
  channel: LarkChannel;
  chatId: string;
  sendOpts: SupplementaryImageSendOpts;
  cwd: string;
  profileDir: string;
  larkCliConfigDir?: string;
  runStartedAt: number;
  stateToolOutputs: Iterable<string>;
  collectedPaths: Iterable<string>;
}

/** Extract local image file paths mentioned in tool stdout/stderr. */
export function extractLocalImagePaths(text: string, cwd: string): string[] {
  if (!text.trim()) return [];
  const found = new Set<string>();

  for (const match of text.matchAll(FILE_PATH_JSON)) {
    addCandidate(found, unescapeJsonPath(match[1]!), cwd);
  }
  for (const match of text.matchAll(WIN_ABS_IMAGE)) {
    addCandidate(found, match[1]!, cwd);
  }
  for (const match of text.matchAll(POSIX_ABS_IMAGE)) {
    addCandidate(found, match[1]!, cwd);
  }

  return [...found];
}

function unescapeJsonPath(raw: string): string {
  return raw.replace(/\\([\\"/bfnrt])/g, (_, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    return ch;
  });
}

function addCandidate(out: Set<string>, raw: string, cwd: string): void {
  const trimmed = raw.trim();
  if (!trimmed || !IMAGE_EXT.test(trimmed)) return;
  out.add(isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed));
}

function isUnderRoot(path: string, root: string): boolean {
  const abs = resolve(path);
  const base = resolve(root);
  return abs === base || abs.startsWith(base + sep);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolve, de-dupe, and keep only run-scoped images under allowed roots. */
export async function resolveSupplementaryImages(input: {
  cwd: string;
  profileDir: string;
  runStartedAt: number;
  stateToolOutputs: Iterable<string>;
  collectedPaths: Iterable<string>;
}): Promise<string[]> {
  const allowedRoots = [resolve(input.cwd), resolve(input.profileDir)];
  const candidates = new Set<string>();

  for (const raw of input.collectedPaths) {
    addCandidate(candidates, raw, input.cwd);
  }
  for (const text of input.stateToolOutputs) {
    for (const p of extractLocalImagePaths(text, input.cwd)) {
      candidates.add(p);
    }
  }

  for (const wellKnown of [
    join(input.profileDir, 'lark-auth', 'lark-auth-qrcode.png'),
    join(input.cwd, 'lark-auth-qrcode.png'),
    join(input.cwd, 'oauth-qrcode.png'),
  ]) {
    addCandidate(candidates, wellKnown, input.cwd);
  }

  const out: string[] = [];
  const minMtime = input.runStartedAt - 5_000;
  for (const path of candidates) {
    if (!allowedRoots.some((root) => isUnderRoot(path, root))) continue;
    if (!(await pathExists(path))) continue;
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size <= 0) continue;
      if (info.mtimeMs < minMtime) continue;
      out.push(path);
    } catch {
      /* skip unreadable paths */
    }
  }
  return [...new Set(out)];
}

async function uploadImageKey(channel: LarkChannel, path: string): Promise<string | undefined> {
  const created = await channel.rawClient.im.v1.image.create({
    data: {
      image_type: 'message',
      image: createReadStream(path),
    },
  });
  return (created as { data?: { image_key?: string } }).data?.image_key;
}

async function sendImageMessage(
  channel: LarkChannel,
  chatId: string,
  imageKey: string,
  sendOpts: SupplementaryImageSendOpts,
): Promise<void> {
  const content = JSON.stringify({ image_key: imageKey });
  if (sendOpts.replyTo) {
    await channel.rawClient.im.v1.message.reply({
      path: { message_id: sendOpts.replyTo },
      data: {
        msg_type: 'image',
        content,
        ...(sendOpts.replyInThread ? { reply_in_thread: true } : {}),
      },
    });
    return;
  }
  await channel.rawClient.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'image',
      content,
    },
  });
}

/** Upload and send one local image as a separate IM message. */
export async function sendLocalImage(
  channel: LarkChannel,
  chatId: string,
  path: string,
  sendOpts: SupplementaryImageSendOpts,
  larkCliConfigDir?: string,
): Promise<boolean> {
  try {
    if (!(await pathExists(path))) return false;
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) return false;
    const imageKey = await uploadImageKey(channel, path);
    if (imageKey) {
      await sendImageMessage(channel, chatId, imageKey, sendOpts);
      log.info('supplementary-image', 'sent', { path: basename(path) });
      return true;
    }
    log.warn('supplementary-image', 'upload-no-key', { path });
  } catch (err) {
    log.fail('supplementary-image', err, { path });
  }
  if (larkCliConfigDir) {
    const { sendLarkCliBotImage } = await import('./lark-cli-im');
    return sendLarkCliBotImage({ larkCliConfigDir, chatId, imagePath: path });
  }
  return false;
}

/** Post local image files as separate IM messages (markdown mode supplement). */
export async function sendSupplementaryImages(input: SendSupplementaryImagesInput): Promise<number> {
  const paths = await resolveSupplementaryImages(input);
  if (paths.length === 0) return 0;

  let sent = 0;
  for (const path of paths) {
    if (await sendLocalImage(input.channel, input.chatId, path, input.sendOpts, input.larkCliConfigDir)) {
      sent += 1;
    }
  }
  return sent;
}
