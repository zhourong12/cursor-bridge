import { randomUUID } from 'node:crypto';
import type { TenantBrand } from '../config/schema';

export type RegisterSessionStatus = 'pending' | 'ready' | 'done' | 'failed' | 'consumed';

export interface RegisterSession {
  id: string;
  status: RegisterSessionStatus;
  qrUrl?: string;
  expireIn?: number;
  error?: string;
  appId?: string;
  appSecret?: string;
  tenant?: TenantBrand;
  botName?: string;
}

const sessions = new Map<string, RegisterSession>();
const TTL_MS = 15 * 60 * 1000;

function pruneSessions() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, s] of sessions) {
    if (s.status === 'consumed' || s.status === 'failed') {
      sessions.delete(id);
      continue;
    }
    const created = Number(id.split('-')[0]) || 0;
    if (created && created < cutoff) sessions.delete(id);
  }
}

export function startRegisterSession(): RegisterSession {
  pruneSessions();
  const id = `${Date.now()}-${randomUUID()}`;
  const session: RegisterSession = { id, status: 'pending' };
  sessions.set(id, session);

  void (async () => {
    try {
      const { registerApp } = await import('@larksuiteoapi/node-sdk');
      const result = await registerApp({
        source: 'lark-channel-bridge',
        onQRCodeReady: (info) => {
          session.qrUrl = info.url;
          session.expireIn = info.expireIn;
          session.status = 'ready';
        },
        onStatusChange: () => {},
      });
      session.appId = result.client_id;
      session.appSecret = result.client_secret;
      session.tenant = (result.user_info?.tenant_brand ?? 'feishu') as TenantBrand;
      session.status = 'done';
    } catch (err) {
      session.status = 'failed';
      session.error = (err as Error).message || String(err);
    }
  })();

  return { ...session };
}

export function getRegisterSession(id: string): RegisterSession | undefined {
  const s = sessions.get(id);
  return s ? { ...s, appSecret: s.status === 'done' ? '[redacted]' : undefined } : undefined;
}

export function consumeRegisterSession(id: string): RegisterSession | undefined {
  const s = sessions.get(id);
  if (!s || s.status !== 'done' || !s.appId || !s.appSecret) return undefined;
  s.status = 'consumed';
  return { ...s };
}

export async function renderRegisterSessionQrPng(id: string): Promise<Buffer | undefined> {
  const s = sessions.get(id);
  if (!s?.qrUrl) return undefined;
  const QRCode = await import('qrcode');
  return QRCode.toBuffer(s.qrUrl, { type: 'png', width: 200, margin: 1, errorCorrectionLevel: 'M' });
}
