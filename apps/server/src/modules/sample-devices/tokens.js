import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEVICE_ONLINE_WINDOW_SECONDS = 90;
export const HEARTBEAT_OFFLINE_GRACE_SECONDS = 15;

export function nowIso() {
  return new Date().toISOString();
}

export function isoSeconds(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}

export function toIso(value) {
  if (value == null) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function secondsSince(isoText) {
  const parsed = toIso(isoText);
  if (!parsed) return null;
  return Math.max(0, Math.floor((Date.now() - Date.parse(parsed)) / 1000));
}

export function generateToken() {
  return randomBytes(24).toString('hex');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

export function tokensEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function safeText(value, max = 255) {
  const text = value == null ? '' : String(value).trim();
  return text ? text.slice(0, max) : null;
}

export function pickDeviceToken(source) {
  if (!source) return null;
  return safeText(source.token, 128) || safeText(source.agent_token, 128) || safeText(source.agentToken, 128);
}
