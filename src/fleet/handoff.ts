import type { FleetConfig } from './schema';
import { resolveFleetBot } from './load';

export interface BridgeHandoff {
  __bridge_handoff: true;
  targetBot?: string;
  targetOpenId?: string;
  taskId?: string;
  payload?: string;
  hopCount?: number;
}

const MAX_HANDOFF_HOPS = 3;
const hopCounts = new Map<string, number>();

const HANDOFF_RE = /\{[\s\S]*?"__bridge_handoff"\s*:\s*true[\s\S]*?\}/;

export function parseHandoffFromText(text: string): BridgeHandoff | undefined {
  const match = text.match(HANDOFF_RE);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as BridgeHandoff;
    if (parsed.__bridge_handoff !== true) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function stripHandoffFromText(text: string): string {
  return text.replace(HANDOFF_RE, '').trim();
}

export function nextHandoffHop(taskId: string): number {
  const prev = hopCounts.get(taskId) ?? 0;
  const next = prev + 1;
  hopCounts.set(taskId, next);
  if (hopCounts.size > 500) {
    const oldest = hopCounts.keys().next().value;
    if (oldest) hopCounts.delete(oldest);
  }
  return next;
}

export function handoffExceeded(taskId: string | undefined, hopCount?: number): boolean {
  const hops = hopCount ?? (taskId ? hopCounts.get(taskId) ?? 0 : 0);
  return hops >= MAX_HANDOFF_HOPS;
}

export function resolveHandoffTarget(
  fleet: FleetConfig,
  handoff: BridgeHandoff,
): { openId: string; name?: string } | undefined {
  if (handoff.targetOpenId?.startsWith('ou_')) {
    return { openId: handoff.targetOpenId, ...(handoff.targetBot ? { name: handoff.targetBot } : {}) };
  }
  if (handoff.targetBot) {
    const resolved = resolveFleetBot(fleet, handoff.targetBot);
    if (resolved?.entry.openId) {
      return { openId: resolved.entry.openId, name: resolved.entry.name ?? resolved.name };
    }
  }
  return undefined;
}
