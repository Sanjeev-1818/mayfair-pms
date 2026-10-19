// Reads the UIDAI "Secure QR" printed on Aadhaar cards, e-Aadhaar and the mAadhaar app.
// The QR is a big decimal number -> bytes -> gzip -> fields separated by byte 255,
// followed by a JPEG 2000 photo and a 2048-bit RSA (SHA-256) signature from UIDAI.
// It never contains the full Aadhaar number, only the last 4 digits.
// Older cards carry an unsigned XML QR instead; we read it but flag it for a manual check.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import jpeg from 'jpeg-js';
import { ROOT } from '../config.js';

const FIELDS = ['indicator', 'referenceId', 'name', 'dob', 'gender', 'careOf', 'district', 'landmark',
  'house', 'location', 'pincode', 'postOffice', 'state', 'street', 'subDistrict', 'vtc'];
const SIGNATURE_LEN = 256;
const HASH_LEN = 32;

export class AadhaarError extends Error {}

function loadUidaiKeys() {
  const dir = path.join(ROOT, 'certs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(cer|crt|pem)$/i.test(f)).map((f) => {
    const raw = fs.readFileSync(path.join(dir, f));
    const text = raw.toString('latin1');
    const cert = new crypto.X509Certificate(text.includes('BEGIN CERTIFICATE') ? text : raw);
    return { file: f, key: cert.publicKey };
  });
}
let uidaiKeys = loadUidaiKeys();
export const reloadUidaiKeys = () => { uidaiKeys = loadUidaiKeys(); };
export const setUidaiKeysForTest = (keys) => { uidaiKeys = keys; };

function numberToBytes(digits) {
  let hex = BigInt(digits).toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
}

function inflate(bytes) {
  for (const fn of [zlib.gunzipSync, zlib.inflateSync, zlib.inflateRawSync]) {
    try { return fn(bytes); } catch { /* try next */ }
  }
  throw new AadhaarError('This QR is not an Aadhaar Secure QR.');
}

