export type FleetBotRole = 'dispatcher' | 'dev' | 'tester' | 'custom' | string;

export interface FleetBotEntry {
  profile: string;
  openId?: string;
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
  openId?: string;
  role?: FleetBotRole;
  profile: string;
}

export const EMPTY_FLEET: FleetConfig = { schemaVersion: 1 };
