export type MessageLifecycleStage =
  | 'received'
  | 'access_allowed'
  | 'queued'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'dropped';

export interface MessageLifecycleEntry {
  scope: string;
  messageId: string;
  chatId: string;
  preview: string;
  stage: MessageLifecycleStage;
  reason?: string;
  at: number;
}

export class MessageLifecycleStore {
  private readonly entries = new Map<string, MessageLifecycleEntry>();
  private readonly order: string[] = [];

  constructor(private readonly maxEntries = 20) {}

  record(entry: MessageLifecycleEntry): void {
    if (!this.entries.has(entry.messageId)) {
      this.order.push(entry.messageId);
    }
    this.entries.set(entry.messageId, entry);
    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) this.entries.delete(oldest);
    }
  }

  update(messageId: string, patch: Pick<MessageLifecycleEntry, 'stage' | 'at'> & {
    reason?: string;
  }): void {
    const current = this.entries.get(messageId);
    if (!current) return;
    this.entries.set(messageId, { ...current, ...patch });
  }

  recent(scope?: string, limit = 5): MessageLifecycleEntry[] {
    return this.order
      .map((id) => this.entries.get(id))
      .filter((entry): entry is MessageLifecycleEntry => Boolean(entry))
      .filter((entry) => !scope || entry.scope === scope)
      .slice(-limit)
      .reverse();
  }
}