// "DD-MM-YYYY" or "DD/MM/YYYY" -> "YYYY-MM-DD"
function parseDob(s) {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(String(s || '').trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  return iso ? iso[0] : null;
}

function genderName(g) {
  return { M: 'Male', F: 'Female', T: 'Transgender' }[String(g || '').trim().toUpperCase()] || g || null;
}

function joinAddress(f) {
  const parts = [f.house, f.street, f.landmark, f.location, f.vtc, f.postOffice, f.subDistrict, f.district, f.state]
    .map((p) => (p || '').trim()).filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return unique.join(', ') + (f.pincode ? ` - ${f.pincode}` : '');
}

function findJpeg2000(buf, from) {
  const jp2 = Buffer.from('0000000c6a5020200d0a870a', 'hex'); // JP2 file signature box
  const j2k = Buffer.from('ff4fff51', 'hex');                 // raw codestream
  const a = buf.indexOf(jp2, from), b = buf.indexOf(j2k, from);
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

export function parseSecureQr(text) {
  const digits = String(text || '').trim();
  if (digits.startsWith('<')) return parseXmlQr(digits);
  if (!/^\d{200,}$/.test(digits)) throw new AadhaarError('This QR is not an Aadhaar Secure QR.');

  const data = inflate(numberToBytes(digits));
  if (data.length < SIGNATURE_LEN + 100) throw new AadhaarError('Aadhaar QR is incomplete. Please scan again.');

  // Split leading text fields on byte 255. The photo bytes may also contain 255, so only take what we need.
  const fields = [];
  let start = 0;
  const firstEnd = data.indexOf(255);
  const first = data.subarray(0, firstEnd).toString('latin1');
  const version = /^V\d+$/.test(first) ? first : null;
  const wanted = FIELDS.length + (version ? 2 : 0); // V2+: version prefix + "last 4 of mobile" suffix
  for (let i = 0; i < data.length && fields.length < wanted; i++) {
    if (data[i] === 255) {
      fields.push(Buffer.from(data.subarray(start, i)).toString('utf8'));
      start = i + 1;
    }
  }
  if (fields.length < wanted) throw new AadhaarError('Aadhaar QR could not be read. Please scan again.');

  const offset = version ? 1 : 0;
  const f = Object.fromEntries(FIELDS.map((name, i) => [name, fields[i + offset]]));
  const indicator = Number(f.indicator);
  const hashCount = { 0: 0, 1: 1, 2: 1, 3: 2 }[indicator] ?? 0;

  const signature = data.subarray(data.length - SIGNATURE_LEN);
  const signed = data.subarray(0, data.length - SIGNATURE_LEN);
  const photoEnd = data.length - SIGNATURE_LEN - hashCount * HASH_LEN;
  const photoStart = findJpeg2000(data, start) !== -1 && findJpeg2000(data, start) < photoEnd ? findJpeg2000(data, start) : start;
  const photo = photoEnd > photoStart ? Buffer.from(data.subarray(photoStart, photoEnd)) : null;
  // Indicator 2 or 3 means a mobile hash is present (it sits right before the signature).
  const mobileHash = indicator === 2 || indicator === 3
    ? data.subarray(data.length - SIGNATURE_LEN - HASH_LEN, data.length - SIGNATURE_LEN).toString('hex') : null;

  let signatureStatus = 'not_checked';
  if (uidaiKeys.length) {
    const ok = uidaiKeys.some(({ key }) => crypto.verify('sha256', signed, key, signature));
    signatureStatus = ok ? 'verified' : 'invalid';
  }

  const dob = parseDob(f.dob);
  return {
    format: 'secure_qr',
    version: version || 'V1',
    last4: (f.referenceId || '').slice(0, 4),
    name: (f.name || '').trim(),
    dob,
    yearOnly: !dob && /^\d{4}$/.test(String(f.dob).trim()),
    yob: !dob && /^\d{4}$/.test(String(f.dob).trim()) ? Number(String(f.dob).trim()) : null,
    gender: genderName(f.gender),
    careOf: (f.careOf || '').trim() || null,
    address: joinAddress(f),
    pincode: (f.pincode || '').trim() || null,
    mobileLast4: version ? (fields[FIELDS.length + 1] || '').trim() || null : null,
    mobileHash,
    referenceDigit: Number((f.referenceId || '')[3]),
    photo,
    signatureStatus,
  };
}

// Old printed cards: <PrintLetterBarcodeData uid="123412341234" name="..." .../>. Unsigned.
function parseXmlQr(xml) {
  const attr = (name) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(xml);
    return m ? m[1].trim() : '';
  };
  const uid = attr('uid').replace(/\D/g, '');
  if (!uid) throw new AadhaarError('This QR is not an Aadhaar QR.');
  const f = {
    house: attr('house'), street: attr('street'), landmark: attr('lm'), location: attr('loc'), vtc: attr('vtc'),
    postOffice: attr('po'), subDistrict: attr('subdist'), district: attr('dist'), state: attr('state'), pincode: attr('pc'),
  };
  const dob = parseDob(attr('dob'));
  return {
    format: 'xml_qr',
    version: 'XML',
    last4: uid.slice(-4), // the full number is dropped here and never stored
    name: attr('name'),
    dob,
    yearOnly: !dob && !!attr('yob'),
    yob: !dob && attr('yob') ? Number(attr('yob')) : null,
    gender: genderName(attr('gender')),
    careOf: attr('co') || null,
    address: joinAddress(f),
    pincode: f.pincode || null,
    mobileLast4: null,
    mobileHash: null,
    photo: null,
    signatureStatus: 'unsigned',
  };
}

// UIDAI: mobile hash = SHA-256 applied N times to the mobile number, N = 4th digit of the reference ID (min 1).
export function mobileMatches(parsed, phoneE164) {
  if (!parsed.mobileHash || !phoneE164) return null;
  const mobile = phoneE164.replace(/^\+91/, '');
  let h = mobile;
  const rounds = Math.max(1, parsed.referenceDigit || 0);
  for (let i = 0; i < rounds; i++) h = crypto.createHash('sha256').update(h).digest('hex');
  return h === parsed.mobileHash;
}

// JPEG 2000 photo -> JPEG so every browser can show it.
let openjpeg;
export async function photoToJpeg(jp2) {
  if (!jp2) return null;
  if (!openjpeg) {
    const require = createRequire(import.meta.url);
    openjpeg = await require('@cornerstonejs/codec-openjpeg/decodewasmjs')();
  }
  const decoder = new openjpeg.J2KDecoder();
  const at = jp2.indexOf(Buffer.from('ff4fff51', 'hex'));
  const stream = at > 0 ? jp2.subarray(at) : jp2;
  decoder.getEncodedBuffer(stream.length).set(stream);
  try {
    decoder.decode();
  } catch {
    return null;
  }
  const { width, height, componentCount } = decoder.getFrameInfo();
  const px = decoder.getDecodedBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = componentCount >= 3 ? [px[i * componentCount], px[i * componentCount + 1], px[i * componentCount + 2]] : [px[i], px[i], px[i]];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width, height }, 90).data;
}
