const WINDOW_MS = 10 * 60 * 1000;
const MAX_TURNS = 5;

const turns: Array<{ key: string; at: number }> = [];

function prune(now = Date.now()): void {
  while (turns.length > 0 && (turns[0]?.at ?? 0) < now - WINDOW_MS) {
    turns.shift();
  }
  if (turns.length > 1000) turns.splice(0, turns.length - 500);
}

export function canSendBotMention(chatId: string, fromOpenId: string, toOpenId: string): boolean {
  prune();
  const key = `${chatId}:${fromOpenId}:${toOpenId}`;
  return turns.filter((t) => t.key === key).length < MAX_TURNS;
}

export function recordBotMention(chatId: string, fromOpenId: string, toOpenId: string): void {
  prune();
  turns.push({ key: `${chatId}:${fromOpenId}:${toOpenId}`, at: Date.now() });
}

/** Test helper */
export function resetBotLoopProtectionForTest(): void {
  turns.length = 0;
}
