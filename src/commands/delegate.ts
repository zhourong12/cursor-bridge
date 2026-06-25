import type { CommandContext } from './index.js';
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { loadFleetConfig, resolveFleetBot } from '../fleet/load';
import type { FleetConfig } from '../fleet/schema';
import { resolveAppPaths } from '../config/app-paths';
import { sendWithMentions } from '../bot/send-with-mentions';

async function reply(ctx: CommandContext, markdown: string): Promise<void> {
  await ctx.channel.send(ctx.msg.chatId, { markdown }, { replyTo: ctx.msg.messageId });
}

export async function sendDelegateToBot(
  channel: LarkChannel,
  chatId: string,
  fleet: FleetConfig,
  targetToken: string,
  body: string,
  sendOpts: { replyTo?: string; replyInThread?: boolean },
): Promise<{ ok: boolean; resolvedName?: string; error?: string }> {
  const cleanName = targetToken.replace(/^@/, '');
  const resolved = resolveFleetBot(fleet, cleanName);
  if (!resolved?.entry.openId) {
    return { ok: false, error: `no open_id for ${cleanName}` };
  }
  const displayName = resolved.entry.name ?? resolved.name;
  const ok = await sendWithMentions(channel, chatId, {
    markdown: body,
    at: [{ openId: resolved.entry.openId, name: displayName }],
    ...sendOpts,
  });
  return { ok, resolvedName: displayName };
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

  const result = await sendDelegateToBot(
    ctx.channel,
    ctx.msg.chatId,
    fleet,
    targetToken,
    body,
    {
      replyTo: ctx.msg.messageId,
      ...(ctx.chatMode === 'topic' && ctx.msg.threadId ? { replyInThread: true } : {}),
    },
  );

  if (!result.ok && result.error?.startsWith('no open_id')) {
    const cleanName = targetToken.replace(/^@/, '');
    await reply(
      ctx,
      `未找到 bot「${cleanName}」的 open_id。每个 bot 启动时会自动把自己的 open_id 写入 \`~/.lark-channel/fleet.json\` 的 bots 段；请确认「${cleanName}」对应的 bridge 已上线（fleet status），或手动在 fleet.json 配置 bots.${cleanName}.openId。注意：open_id 同一企业内跨群通用，只需登记一次。`,
    );
    return;
  }

  if (result.ok) {
    await reply(ctx, `已委派给 **${result.resolvedName}**（结构化 @ 已发送）`);
  } else {
    await reply(ctx, `委派失败，请检查 bot 发消息权限，或目标 bot 是否在本群内。`);
  }
}
