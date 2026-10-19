// All configuration comes from environment variables (Replit Secrets in production).
// In local development, missing secrets are generated once and kept in data/dev-secrets.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const isProd = process.env.NODE_ENV === 'production' || !!process.env.REPLIT_DEPLOYMENT;

function devSecret(name) {
  const file = path.join(DATA_DIR, 'dev-secrets.json');
  const secrets = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!secrets[name]) {
    secrets[name] = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }
  return secrets[name];
}

function secret(name) {
  if (process.env[name]) return process.env[name];
  if (isProd) throw new Error(`Missing required secret ${name}. Add it in Replit → Secrets.`);
  return devSecret(name);
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 5000),
  appUrl: (process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL || '',
  encryptionKey: Buffer.from(secret('ENCRYPTION_KEY'), 'base64'),
  sessionSecret: secret('SESSION_SECRET'),
  // Test sign-in shows the code on screen. On by default in development only.
  authTestMode: process.env.AUTH_TEST_MODE ? process.env.AUTH_TEST_MODE === '1' : !isProd,
  whatsapp: {
    token: process.env.WA_TOKEN || '',
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WA_VERIFY_TOKEN || '',
    appSecret: process.env.WA_APP_SECRET || '',
    businessNumber: (process.env.WA_BUSINESS_NUMBER || '').replace(/\D/g, ''),
  },
  ownerPhone: process.env.OWNER_PHONE || '',
  ownerPin: process.env.OWNER_PIN || '',
};

if (config.encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded');
export const whatsappEnabled = () => !!(config.whatsapp.token && config.whatsapp.phoneNumberId && config.whatsapp.businessNumber);
