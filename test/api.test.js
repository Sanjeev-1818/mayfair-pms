// End-to-end API test: starts the real server on a throwaway database and walks through
// player sign-in, registration, desk check-in, invoices, rules and permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSecureQr } from './fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = { phone: '9000000001', pin: '135790' };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpl-test-'));
let server;

class Client {
  cookies = {};
  async call(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v) this.cookies[k] = v; else delete this.cookies[k];
    }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, data };
  }
  get = (u) => this.call('GET', u);
  post = (u, b = {}) => this.call('POST', u, b);
  put = (u, b = {}) => this.call('PUT', u, b);
}

const IMG = `data:image/jpeg;base64,${Buffer.alloc(5000, 7).toString('base64')}`;

async function signIn(phone) {
  const c = new Client();
  const { data: start } = await c.post('/api/auth/start');
  await c.post('/api/auth/test/whatsapp', { requestId: start.requestId, phone });
  const { data } = await c.get(`/api/auth/poll/${start.requestId}`);
  assert.equal(data.done, true);
  return c;
}

async function register(phone, qrOpts, pan) {
  const c = await signIn(phone);
  const a = await c.post('/api/register/aadhaar', { qr: await makeSecureQr({ ...qrOpts, mobile: phone }) });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal((await c.post('/api/register/pan', { pan, source: 'typed' })).status, 200);
  assert.equal((await c.post('/api/register/selfie', { image: IMG })).status, 200);
  const done = await c.post('/api/register/complete', { clubId: 'gurugram', consent: true });
  assert.equal(done.status, 200);
  return { c, member: done.data.member };
}

