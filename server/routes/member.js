import { Router } from 'express';
import { db } from '../db.js';
import { requireMember } from '../auth.js';
import { audit } from '../lib/audit.js';
import { getFile } from '../lib/storage.js';
import { rateLimit } from '../lib/security.js';
import {
  UserError, readAadhaar, applyAadhaar, applyAltId, applyPan, saveSelfie, completeRegistration, memberSummary,
} from '../lib/members.js';

export const memberRouter = Router();

const editable = (req) => {
  if (req.member.member_code && req.member.status !== 'new') throw new UserError('Your registration is complete. Please ask the desk to change your details.', 409);
};

memberRouter.get('/api/me', requireMember, async (req, res) => {
  const summary = await memberSummary(req.member);
  const visits = await db.query(
    `SELECT v.id, v.business_date, v.checked_in_at, v.checked_out_at, v.status, c.name AS club,
       (SELECT name FROM guests g WHERE g.visit_id = v.id LIMIT 1) AS guest
     FROM visits v JOIN clubs c ON c.id = v.club_id WHERE v.member_id = $1 ORDER BY v.checked_in_at DESC LIMIT 30`, [req.member.id]);
  const invoices = await db.query(
    `SELECT invoice_no, doc_type, total_paise, created_at, share_token FROM invoices WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [req.member.id]);
  const clubs = await db.query('SELECT id, name FROM clubs ORDER BY id');
  res.json({ member: summary, visits, invoices, clubs });
});

memberRouter.get('/api/me/doc/:kind', requireMember, async (req, res) => {
  if (!['selfie', 'aadhaar_photo'].includes(req.params.kind)) return res.sendStatus(404);
  const doc = await db.one('SELECT * FROM member_documents WHERE member_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1', [req.member.id, req.params.kind]);
  if (!doc) return res.sendStatus(404);
  res.set('Cache-Control', 'private, max-age=300').type(doc.mime).send(await getFile(doc.storage_key));
});

memberRouter.post('/api/register/aadhaar', requireMember, async (req, res) => {
  editable(req);
  if (!rateLimit({ key: `aadhaar:${req.member.id}`, limit: 20, windowMs: 15 * 60_000 })) throw new UserError('Too many tries. Please wait a few minutes.', 429);
  try {
    const parsed = await readAadhaar(req.body?.qr, req.member.phone);
    const { hasPhoto } = await applyAadhaar(req.member.id, parsed);
    await audit(req, 'register.aadhaar', { targetKind: 'member', targetId: req.member.id, details: { signature: parsed.signatureStatus, version: parsed.version } });
    res.json({
      name: parsed.name, dob: parsed.dob, age: parsed.age, gender: parsed.gender, address: parsed.address,
      last4: parsed.last4, signature: parsed.signatureStatus, mobileMatch: parsed.mobileMatch, hasPhoto,
    });
  } catch (e) {
    if (e.extra?.underAge || e.extra?.invalidSignature || e.extra?.duplicate) {
      await audit(req, 'register.aadhaar_rejected', { targetKind: 'member', targetId: req.member.id, details: { reason: e.message } });
    }
    throw e;
  }
});

memberRouter.post('/api/register/alt-id', requireMember, async (req, res) => {
  editable(req);
  await applyAltId(req.member.id, req.body || {});
  await audit(req, 'register.alt_id', { targetKind: 'member', targetId: req.member.id, details: { idType: req.body?.idType } });
  res.json({ ok: true });
});

memberRouter.post('/api/register/pan', requireMember, async (req, res) => {
  editable(req);
  const result = await applyPan(req.member.id, req.body || {});
  await audit(req, 'register.pan', { targetKind: 'member', targetId: req.member.id, details: { source: req.body?.source } });
  res.json(result);
});

memberRouter.post('/api/register/selfie', requireMember, async (req, res) => {
  editable(req);
  await saveSelfie(req.member.id, req.body?.image);
  res.json({ ok: true });
});

memberRouter.post('/api/register/complete', requireMember, async (req, res) => {
  const m = await completeRegistration(req.member.id, { clubId: req.body?.clubId, consent: req.body?.consent === true, via: 'self' });
  await audit(req, 'register.complete', { targetKind: 'member', targetId: m.id, details: { code: m.member_code } });
  res.json({ member: await memberSummary(m) });
});
