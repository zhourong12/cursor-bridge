export interface ScheduledTask {
  id: string;
  cron: string;
  prompt: string;
  chatId: string;
  cwd?: string;
  creatorId: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  /** YYYY-MM-DDTHH:mm slot key — prevents double-fire in the same minute */
  lastRunSlot?: string;
  /** When true, do not post schedule results to Feishu (background maintenance). */
  silent?: boolean;
}

export interface ScheduleStore {
  version: 1;
  tasks: ScheduledTask[];
}
