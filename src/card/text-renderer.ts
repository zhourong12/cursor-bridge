import type { Block, RunState, ToolEntry } from './run-state';
import { toolHeaderText } from './tool-render';

/**
 * Render `RunState` as plain markdown text — used in `messageReply: 'markdown'`
 * mode where we stream a markdown message instead of a card.
 *
 * Differences vs `renderCard`:
 *   - No collapsible panels, no buttons (markdown messages have neither)
 *   - Tool calls collapse to a single short line each (no body)
 *   - Reasoning is rendered as a blockquote section (no fold UI in Feishu markdown)
 *   - Footer is appended inline at the bottom while running
 */
const REASONING_MAX = 4000;

export function renderText(state: RunState): string {
  const parts: string[] = [];

  const reasoningMd = renderReasoning(state.reasoning);
  if (reasoningMd) parts.push(reasoningMd);

  for (const block of state.blocks) {
    const piece = renderBlock(block);
    if (piece) parts.push(piece);
  }

  if (state.terminal === 'interrupted') {
    parts.push('_⏹ 已被中断_');
  } else if (state.terminal === 'idle_timeout') {
    const mins = state.idleTimeoutMinutes ?? 0;
    parts.push(`_⏱ ${mins} 分钟无响应,已自动终止_`);
  } else if (state.terminal === 'error' && state.errorMsg) {
    parts.push(`⚠️ agent 失败:${state.errorMsg}`);
  } else if (state.terminal === 'running' && state.footer && shouldShowFooter(state)) {
    parts.push(footerLine(state.footer));
  }

  return parts.join('\n\n');
}

function shouldShowFooter(state: RunState): boolean {
  if (state.footer !== 'thinking') return true;
  return !state.reasoning.active && !state.reasoning.content.trim();
}

function renderReasoning(reasoning: RunState['reasoning']): string | null {
  const content = reasoning.content.trim();
  if (!content && !reasoning.active) return null;

  const title = reasoning.active ? '🧠 **思考中**' : '🧠 **思考过程**';
  if (!content) return `_${title}…_`;

  const body = truncate(content, REASONING_MAX)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `> ${title}\n>\n${body}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function renderBlock(block: Block): string {
  if (block.kind === 'text') {
    return block.content.trim();
  }
  return toolLine(block.tool);
}

/**
 * One-line summary for a tool call:
 *   `> ⏳ **Bash** — git status`
 *   `> ✅ **Read** — ~/code/foo.ts`
 * Reuses `toolHeaderText` so the format matches the card mode header.
 */
function toolLine(tool: ToolEntry): string {
  return `> ${toolHeaderText(tool)}`;
}

function footerLine(status: 'thinking' | 'tool_running' | 'streaming'): string {
  if (status === 'thinking') return '_🧠 正在思考…_';
  if (status === 'tool_running') return '_🧰 正在调用工具…_';
  return '_✍️ 正在输出…_';
}