async function staffLogin(phone, pin, clubId = 'gurugram') {
  const s = new Client();
  const r = await s.post('/api/staff/login', { phone, pin, clubId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return s;
}

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, OWNER_PHONE: OWNER.phone, OWNER_PIN: OWNER.pin, AUTH_TEST_MODE: '1', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not start:\n' + log);
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('full journey: register on phone, verify and check in at the desk, bill appears for the player', async () => {
  const { c, member } = await register('9811111111', { name: 'Arjun Mehta', dob: '10-05-1990', last4: '2468' }, 'ABCPM1234Q');
  assert.match(member.code, /^MPL-G-\d{5}$/);
  assert.equal(member.status, 'registered');
  assert.equal(member.kyc.panMasked, 'ABXXXXX34Q');
  assert.equal(member.kyc.mobileMatch, true);

  const desk = await staffLogin(OWNER.phone, OWNER.pin);
  const scan = await desk.post('/api/staff/scan', { text: member.pass });
  assert.equal(scan.data.member.id, member.id);

  const noVerify = await desk.post('/api/staff/checkin', { memberId: member.id });
  assert.equal(noVerify.status, 400);
  assert.equal(noVerify.data.needsVerify, true);

  const ok = await desk.post('/api/staff/checkin', { memberId: member.id, verify: true, mode: 'cash', guest: { name: 'Neha', idChecked: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.invoice.total_paise, 250000);
  assert.equal(ok.data.invoice.doc_type, 'receipt');
  assert.equal(ok.data.member.status, 'active');

  const again = await desk.post('/api/staff/checkin', { memberId: member.id, mode: 'cash' });
  assert.equal(again.status, 409);

  const me = await c.get('/api/me');
  assert.equal(me.data.invoices.length, 1);
  assert.equal(me.data.visits[0].guest, 'Neha');
  const inv = await c.get(`/api/invoices/${me.data.invoices[0].share_token}`);
  assert.equal(inv.data.invoice.invoice_no, ok.data.invoice.invoice_no);

  const today = await desk.get('/api/staff/today');
  assert.ok(today.data.totals.cash >= 250000);
});

test('with a GSTIN the bill becomes a tax invoice with CGST + SGST', async () => {
  const owner = await staffLogin(OWNER.phone, OWNER.pin);
  const clubs = (await owner.get('/api/admin/clubs')).data.clubs;
  const g = clubs.find((x) => x.id === 'gurugram');
  assert.equal((await owner.put('/api/admin/clubs/gurugram', { ...g, gstin: '06ABCDE1234F1Z5' })).status, 200);
  const { member } = await register('9822222222', { name: 'Kavya Rao', dob: '01-01-1994', last4: '1357' }, 'BCDPR2345L');
  const r = await owner.post('/api/staff/checkin', { memberId: member.id, verify: true, mode: 'upi', reference: '4821' });
  assert.equal(r.data.invoice.doc_type, 'tax_invoice');
  assert.equal(r.data.invoice.cgst_paise + r.data.invoice.sgst_paise + r.data.invoice.taxable_paise, 250000);
  assert.equal(Number(r.data.invoice.gst_rate), 18);
});

test('under-18, duplicate Aadhaar, duplicate PAN and fake passes are refused', async () => {
  const kid = await signIn('9833333333');
  const r = await kid.post('/api/register/aadhaar', { qr: await makeSecureQr({ name: 'Young Player', dob: '01-01-2012', last4: '1111' }) });
  assert.equal(r.status, 403);

  const dup = await signIn('9844444444');
  const d = await dup.post('/api/register/aadhaar', { qr: await makeSecureQr({ name: 'Arjun Mehta', dob: '10-05-1990', last4: '2468' }) });
  assert.equal(d.status, 409);
  assert.match(d.data.error, /ending 1111/);

  await dup.post('/api/register/aadhaar', { qr: await makeSecureQr({ name: 'Other Person', dob: '02-02-1992', last4: '9753' }) });
  const p = await dup.post('/api/register/pan', { pan: 'ABCPM1234Q' });
  assert.equal(p.status, 409);

  const desk = await staffLogin(OWNER.phone, OWNER.pin);
  const fake = await desk.post('/api/staff/scan', { text: 'MPL1.MPL-G-00001.AAAAAAAAAAAA' });
  assert.equal(fake.status, 422);
});

test('staff roles: dealers cannot use the desk, cashiers cannot see PAN or admin', async () => {
  const owner = await staffLogin(OWNER.phone, OWNER.pin);
  assert.equal((await owner.post('/api/admin/staff', { name: 'Ravi', phone: '9855555555', role: 'cashier', clubId: 'gurugram', pin: '246810' })).status, 200);
  assert.equal((await owner.post('/api/admin/staff', { name: 'Dev', phone: '9866666666', role: 'dealer', clubId: 'gurugram', pin: '112233' })).status, 200);

  const cashier = await staffLogin('9855555555', '246810');
  assert.equal((await cashier.get('/api/staff/today')).status, 200);
  assert.equal((await cashier.get('/api/admin/settings')).status, 403);
  assert.equal((await cashier.post('/api/staff/members/1/reveal-pan')).status, 403);
  assert.equal((await cashier.get('/api/staff/members/1/doc/pan_image')).status, 403);

  const dealer = await staffLogin('9866666666', '112233');
  assert.equal((await dealer.get('/api/staff/today')).status, 403);

  const player = await signIn('9811111111');
  assert.equal((await player.get('/api/staff/today')).status, 401);

  const pan = await owner.post('/api/staff/members/1/reveal-pan');
  assert.equal(pan.data.pan, 'ABCPM1234Q');
});

test('wrong PINs lock the staff account', async () => {
  const s = new Client();
  for (let i = 0; i < 5; i++) await s.post('/api/staff/login', { phone: '9866666666', pin: '000000', clubId: 'gurugram' });
  const r = await s.post('/api/staff/login', { phone: '9866666666', pin: '112233', clubId: 'gurugram' });
  assert.equal(r.status, 423);
});

test('desk walk-in for a player without a smartphone', async () => {
  const desk = await staffLogin(OWNER.phone, OWNER.pin);
  const r = await desk.post('/api/staff/walkin', {
    phone: '9877777777', qr: await makeSecureQr({ name: 'Suresh Kumar', dob: '05-06-1970', last4: '8642', mobile: '9877777777' }),
    pan: 'CDEPK3456M', selfie: IMG, consent: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.member.status, 'registered');
  assert.equal(r.data.member.phoneVerified, false);
  assert.equal(r.data.member.registeredVia, 'desk');
});
