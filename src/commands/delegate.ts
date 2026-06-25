import type { CommandContext } from './index.js';
import { loadFleetConfig, resolveFleetBot } from '../fleet/load';
import { resolveAppPaths } from '../config/app-paths';
import { sendWithMentions } from '../bot/send-with-mentions';

async function reply(ctx: CommandContext, markdown: string): Promise<void> {
  await ctx.channel.send(ctx.msg.chatId, { markdown }, { replyTo: ctx.msg.messageId });
}

/** `/delegate @测匠 请验收` — bridge 代发结构化 @mention */
export async function handleDelegate(args: string, ctx: CommandContext): Promise<void> {
  const trimmed = args.trim();
  if (!trimmed) {
    await reply(
      ctx,
      '用法：`/delegate @bot名 任务描述`\n示例：`/delegate @测匠 请验收 U3/U4`',
    );
    return;
  }

  const rootDir = resolveAppPaths({ profile: ctx.controls.profile }).rootDir;
  const fleet = await loadFleetConfig(rootDir);

  let targetToken = '';
  let body = trimmed;
  const atMatch = trimmed.match(/^@(\S+)\s+(.*)$/s);
  if (atMatch) {
    targetToken = atMatch[1] ?? '';
    body = (atMatch[2] ?? '').trim();
  } else {
    const parts = trimmed.split(/\s+/);
    targetToken = parts[0] ?? '';
    body = parts.slice(1).join(' ').trim();
  }

  if (!targetToken || !body) {
    await reply(ctx, '用法：`/delegate @bot名 任务描述`');
    return;
  }

  const resolved = resolveFleetBot(fleet, targetToken.replace(/^@/, ''));
  if (!resolved?.entry.openId) {
    await reply(
      ctx,
      `未在 fleet.json 找到 bot「${targetToken}」的 open_id。请在 \`~/.lark-channel/fleet.json\` 配置 bots.${targetToken}.openId`,
    );
    return;
  }

  const ok = await sendWithMentions(ctx.channel, ctx.msg.chatId, {
    markdown: body,
    at: [{ openId: resolved.entry.openId, name: resolved.name }],
    replyTo: ctx.msg.messageId,
    ...(ctx.chatMode === 'topic' && ctx.msg.threadId ? { replyInThread: true } : {}),
  });

  if (ok) {
    await reply(ctx, `已委派给 **${resolved.name}**（结构化 @ 已发送）`);
  } else {
    await reply(ctx, `委派失败，请检查 bot 发消息权限。`);
  }
}
