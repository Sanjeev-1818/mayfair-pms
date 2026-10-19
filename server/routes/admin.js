// Owner / manager tools: settings, club details (GSTIN), staff accounts, members, audit log.
import { Router } from 'express';
import { db } from '../db.js';
import { requireStaff, hasRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import { hashPin, normalizeIndianPhone } from '../lib/security.js';
import { getSettings, DEFAULT_SETTINGS } from '../seed.js';
import { UserError } from '../lib/members.js';

export const adminRouter = Router();
const manager = requireStaff('manager');
const owner = requireStaff('owner');

adminRouter.get('/api/admin/settings', manager, async (_req, res) => res.json({ settings: await getSettings() }));

adminRouter.put('/api/admin/settings', owner, async (req, res) => {
  const changes = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!(key in DEFAULT_SETTINGS) || key === 'consent_version') continue;
    const type = typeof DEFAULT_SETTINGS[key];
    if (typeof value !== type) throw new UserError(`Setting ${key} must be a ${type}.`);
    if (type === 'number' && (!Number.isFinite(value) || value < 0)) throw new UserError(`Setting ${key} must be zero or more.`);
    if (key === 'sac_code' && value && !/^\d{4,8}$/.test(value)) throw new UserError('SAC code should be 4 to 8 digits.');
    changes[key] = value;
  }
  for (const [key, value] of Object.entries(changes)) {
    await db.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, JSON.stringify(value)]);
  }
  await audit(req, 'settings.update', { details: changes });
  res.json({ settings: await getSettings() });
});

adminRouter.get('/api/admin/clubs', manager, async (_req, res) => res.json({ clubs: await db.query('SELECT * FROM clubs ORDER BY id') }));

adminRouter.put('/api/admin/clubs/:id', owner, async (req, res) => {
  const { legal_name: legalName, address, phone, gstin, invoice_prefix: prefix } = req.body || {};
  const g = String(gstin || '').toUpperCase().trim();
  if (g && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) throw new UserError('GSTIN does not look right (15 characters, e.g. 06ABCDE1234F1Z5).');
  if (!/^[A-Z0-9]{2,5}$/.test(String(prefix || ''))) throw new UserError('Invoice prefix: 2 to 5 capital letters or digits.');
  const club = await db.one(
    `UPDATE clubs SET legal_name = $2, address = $3, phone = $4, gstin = $5, invoice_prefix = $6, state_code = COALESCE(NULLIF(left($5, 2), ''), state_code)
     WHERE id = $1 RETURNING *`, [req.params.id, String(legalName || '').trim(), String(address || '').trim(), String(phone || '').trim(), g, prefix]);
  if (!club) throw new UserError('Club not found.', 404);
  await audit(req, 'club.update', { targetKind: 'club', targetId: club.id, details: { gstin: g, prefix } });
  res.json({ club });
});

const ROLES = ['owner', 'manager', 'cashier', 'floor', 'dealer'];
const canManageRole = (actor, role) => actor.role === 'owner' || (actor.role === 'manager' && !['owner', 'manager'].includes(role));

adminRouter.get('/api/admin/staff', manager, async (_req, res) => {
  res.json({ staff: await db.query('SELECT id, name, phone, role, club_id, active, created_at FROM staff ORDER BY active DESC, role, name') });
});

adminRouter.post('/api/admin/staff', manager, async (req, res) => {
  const { name, phone: rawPhone, role, clubId, pin } = req.body || {};
  const phone = normalizeIndianPhone(rawPhone);
  if (!String(name || '').trim()) throw new UserError('Please enter the name.');
  if (!phone) throw new UserError('Please enter a valid 10-digit mobile number.');
  if (!ROLES.includes(role) || !canManageRole(req.staff, role)) throw new UserError('You cannot create this role.', 403);
  if (!/^\d{6}$/.test(String(pin || ''))) throw new UserError('PIN must be 6 digits.');
  if (await db.one('SELECT id FROM staff WHERE phone = $1', [phone])) throw new UserError('A staff account with this number already exists.', 409);
  const club = req.staff.club_id || clubId || null;
  const s = await db.one('INSERT INTO staff (name, phone, role, club_id, pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, phone, role, club_id, active',
    [String(name).trim(), phone, role, club, hashPin(pin)]);
  await audit(req, 'staff.create', { targetKind: 'staff', targetId: s.id, details: { role, club } });
  res.json({ staff: s });
});

