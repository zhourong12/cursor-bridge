import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log } from '../core/logger';

export interface MentionTarget {
  openId: string;
  name?: string;
}

export interface SendWithMentionsOpts {
  markdown: string;
  at: MentionTarget[];
  replyTo?: string;
  replyInThread?: boolean;
}

/** Build Feishu post JSON with structured @ mentions at the start. */
export function buildPostContentWithMentions(body: string, at: MentionTarget[]): string {
  const line: object[] = [];
  for (const target of at) {
    line.push({
      tag: 'at',
      user_id: target.openId,
      user_name: target.name ?? target.openId,
    });
  }
  if (body.trim()) {
    line.push({ tag: 'text', text: ` ${body.trim()}` });
  }
  return JSON.stringify({
    zh_cn: {
      content: [line],
    },
  });
}

/** Send a post message with structured @ mentions so target bots receive the message. */
export async function sendWithMentions(
  channel: LarkChannel,
  chatId: string,
  opts: SendWithMentionsOpts,
): Promise<boolean> {
  if (opts.at.length === 0) return false;
  const content = buildPostContentWithMentions(opts.markdown, opts.at);
  try {
    if (opts.replyTo) {
      await channel.rawClient.im.v1.message.reply({
        path: { message_id: opts.replyTo },
        data: {
          msg_type: 'post',
          content,
          ...(opts.replyInThread ? { reply_in_thread: true } : {}),
        },
      });
    } else {
      await channel.rawClient.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'post',
          content,
        },
      });
    }
    log.info('send-mentions', 'sent', {
      chatId: chatId.slice(-6),
      at: opts.at.map((t) => t.openId.slice(-6)),
    });
    return true;
  } catch (err) {
    log.fail('send-mentions', err, { chatId: chatId.slice(-6) });
    return false;
  }
}
