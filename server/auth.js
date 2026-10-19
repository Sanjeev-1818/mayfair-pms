import { db } from './db.js';
import { config } from './config.js';
import { randomToken, sha256 } from './lib/security.js';

const COOKIE = { member: 'mpl_m', staff: 'mpl_s' };
const TTL = { member: 90 * 24 * 3600 * 1000, staff: 14 * 3600 * 1000 };

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeMs) {
  const attrs = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

export async function startSession(req, res, kind, subjectId, clubId = null) {
  const token = randomToken(32);
  await db.query(
    'INSERT INTO sessions (id, kind, subject_id, club_id, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [sha256(token), kind, subjectId, clubId, String(req.headers['user-agent'] || '').slice(0, 300), new Date(Date.now() + TTL[kind])],
  );
  setCookie(res, COOKIE[kind], token, TTL[kind]);
}

export async function endSession(req, res, kind) {
  const token = parseCookies(req)[COOKIE[kind]];
  if (token) await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sha256(token)]);
  setCookie(res, COOKIE[kind], '', 0);
}

async function loadSession(req, kind) {
  const token = parseCookies(req)[COOKIE[kind]];
  if (!token) return null;
  return db.one('SELECT * FROM sessions WHERE id = $1 AND kind = $2 AND revoked_at IS NULL AND expires_at > now()', [sha256(token), kind]);
}

// Attach req.member / req.staff when the cookies are valid.
export async function attachUsers(req, _res, next) {
  try {
    const [m, s] = await Promise.all([loadSession(req, 'member'), loadSession(req, 'staff')]);
    if (m) req.member = await db.one('SELECT * FROM members WHERE id = $1', [m.subject_id]);
    if (s) {
      const staff = await db.one('SELECT id, name, phone, role, club_id FROM staff WHERE id = $1 AND active', [s.subject_id]);
      if (staff) req.staff = { ...staff, clubId: s.club_id, sessionId: s.id };
    }
    next();
  } catch (e) {
    next(e);
  }
}

export const requireMember = (req, res, next) => (req.member && req.member.status !== 'blocked'
  ? next() : res.status(401).json({ error: 'Please sign in.' }));

const RANK = { dealer: 1, floor: 2, cashier: 3, manager: 4, owner: 5 };
export const requireStaff = (minRole = 'dealer') => (req, res, next) => {
  if (!req.staff) return res.status(401).json({ error: 'Staff sign-in required.' });
  if (RANK[req.staff.role] < RANK[minRole]) return res.status(403).json({ error: 'You do not have access to this.' });
  next();
};
export const hasRole = (staff, minRole) => !!staff && RANK[staff.role] >= RANK[minRole];