adminRouter.put('/api/admin/staff/:id', manager, async (req, res) => {
  const target = await db.one('SELECT * FROM staff WHERE id = $1', [Number(req.params.id)]);
  if (!target) throw new UserError('Staff not found.', 404);
  const role = req.body?.role ?? target.role;
  const self = target.id === req.staff.id;
  const allowed = ROLES.includes(role)
    && ((canManageRole(req.staff, target.role) && canManageRole(req.staff, role)) || (self && role === target.role));
  if (!allowed) throw new UserError('You cannot change this account.', 403);
  if (target.id === req.staff.id && req.body?.active === false) throw new UserError('You cannot switch off your own account.');
  const pin = req.body?.pin;
  if (pin != null && !/^\d{6}$/.test(String(pin))) throw new UserError('PIN must be 6 digits.');
  const s = await db.one(
    `UPDATE staff SET name = $2, role = $3, club_id = $4, active = $5, pin_hash = COALESCE($6, pin_hash), failed_attempts = 0, locked_until = NULL
     WHERE id = $1 RETURNING id, name, phone, role, club_id, active`,
    [target.id, String(req.body?.name ?? target.name).trim(), role, req.body?.clubId !== undefined ? (req.body.clubId || null) : target.club_id,
      req.body?.active ?? target.active, pin ? hashPin(pin) : null]);
  if (req.body?.active === false) await db.query("UPDATE sessions SET revoked_at = now() WHERE kind = 'staff' AND subject_id = $1", [target.id]);
  await audit(req, 'staff.update', { targetKind: 'staff', targetId: s.id, details: { role, active: s.active, pinChanged: !!pin } });
  res.json({ staff: s });
});

adminRouter.get('/api/admin/members', manager, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const rows = await db.query(
    `SELECT m.id, m.member_code, m.name, m.phone, m.status, m.home_club, m.registered_via, m.created_at,
       k.aadhaar_signature, k.pan_masked, (SELECT count(*)::int FROM visits v WHERE v.member_id = m.id) AS visits
     FROM members m LEFT JOIN member_kyc k ON k.member_id = m.id
     WHERE ($1 = '' OR m.status = $1) AND ($2 = '' OR lower(m.name) LIKE '%' || lower($2) || '%' OR m.phone LIKE '%' || $2 || '%' OR upper(m.member_code) LIKE '%' || upper($2) || '%')
     ORDER BY m.created_at DESC LIMIT 200`, [status, q]);
  res.json({ members: rows });
});

adminRouter.post('/api/admin/members/:id/status', manager, async (req, res) => {
  const want = req.body?.status;
  if (!['blocked', 'active'].includes(want)) throw new UserError('Unknown status.');
  const m = await db.one(`UPDATE members SET status = $2, updated_at = now() WHERE id = $1 AND member_code IS NOT NULL RETURNING id, status`, [Number(req.params.id), want]);
  if (!m) throw new UserError('Member not found.', 404);
  if (want === 'blocked') await db.query("UPDATE sessions SET revoked_at = now() WHERE kind = 'member' AND subject_id = $1", [m.id]);
  await audit(req, `member.${want === 'blocked' ? 'block' : 'unblock'}`, { targetKind: 'member', targetId: m.id, details: { reason: req.body?.reason } });
  res.json({ member: m });
});

adminRouter.get('/api/admin/audit', manager, async (req, res) => {
  const rows = await db.query(
    `SELECT a.*, s.name AS staff_name, m.name AS member_name FROM audit_log a
     LEFT JOIN staff s ON a.actor_kind = 'staff' AND s.id = a.actor_id
     LEFT JOIN members m ON a.actor_kind = 'member' AND m.id = a.actor_id
     WHERE ($1::text IS NULL OR a.club_id = $1) ORDER BY a.id DESC LIMIT 300`, [hasRole(req.staff, 'owner') ? null : req.staff.clubId]);
  res.json({ audit: rows });
});
