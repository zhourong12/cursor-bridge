export function redactChatId(chatId: string): string {
  if (chatId.length <= 4) return '****';
  if (chatId.length <= 10) return `...${chatId.slice(-4)}`;
  return `...${chatId.slice(-8)}`;
}

export function redactOpenId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}
