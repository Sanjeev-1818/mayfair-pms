// Front desk: staff sign-in, scan/search, verify, check-in with entry payment and automatic invoice.
import { Router } from 'express';
import { db } from '../db.js';
import { requireStaff, hasRole, startSession, endSession } from '../auth.js';
import { audit } from '../lib/audit.js';
import { getFile } from '../lib/storage.js';
import { checkPin, decrypt, normalizeIndianPhone, rateLimit, readPassToken } from '../lib/security.js';
import { businessDate } from '../lib/time.js';
import { createInvoice } from '../lib/invoice.js';
import { getSettings } from '../seed.js';
import {
  UserError, readAadhaar, applyAadhaar, applyAltId, applyPan, saveSelfie, completeRegistration, memberSummary, identityHash,
} from '../lib/members.js';
import { AadhaarError } from '../lib/aadhaar.js';

export const staffRouter = Router();
const desk = requireStaff('floor');

staffRouter.post('/api/staff/login', async (req, res) => {
  if (!rateLimit({ key: `staff-login:${req.ip}`, limit: 15, windowMs: 10 * 60_000 })) throw new UserError('Too many tries. Please wait a few minutes.', 429);
  const phone = normalizeIndianPhone(req.body?.phone);
  const staff = phone && await db.one('SELECT * FROM staff WHERE phone = $1 AND active', [phone]);
  if (!staff) throw new UserError('Phone number or PIN is not right.', 401);
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) throw new UserError('Too many wrong PINs. This account is locked for 15 minutes.', 423);
  if (!checkPin(req.body?.pin || '', staff.pin_hash)) {
    const n = staff.failed_attempts + 1;
    await db.query('UPDATE staff SET failed_attempts = $2, locked_until = $3 WHERE id = $1',
      [staff.id, n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60_000) : null]);
    await audit(req, 'staff.login_failed', { targetKind: 'staff', targetId: staff.id });
    throw new UserError('Phone number or PIN is not right.', 401);
  }
  const clubId = staff.club_id || req.body?.clubId;
  if (!clubId || !(await db.one('SELECT id FROM clubs WHERE id = $1', [clubId]))) throw new UserError('Please choose the club.', 400, { chooseClub: true });
  await db.query('UPDATE staff SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [staff.id]);
  await startSession(req, res, 'staff', staff.id, clubId);
  req.staff = { ...staff, clubId };
  await audit(req, 'staff.login', { targetKind: 'staff', targetId: staff.id, clubId });
  res.json({ ok: true });
});

staffRouter.post('/api/staff/logout', async (req, res) => {
  await endSession(req, res, 'staff');
  res.json({ ok: true });
});

staffRouter.get('/api/staff/me', requireStaff(), async (req, res) => {
  const club = await db.one('SELECT * FROM clubs WHERE id = $1', [req.staff.clubId]);
  const clubs = req.staff.club_id ? [club] : await db.query('SELECT id, name FROM clubs ORDER BY id');
  const s = await getSettings();
  res.json({
    staff: { id: req.staff.id, name: req.staff.name, role: req.staff.role },
    club: { id: club.id, name: club.name, gstin: club.gstin, phone: club.phone },
    clubs,
    settings: { entryFeePaise: s.entry_fee_paise, guestsIncluded: s.entry_guests_included, gstRate: s.gst_rate, gstInclusive: s.gst_inclusive },
  });
});

staffRouter.post('/api/staff/club', requireStaff(), async (req, res) => {
  if (req.staff.club_id) throw new UserError('You work at one club only.', 403);
  if (!(await db.one('SELECT id FROM clubs WHERE id = $1', [req.body?.clubId]))) throw new UserError('Unknown club.');
  await db.query('UPDATE sessions SET club_id = $2 WHERE id = $1', [req.staff.sessionId, req.body.clubId]);
  res.json({ ok: true });
});

