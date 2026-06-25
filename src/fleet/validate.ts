import type { FleetConfig, FleetBotEntry } from './schema';

const PROFILE_RE = /^[A-Za-z0-9._-]+$/;
const OPEN_ID_RE = /^ou_[a-zA-Z0-9]+$/;
const CHAT_ID_RE = /^oc_[a-zA-Z0-9]+$/;

export function validateFleetConfig(body: unknown): { ok: true; config: FleetConfig } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid fleet config' };
  const raw = body as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return { ok: false, error: 'schemaVersion must be 1' };

  const config: FleetConfig = { schemaVersion: 1 };

  if (raw.autoStart !== undefined) {
    if (!Array.isArray(raw.autoStart)) return { ok: false, error: 'autoStart must be an array' };
    for (const name of raw.autoStart) {
      if (typeof name !== 'string' || !PROFILE_RE.test(name)) {
        return { ok: false, error: `invalid profile in autoStart: ${String(name)}` };
      }
    }
    config.autoStart = raw.autoStart as string[];
  }

  if (raw.defaultGroupChatId !== undefined) {
    if (typeof raw.defaultGroupChatId !== 'string' || !CHAT_ID_RE.test(raw.defaultGroupChatId)) {
      return { ok: false, error: 'invalid defaultGroupChatId' };
    }
    config.defaultGroupChatId = raw.defaultGroupChatId;
  }

  if (raw.bots !== undefined) {
    if (typeof raw.bots !== 'object' || raw.bots === null || Array.isArray(raw.bots)) {
      return { ok: false, error: 'bots must be an object' };
    }
    const bots: Record<string, FleetBotEntry> = {};
    for (const [name, entry] of Object.entries(raw.bots as Record<string, unknown>)) {
      if (!PROFILE_RE.test(name) && !OPEN_ID_RE.test(name)) {
        return { ok: false, error: `invalid bot key: ${name}` };
      }
      if (!entry || typeof entry !== 'object') return { ok: false, error: `invalid bot entry: ${name}` };
      const e = entry as Record<string, unknown>;
      if (typeof e.profile !== 'string' || !PROFILE_RE.test(e.profile)) {
        return { ok: false, error: `bots.${name}.profile invalid` };
      }
      const bot: FleetBotEntry = { profile: e.profile };
      if (e.openId !== undefined) {
        if (typeof e.openId !== 'string' || !OPEN_ID_RE.test(e.openId)) {
          return { ok: false, error: `bots.${name}.openId invalid` };
        }
        bot.openId = e.openId;
      }
      if (e.role !== undefined && typeof e.role === 'string') bot.role = e.role;
      if (e.description !== undefined && typeof e.description === 'string') bot.description = e.description;
      if (e.defaultCwd !== undefined && typeof e.defaultCwd === 'string') bot.defaultCwd = e.defaultCwd;
      bots[name] = bot;
    }
    config.bots = bots;
  }

  return { ok: true, config };
}
