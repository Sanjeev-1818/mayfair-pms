import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM for PAN / bank details at rest.
export function encrypt(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(blob) {
  if (!blob) return null;
  const raw = Buffer.from(blob.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hmac = (s) => crypto.createHmac('sha256', config.sessionSecret).update(s).digest('base64url');

// Short codes avoid look-alike characters (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function shortCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const numericCode = (len = 6) => String(crypto.randomInt(0, 10 ** len)).padStart(len, '0');

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pin), salt, 32);
  return `s1:${salt.toString('base64')}:${key.toString('base64')}`;
}
export function checkPin(pin, stored) {
  const [, salt, key] = stored.split(':');
  const test = crypto.scryptSync(String(pin), Buffer.from(salt, 'base64'), 32);
  return crypto.timingSafeEqual(test, Buffer.from(key, 'base64'));
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The member pass QR: "MPL1.<member code>.<signature>". Forged codes are rejected at the desk.
export const passToken = (memberCode) => `MPL1.${memberCode}.${hmac('pass:' + memberCode).slice(0, 12)}`;
export function readPassToken(text) {
  const m = /^MPL1\.([A-Z0-9-]+)\.([A-Za-z0-9_-]{12})$/.exec(String(text).trim());
  if (!m || !safeEqual(passToken(m[1]), m[0])) return null;
  return m[1];
}

export function normalizeIndianPhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return '+91' + d;
}

// Simple in-memory rate limiter (per process), enough for a two-club deployment.
const buckets = new Map();
export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();
