import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import type { FleetConfig } from '../fleet/schema';
import type { RunState } from '../card/run-renderer';
import { log } from '../core/logger';
import { canSendBotMention, recordBotMention } from './bot-loop-protection';
import { extractMentionsFromText } from './mention-extractor';
import { sendWithMentions } from './send-with-mentions';

type SendOpts = { replyTo?: string; replyInThread?: boolean };

function filterAllowedMentions(
  chatId: string,
  selfOpenId: string | undefined,
  at: Array<{ openId: string; name?: string }>,
): Array<{ openId: string; name?: string }> {
  if (!selfOpenId) return at;
  return at.filter((t) => canSendBotMention(chatId, selfOpenId, t.openId));
}

function recordMentions(
  chatId: string,
  selfOpenId: string | undefined,
  at: Array<{ openId: string }>,
): void {
  if (!selfOpenId) return;
  for (const t of at) recordBotMention(chatId, selfOpenId, t.openId);
}

/** Send agent reply; auto-convert `@bot名` to structured Feishu @ when fleet match found. */
export async function sendAgentMarkdown(
  channel: LarkChannel,
  chatId: string,
  markdown: string,
  fleet: FleetConfig,
  selfOpenId: string | undefined,
  sendOpts: SendOpts,
): Promise<void> {
  const trimmed = markdown.trim();
  if (!trimmed) return;

  const { at, body } = extractMentionsFromText(trimmed, fleet, { selfOpenId });
  const allowed = filterAllowedMentions(chatId, selfOpenId, at);

  if (at.length > 0 && allowed.length === 0) {
    log.warn('bot-loop', 'circuit-break', { chatId: chatId.slice(-6), blocked: at.length });
    await channel.send(chatId, { markdown: trimmed }, sendOpts);
    return;
  }

  if (allowed.length > 0) {
    const ok = await sendWithMentions(channel, chatId, {
      markdown: body,
      at: allowed,
      ...sendOpts,
    });
    if (ok) {
      recordMentions(chatId, selfOpenId, allowed);
      return;
    }
    log.warn('outbound-mentions', 'fallback-plain', { chatId: chatId.slice(-6) });
  }

  await channel.send(chatId, { markdown: trimmed }, sendOpts);
}

/** After stream/card delivery, send structured @ so target bots receive the message. */
export async function tryDispatchReplyMentions(
  channel: LarkChannel,
  chatId: string,
  text: string,
  fleet: FleetConfig,
  selfOpenId: string | undefined,
  sendOpts: SendOpts,
): Promise<void> {
  const { at, body } = extractMentionsFromText(text, fleet, { selfOpenId });
  if (at.length === 0) return;

  const allowed = filterAllowedMentions(chatId, selfOpenId, at);
  if (allowed.length === 0) {
    log.warn('bot-loop', 'circuit-break-reply', { chatId: chatId.slice(-6) });
    return;
  }

  const ok = await sendWithMentions(channel, chatId, {
    markdown: body,
    at: allowed,
    ...sendOpts,
  });
  if (ok) {
    recordMentions(chatId, selfOpenId, allowed);
  } else {
    log.warn('outbound-mentions', 'dispatch-failed', { chatId: chatId.slice(-6) });
  }
}

export async function tryDispatchReplyMentionsFromState(
  channel: LarkChannel,
  chatId: string,
  fleet: FleetConfig,
  state: RunState,
  selfOpenId: string | undefined,
  sendOpts: SendOpts,
): Promise<void> {
  const seen = new Set<string>();
  for (const block of state.blocks) {
    if (block.kind !== 'text') continue;
    const key = block.content;
    if (seen.has(key)) continue;
    seen.add(key);
    await tryDispatchReplyMentions(channel, chatId, block.content, fleet, selfOpenId, sendOpts);
  }
}
