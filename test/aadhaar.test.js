import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseSecureQr, mobileMatches, photoToJpeg, setUidaiKeysForTest, AadhaarError } from '../server/lib/aadhaar.js';
import { makeSecureQr, testKeys } from './fixtures.js';

test('reads every field from a V2 Secure QR', async () => {
  setUidaiKeysForTest([{ key: testKeys.publicKey }]);
  const p = parseSecureQr(await makeSecureQr());
  assert.equal(p.version, 'V2');
  assert.equal(p.name, 'Rohan Sharma');
  assert.equal(p.dob, '1992-08-15');
  assert.equal(p.gender, 'Male');
  assert.equal(p.last4, '1234');
  assert.equal(p.mobileLast4, '0311');
  assert.match(p.address, /H\.No 12, Golf Course Road, Near Leisure Valley, Sector 52, Gurugram, Haryana - 122003/);
  assert.equal(p.signatureStatus, 'verified');
  assert.ok(p.photo.length > 100);
});

test('reads the older V1 layout (no version prefix)', async () => {
  setUidaiKeysForTest([{ key: testKeys.publicKey }]);
  const p = parseSecureQr(await makeSecureQr({ version: null }));
  assert.equal(p.version, 'V1');
  assert.equal(p.name, 'Rohan Sharma');
  assert.equal(p.signatureStatus, 'verified');
});

test('catches an edited or fake QR', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  setUidaiKeysForTest([{ key: testKeys.publicKey }]);
  const p = parseSecureQr(await makeSecureQr({ privateKey: other.privateKey }));
  assert.equal(p.signatureStatus, 'invalid');
});

test('signature is "not_checked" when no UIDAI certificate is installed', async () => {
  setUidaiKeysForTest([]);
  const p = parseSecureQr(await makeSecureQr());
  assert.equal(p.signatureStatus, 'not_checked');
});

test('matches the WhatsApp phone against the mobile hash', async () => {
  const p = parseSecureQr(await makeSecureQr());
  assert.equal(mobileMatches(p, '+919991300311'), true);
  assert.equal(mobileMatches(p, '+919876543210'), false);
});

test('converts the JPEG 2000 photo to JPEG', async () => {
  const p = parseSecureQr(await makeSecureQr());
  const jpg = await photoToJpeg(p.photo);
  assert.equal(jpg[0], 0xff);
  assert.equal(jpg[1], 0xd8);
});

test('old XML QR keeps only the last 4 digits', () => {
  const p = parseSecureQr('<?xml version="1.0"?><PrintLetterBarcodeData uid="987654321098" name="Asha Rani" gender="F" yob="1990" co="D/O Ram" house="12" street="MG Road" vtc="Panchkula" dist="Panchkula" state="Haryana" pc="134109" dob="01/02/1990"/>');
  assert.equal(p.last4, '1098');
  assert.equal(p.dob, '1990-02-01');
  assert.equal(p.signatureStatus, 'unsigned');
  assert.ok(!JSON.stringify(p).includes('987654321098'));
});

test('rejects random QR codes', () => {
  assert.throws(() => parseSecureQr('https://example.com'), AadhaarError);
  assert.throws(() => parseSecureQr('1'.repeat(400)), AadhaarError);
});
