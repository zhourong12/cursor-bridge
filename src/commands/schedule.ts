import type { CommandContext } from './index.js';
import { resolveAppPaths } from '../config/app-paths';
import { resolveWorkingDirectory } from '../policy/workspace';
import { addTask, loadSchedules, removeTask } from '../schedule/store';
import { validateCron } from '../schedule/cron-match';

async function reply(ctx: CommandContext, markdown: string): Promise<void> {
  await ctx.channel.send(ctx.msg.chatId, { markdown }, { replyTo: ctx.msg.messageId });
}

export async function handleSchedule(args: string, ctx: CommandContext): Promise<void> {
  if (ctx.controls.profileConfig.agentKind !== 'cursor') {
    await reply(ctx, '`/schedule` 仅适用于 Cursor profile。');
    return;
  }

  const profileDir = resolveAppPaths({ profile: ctx.controls.profile }).profileDir;
  const trimmed = args.trim();

  if (!trimmed || trimmed === 'help') {
    await reply(
      ctx,
      [
        '**定时任务**（进程内调度，bridge 常驻时生效）',
        '',
        '- `/schedule add <分> <时> <日> <月> <周> <prompt...>` — 登记任务',
        '- 可选后缀：`--silent`（不发结果）、`--dispatch @bot名`（完成后委派给另一 bot）',
        '- `/schedule list` — 查看本 profile 任务',
        '- `/schedule remove <id>` — 删除任务',
        '',
        '示例：`/schedule add 0 9 * * * 巡检仓库并总结变更`',
        '（每天 9:00 在本会话发回 Agent 结果）',
        '',
        '也可用自然语言描述需求，我会帮你生成对应的 `/schedule add` 命令。',
      ].join('\n'),
    );
    return;
  }

  const [sub, ...rest] = trimmed.split(/\s+/);
  if (sub === 'list') {
    const store = await loadSchedules(profileDir);
    if (store.tasks.length === 0) {
      await reply(ctx, '当前没有定时任务。');
      return;
    }
    const lines = store.tasks.map(
      (t) =>
        `- \`${t.id}\` cron=\`${t.cron}\` chat=\`...${t.chatId.slice(-8)}\` prompt=${t.prompt.slice(0, 40)}${t.prompt.length > 40 ? '…' : ''}`,
    );
    await reply(ctx, ['**定时任务列表**', '', ...lines].join('\n'));
    return;
  }

  if (sub === 'remove') {
    const id = rest[0]?.trim();
    if (!id) {
      await reply(ctx, '用法：`/schedule remove <id>`');
      return;
    }
    const ok = await removeTask(profileDir, id);
    await reply(ctx, ok ? `已删除定时任务 \`${id}\`` : `未找到任务 \`${id}\``);
    return;
  }

  if (sub === 'add') {
    let raw = rest.join(' ').trim();
    let silent = false;
    let dispatchTarget: string | undefined;
    const silentIdx = raw.indexOf('--silent');
    if (silentIdx >= 0) {
      silent = true;
      raw = (raw.slice(0, silentIdx) + raw.slice(silentIdx + '--silent'.length)).trim();
    }
    const dispatchMatch = raw.match(/--dispatch\s+(\S+)/);
    if (dispatchMatch) {
      dispatchTarget = dispatchMatch[1]?.replace(/^@/, '');
      raw = raw.replace(dispatchMatch[0], '').trim();
    }
    const parts = raw.split(/\s+/);
    if (parts.length < 6) {
      await reply(
        ctx,
        '用法：`/schedule add <分> <时> <日> <月> <周> <prompt...>`\n示例：`/schedule add 0 9 * * * 巡检仓库`',
      );
      return;
    }
    const cron = parts.slice(0, 5).join(' ');
    const prompt = parts.slice(5).join(' ').trim();
    const cronErr = validateCron(cron);
    if (cronErr) {
      await reply(ctx, `cron 无效：${cronErr}`);
      return;
    }
    if (!prompt) {
      await reply(ctx, '请提供任务 prompt。');
      return;
    }

    const cwd =
      ctx.workspaces.cwdFor(ctx.scope) ??
      ctx.controls.profileConfig.workspaces.default ??
      undefined;
    let cwdRealpath = cwd;
    if (cwd) {
      const resolved = await resolveWorkingDirectory(cwd);
      if (resolved.ok) cwdRealpath = resolved.cwdRealpath;
    }

    const task = await addTask(profileDir, {
      cron,
      prompt,
      chatId: ctx.msg.chatId,
      cwd: cwdRealpath,
      creatorId: ctx.msg.senderId,
      ...(silent ? { silent: true } : {}),
      ...(dispatchTarget ? { dispatch: { target: dispatchTarget } } : {}),
    });
    await reply(
      ctx,
      [
        `已登记定时任务 \`${task.id}\``,
        `- cron: \`${cron}\``,
        `- 工作区: \`${cwdRealpath ?? '默认'}\``,
        `- 结果将发回本会话`,
        ...(silent ? ['- 静默: 是（不向飞书发结果）'] : []),
        ...(dispatchTarget ? [`- 委派: \`${dispatchTarget}\`（完成后结构化 @）`] : []),
        '',
        '删除：`/schedule remove ' + task.id + '`',
      ].join('\n'),
    );
    return;
  }

  await reply(ctx, '未知子命令。发送 `/schedule help` 查看用法。');
}
