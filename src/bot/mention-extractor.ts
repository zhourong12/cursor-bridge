import type { FleetConfig } from '../fleet/schema';
import { resolveFleetBot } from '../fleet/load';
import type { MentionTarget } from './send-with-mentions';

const MENTION_RE = /@([\u4e00-\u9fffA-Za-z0-9_-]+)/g;

export interface ExtractedMentions {
  at: MentionTarget[];
  body: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Scan agent reply for `@bot名` tokens; resolve via fleet.json (display name or profile key). */
export function extractMentionsFromText(
  text: string,
  fleet: FleetConfig,
  opts?: { selfOpenId?: string },
): ExtractedMentions {
  const at: MentionTarget[] = [];
  const seenOpenIds = new Set<string>();
  const tokensToStrip = new Set<string>();

  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const token = m[1] ?? '';
    const resolved = resolveFleetBot(fleet, token);
    if (!resolved?.entry.openId) continue;
    if (opts?.selfOpenId && resolved.entry.openId === opts.selfOpenId) continue;
    tokensToStrip.add(token);
    if (seenOpenIds.has(resolved.entry.openId)) continue;
    seenOpenIds.add(resolved.entry.openId);
    at.push({
      openId: resolved.entry.openId,
      name: resolved.entry.name ?? resolved.name,
    });
  }

  let body = text;
  for (const token of tokensToStrip) {
    body = body.replace(new RegExp(`@${escapeRegExp(token)}`, 'g'), '');
  }
  body = body.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return { at, body: body || text.trim() };
}
