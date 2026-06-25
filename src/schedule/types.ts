export interface ScheduledTaskDispatch {
  /** Bot name in fleet.json or open_id (ou_xxx). */
  target: string;
  /** Optional override prompt for the delegated message body. */
  prompt?: string;
}

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
  /** After run, delegate to another bot via structured @mention. */
  dispatch?: ScheduledTaskDispatch;
}

export interface ScheduleStore {
  version: 1;
  tasks: ScheduledTask[];
}
