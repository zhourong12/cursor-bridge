export type FleetBotRole = 'dispatcher' | 'dev' | 'tester' | 'custom' | string;

export interface FleetBotEntry {
  profile: string;
  openId?: string;
  /** Bot display name from SDK handshake (auto-recorded by upsertSelfBot). */
  name?: string;
  role?: FleetBotRole;
  description?: string;
  defaultCwd?: string;
}

export interface FleetDispatchTarget {
  /** Bot name key in fleet.bots, or open_id (ou_xxx). */
  target: string;
  prompt: string;
}

export interface FleetConfig {
  schemaVersion: 1;
  autoStart?: string[];
  defaultGroupChatId?: string;
  bots?: Record<string, FleetBotEntry>;
}

export interface FleetPeer {
  name: string;
  /** Display name from fleet entry (e.g. 基石). */
  displayName?: string;
  openId?: string;
  role?: FleetBotRole;
  profile: string;
}

export const EMPTY_FLEET: FleetConfig = { schemaVersion: 1 };