async function deskView(req, memberId) {
  const m = await db.one('SELECT * FROM members WHERE id = $1', [memberId]);
  if (!m) throw new UserError('Member not found.', 404);
  const summary = await memberSummary(m);
  const today = await db.one(
    `SELECT v.*, i.invoice_no, i.share_token FROM visits v
     LEFT JOIN payments p ON p.visit_id = v.id LEFT JOIN invoices i ON i.payment_id = p.id
     WHERE v.member_id = $1 AND v.club_id = $2 AND v.business_date = $3 ORDER BY v.id DESC LIMIT 1`,
    [m.id, req.staff.clubId, businessDate()]);
  const stats = await db.one('SELECT count(*)::int AS visits, max(checked_in_at) AS last_visit FROM visits WHERE member_id = $1', [m.id]);
  return { ...summary, today, stats };
}

// One scanner box for everything: member pass QR, Aadhaar QR (finds the member or starts a walk-in), phone or code.
staffRouter.post('/api/staff/scan', desk, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const code = readPassToken(text);
  if (code) {
    const m = await db.one('SELECT id FROM members WHERE member_code = $1', [code]);
    if (!m) throw new UserError('Member not found.', 404);
    return res.json({ member: await deskView(req, m.id) });
  }
  if (text.startsWith('MPL1.')) throw new UserError('This member pass is not genuine.', 422);
  try {
    const parsed = await readAadhaar(text, null);
    const m = await db.one('SELECT id FROM members WHERE identity_hash = $1', [identityHash(parsed.name, parsed.dob, parsed.last4)]);
    if (m) return res.json({ member: await deskView(req, m.id) });
    return res.json({ walkin: { name: parsed.name, dob: parsed.dob, age: parsed.age, gender: parsed.gender, address: parsed.address, last4: parsed.last4, signature: parsed.signatureStatus } });
  } catch (e) {
    if (e instanceof AadhaarError) throw new UserError('QR not recognised. Scan the member pass or the Aadhaar QR.');
    throw e;
  }
});

staffRouter.get('/api/staff/search', desk, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const digits = q.replace(/\D/g, '');
  const rows = await db.query(
    `SELECT id, member_code, name, phone, status FROM members
     WHERE ($1 <> '' AND length($1) >= 4 AND phone LIKE '%' || $1 || '%')
        OR upper(member_code) LIKE '%' || upper($2) || '%'
        OR lower(name) LIKE '%' || lower($2) || '%'
     ORDER BY updated_at DESC LIMIT 12`, [digits, q]);
  res.json({ results: rows });
});

staffRouter.get('/api/staff/members/:id', desk, async (req, res) => {
  const view = await deskView(req, Number(req.params.id));
  await audit(req, 'member.view', { targetKind: 'member', targetId: view.id });
  res.json({ member: view });
});

const DOC_ROLE = { selfie: 'floor', aadhaar_photo: 'floor', alt_id: 'floor', pan_image: 'manager' };
staffRouter.get('/api/staff/members/:id/doc/:kind', desk, async (req, res) => {
  const need = DOC_ROLE[req.params.kind];
  if (!need) return res.sendStatus(404);
  if (!hasRole(req.staff, need)) return res.sendStatus(403);
  const doc = await db.one('SELECT * FROM member_documents WHERE member_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1', [Number(req.params.id), req.params.kind]);
  if (!doc) return res.sendStatus(404);
  await audit(req, 'document.view', { targetKind: 'member', targetId: req.params.id, details: { kind: req.params.kind } });
  res.set('Cache-Control', 'private, no-store').type(doc.mime).send(await getFile(doc.storage_key));
});

staffRouter.post('/api/staff/members/:id/reveal-pan', requireStaff('manager'), async (req, res) => {
  const kyc = await db.one('SELECT pan_enc FROM member_kyc WHERE member_id = $1', [Number(req.params.id)]);
  if (!kyc?.pan_enc) throw new UserError('No PAN on file.', 404);
  await audit(req, 'pan.reveal', { targetKind: 'member', targetId: req.params.id });
  res.json({ pan: decrypt(kyc.pan_enc) });
});

