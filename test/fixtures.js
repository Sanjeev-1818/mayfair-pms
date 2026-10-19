// Builds a synthetic Aadhaar Secure QR (same byte layout as UIDAI's), signed with a throwaway test key.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function testPhotoJ2k() {
  const oj = await require('@cornerstonejs/codec-openjpeg/wasmjs')();
  const enc = new oj.J2KEncoder();
  const w = 60, h = 80;
  const buf = enc.getDecodedBuffer({ width: w, height: h, bitsPerSample: 8, componentCount: 3, isSigned: false, isUsingColorTransform: true });
  for (let i = 0; i < w * h; i++) { buf[i * 3] = 120 + (i % 60); buf[i * 3 + 1] = 70; buf[i * 3 + 2] = 50; }
  enc.encode();
  return Buffer.from(enc.getEncodedBuffer());
}

export const testKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

export async function makeSecureQr({
  name = 'Rohan Sharma', dob = '15-08-1992', gender = 'M', last4 = '1234', mobile = '9991300311', version = 'V2',
  privateKey = testKeys.privateKey,
} = {}) {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const ref = `${last4}20261018120000123`;
  const rounds = Math.max(1, Number(last4[3]));
  let mh = mobile;
  for (let i = 0; i < rounds; i++) mh = sha(mh);
  const fields = ['3', ref, name, dob, gender, 'S/O Rajesh Sharma', 'Gurugram', 'Near Leisure Valley', 'H.No 12',
    'Sector 52', '122003', 'Gurugram', 'Haryana', 'Golf Course Road', 'Gurugram', 'Gurugram'];
  if (version) fields.unshift(version), fields.push(mobile.slice(-4));
  const head = Buffer.concat(fields.map((f) => Buffer.concat([Buffer.from(f, 'utf8'), Buffer.from([255])])));
  const body = Buffer.concat([head, await testPhotoJ2k(), crypto.randomBytes(32) /* email hash */, Buffer.from(mh, 'hex')]);
  const sig = crypto.sign('sha256', body, privateKey);
  const gz = zlib.gzipSync(Buffer.concat([body, sig]));
  return BigInt('0x' + gz.toString('hex')).toString(10);
}
