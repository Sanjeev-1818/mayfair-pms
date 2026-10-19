// Private file storage for selfies and ID images.
// Replit Object Storage when available (REPLIT_OBJECT_STORAGE=1 or a bucket is attached), local disk otherwise.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { randomToken } from './security.js';

let client;
async function replitClient() {
  if (client !== undefined) return client;
  client = null;
  if (process.env.REPLIT_OBJECT_STORAGE === '1' || process.env.REPLIT_DEFAULT_BUCKET_ID) {
    try {
      const { Client } = await import('@replit/object-storage');
      client = new Client();
      console.log('Storage: Replit Object Storage');
    } catch (e) {
      console.warn('Replit Object Storage not available, using local disk:', e.message);
    }
  }
  return client;
}

const localDir = path.join(DATA_DIR, 'uploads');

export async function putFile(prefix, buffer) {
  const key = `${prefix}/${new Date().toISOString().slice(0, 7)}/${randomToken(18)}`;
  const c = await replitClient();
  if (c) {
    const res = await c.uploadFromBytes(key, buffer);
    if (res && res.ok === false) throw new Error('Upload failed: ' + res.error?.message);
  } else {
    const file = path.join(localDir, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer, { mode: 0o600 });
  }
  return key;
}

export async function getFile(key) {
  if (!/^[a-z_]+\/\d{4}-\d{2}\/[A-Za-z0-9_-]+$/.test(key)) throw new Error('Bad key');
  const c = await replitClient();
  if (c) {
    const res = await c.downloadAsBytes(key);
    if (res.ok === false) throw new Error('Download failed');
    return Buffer.isBuffer(res.value) ? res.value : Buffer.from(res.value[0]);
  }
  return fs.readFile(path.join(localDir, key));
}