async function verifyMember(req, q, memberId) {
  await q.query(`UPDATE members SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'registered'`, [memberId]);
  await q.query('UPDATE member_kyc SET verified_by = $2, verified_at = now() WHERE member_id = $1 AND verified_at IS NULL', [memberId, req.staff.id]);
  await audit(req, 'member.verify', { targetKind: 'member', targetId: memberId }, q);
}

staffRouter.post('/api/staff/members/:id/verify', desk, async (req, res) => {
  const m = await db.one('SELECT status FROM members WHERE id = $1', [Number(req.params.id)]);
  if (m?.status !== 'registered') throw new UserError('Only newly registered members need verifying.');
  await db.tx((q) => verifyMember(req, q, Number(req.params.id)));
  res.json({ member: await deskView(req, Number(req.params.id)) });
});

// Check in: verify (first visit) + guest + entry payment + invoice, all in one transaction.
staffRouter.post('/api/staff/checkin', desk, async (req, res) => {
  const { memberId, verify, guest, mode = 'cash', reference, force } = req.body || {};
  const m = await db.one('SELECT * FROM members WHERE id = $1', [Number(memberId)]);
  if (!m) throw new UserError('Member not found.', 404);
  if (m.status === 'blocked') throw new UserError('This membership is blocked. Please call the manager.', 403);
  if (m.status === 'new') throw new UserError('This player has not finished registering yet.');
  if (m.status === 'registered' && !verify) throw new UserError('Please check the face and ID, then tap Verify.', 400, { needsVerify: true });
  if (!['cash', 'upi', 'card'].includes(mode)) throw new UserError('Choose how the player paid.');

  const day = businessDate();
  const open = await db.one(`SELECT id FROM visits WHERE member_id = $1 AND club_id = $2 AND business_date = $3 AND status = 'in'`, [m.id, req.staff.clubId, day]);
  if (open && !force) throw new UserError('This player is already checked in today. Check in again with a new entry fee?', 409, { alreadyIn: true });

  let guestRow = null;
  if (guest && (guest.name || guest.qr)) {
    if (guest.qr) {
      const p = await readAadhaar(guest.qr, null);
      guestRow = { name: p.name, phone: normalizeIndianPhone(guest.phone), dob: p.dob, last4: p.last4, idChecked: true };
    } else {
      if (String(guest.name).trim().length < 2) throw new UserError("Please enter the guest's name.");
      if (!guest.idChecked) throw new UserError("Please check the guest's photo ID (18+) and tick the box.");
      guestRow = { name: String(guest.name).trim(), phone: normalizeIndianPhone(guest.phone), dob: null, last4: null, idChecked: true };
    }
  }

  const settings = await getSettings();
  const club = await db.one('SELECT * FROM clubs WHERE id = $1', [req.staff.clubId]);
  const result = await db.tx(async (q) => {
    if (m.status === 'registered') await verifyMember(req, q, m.id);
    const [visit] = await q.query('INSERT INTO visits (member_id, club_id, business_date, checked_in_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [m.id, club.id, day, req.staff.id]);
    if (guestRow) {
      await q.query('INSERT INTO guests (visit_id, name, phone, dob, aadhaar_last4, id_checked) VALUES ($1,$2,$3,$4,$5,$6)',
        [visit.id, guestRow.name, guestRow.phone, guestRow.dob, guestRow.last4, guestRow.idChecked]);
    }
    const [payment] = await q.query(
      `INSERT INTO payments (club_id, member_id, visit_id, kind, amount_paise, mode, reference, received_by) VALUES ($1,$2,$3,'entry',$4,$5,$6,$7) RETURNING *`,
      [club.id, m.id, visit.id, settings.entry_fee_paise, mode, reference ? String(reference).slice(0, 60) : null, req.staff.id]);
    const invoice = await createInvoice(q, {
      club, paymentId: payment.id, memberId: m.id,
      description: `Club entry, ${day}${guestRow ? ' (member + 1 guest)' : ''}`,
      customerName: m.name, customerPhone: m.phone, amountPaise: settings.entry_fee_paise, settings,
    });
    await audit(req, 'visit.checkin', { targetKind: 'member', targetId: m.id, details: { visitId: visit.id, invoice: invoice.invoice_no, mode, guest: !!guestRow } }, q);
    return { visit, invoice };
  });
  res.json({ ...result, member: await deskView(req, m.id) });
});

staffRouter.post('/api/staff/visits/:id/checkout', desk, async (req, res) => {
  const v = await db.one(`UPDATE visits SET status = 'out', checked_out_at = now() WHERE id = $1 AND club_id = $2 AND status = 'in' RETURNING *`,
    [Number(req.params.id), req.staff.clubId]);
  if (!v) throw new UserError('Visit not found or already checked out.', 404);
  await audit(req, 'visit.checkout', { targetKind: 'member', targetId: v.member_id, details: { visitId: v.id } });
  res.json({ ok: true });
});

staffRouter.get('/api/staff/today', desk, async (req, res) => {
  const day = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : businessDate();
  const rows = await db.query(
    `SELECT v.id, v.status, v.checked_in_at, v.checked_out_at, m.id AS member_id, m.member_code, m.name,
       g.name AS guest, p.amount_paise, p.mode, i.invoice_no, i.share_token, s.name AS staff
     FROM visits v JOIN members m ON m.id = v.member_id
     LEFT JOIN guests g ON g.visit_id = v.id
     LEFT JOIN payments p ON p.visit_id = v.id AND p.kind = 'entry'
     LEFT JOIN invoices i ON i.payment_id = p.id
     LEFT JOIN staff s ON s.id = v.checked_in_by
     WHERE v.club_id = $1 AND v.business_date = $2 ORDER BY v.checked_in_at DESC`, [req.staff.clubId, day]);
  const totals = { players: rows.length, guests: rows.filter((r) => r.guest).length, inside: rows.filter((r) => r.status === 'in').length, cash: 0, upi: 0, card: 0 };
  for (const r of rows) if (r.mode) totals[r.mode] += r.amount_paise;
  res.json({ date: day, visits: rows, totals });
});

// Walk-in with no smartphone: staff scan the Aadhaar QR, type the phone, take the photo on the desk tablet.
staffRouter.post('/api/staff/walkin', desk, async (req, res) => {
  const { phone: rawPhone, qr, alt, selfie, pan, consent } = req.body || {};
  const phone = normalizeIndianPhone(rawPhone);
  if (!phone) throw new UserError('Please enter a valid 10-digit mobile number.');
  if (!consent) throw new UserError('Please read the consent to the player and tick the box.');
  const existing = await db.one('SELECT id, member_code FROM members WHERE phone = $1', [phone]);
  if (existing?.member_code) throw new UserError(`This number is already a member (${existing.member_code}). Search for them instead.`, 409);
  const parsed = qr ? await readAadhaar(qr, phone) : null;
  const m = existing || await db.one(`INSERT INTO members (phone, phone_verified) VALUES ($1, false) RETURNING *`, [phone]);
  if (parsed) await applyAadhaar(m.id, parsed);
  else await applyAltId(m.id, alt || {});
  await applyPan(m.id, { pan, source: 'typed' });
  await saveSelfie(m.id, selfie);
  const done = await completeRegistration(m.id, { clubId: req.staff.clubId, consent: true, via: 'desk' });
  await audit(req, 'register.walkin', { targetKind: 'member', targetId: m.id, details: { code: done.member_code } });
  res.json({ member: await deskView(req, m.id) });
});
