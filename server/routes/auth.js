// Player sign-in. Main path: the player sends one WhatsApp message containing a short code;
// WhatsApp proves the phone number and the waiting browser signs in by itself. Free for the club.
// Backup path: a 6-digit code (SMS provider to be added; shown on screen in test mode).
import { Router } from 'express';
import { db } from '../db.js';
import { config, whatsappEnabled } from '../config.js';
import { startSession, endSession } from '../auth.js';
import { audit } from '../lib/audit.js';
import { randomToken, shortCode, numericCode, sha256, safeEqual, normalizeIndianPhone, rateLimit } from '../lib/security.js';
import { sendWhatsAppText, sendCode, verifyWebhookSignature, whatsappLink } from '../lib/messaging.js';

export const authRouter = Router();
const REQUEST_TTL_MS = 15 * 60 * 1000;

const limited = (res) => res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });

authRouter.get('/api/auth/options', (_req, res) => {
  res.json({ whatsapp: whatsappEnabled(), testMode: config.authTestMode, code: config.authTestMode });
});

authRouter.post('/api/auth/start', async (req, res) => {
  if (!rateLimit({ key: `start:${req.ip}`, limit: 30, windowMs: 10 * 60_000 })) return limited(res);
  const id = randomToken(24);
  const nonce = shortCode(6);
  await db.query(
    'INSERT INTO login_requests (id, nonce, link_token, ip, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [id, nonce, randomToken(24), req.ip, new Date(Date.now() + REQUEST_TTL_MS)],
  );
  const message = `MAYFAIR SIGN IN ${nonce}`;
  res.json({ requestId: id, nonce, message, whatsappUrl: whatsappEnabled() ? whatsappLink(message) : null });
});

async function signInFromRequest(req, res, request) {
  const member = await db.one(
    `INSERT INTO members (phone, phone_verified) VALUES ($1, true)
     ON CONFLICT (phone) DO UPDATE SET phone_verified = true, updated_at = now() RETURNING *`,
    [request.phone],
  );
  if (member.status === 'blocked') return res.status(403).json({ error: 'This membership is not active. Please contact the club.' });
  await db.query("UPDATE login_requests SET status = 'used', link_token = NULL WHERE id = $1", [request.id]);
  await startSession(req, res, 'member', member.id);
  req.member = member;
  await audit(req, 'member.sign_in', { targetKind: 'member', targetId: member.id, details: { via: request.via } });
  return res.json({ done: true, next: member.member_code ? '/' : '/register' });
}

authRouter.get('/api/auth/poll/:id', async (req, res) => {
  const r = await db.one('SELECT * FROM login_requests WHERE id = $1', [req.params.id]);
  if (!r || r.status === 'used' || r.status === 'expired' || new Date(r.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This sign-in has expired. Please start again.' });
  }
  if (r.status !== 'verified') return res.json({ done: false });
  return signInFromRequest(req, res, r);
});

// One-time link sent back on WhatsApp, for players who started on a different device.
authRouter.get('/l/:token', async (req, res) => {
  const r = await db.one("SELECT * FROM login_requests WHERE link_token = $1 AND status = 'verified' AND expires_at > now()", [req.params.token]);
  if (!r) return res.redirect('/?expired=1');
  const member = await db.one(
    `INSERT INTO members (phone, phone_verified) VALUES ($1, true)
     ON CONFLICT (phone) DO UPDATE SET phone_verified = true, updated_at = now() RETURNING *`, [r.phone]);
  if (member.status === 'blocked') return res.redirect('/?blocked=1');
  await db.query("UPDATE login_requests SET status = 'used', link_token = NULL WHERE id = $1", [r.id]);
  await startSession(req, res, 'member', member.id);
  res.redirect(member.member_code ? '/' : '/register');
});

// Backup: code by SMS/WhatsApp template. In test mode the code is returned so it can be shown on screen.
authRouter.post('/api/auth/code/send', async (req, res) => {
  if (!config.authTestMode) return res.status(400).json({ error: 'Please use WhatsApp to sign in.' });
  const phone = normalizeIndianPhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  if (!rateLimit({ key: `code:${phone}`, limit: 4, windowMs: 15 * 60_000 })) return limited(res);
  const r = await db.one("SELECT * FROM login_requests WHERE id = $1 AND status = 'pending' AND expires_at > now()", [req.body?.requestId]);
  if (!r) return res.status(410).json({ error: 'This sign-in has expired. Please start again.' });
  const code = numericCode(6);
  await db.query('UPDATE login_requests SET phone = $2, code_hash = $3, attempts = 0 WHERE id = $1', [r.id, phone, sha256(`${r.id}:${code}`)]);
  await sendCode(phone, code);
  res.json({ sent: true, testCode: config.authTestMode ? code : undefined });
});

authRouter.post('/api/auth/code/verify', async (req, res) => {
  const r = await db.one("SELECT * FROM login_requests WHERE id = $1 AND status = 'pending' AND expires_at > now()", [req.body?.requestId]);
  if (!r || !r.code_hash) return res.status(410).json({ error: 'This sign-in has expired. Please start again.' });
  if (r.attempts >= 5) return res.status(429).json({ error: 'Too many wrong codes. Please start again.' });
  await db.query('UPDATE login_requests SET attempts = attempts + 1 WHERE id = $1', [r.id]);
  if (!safeEqual(sha256(`${r.id}:${String(req.body?.code || '').trim()}`), r.code_hash)) {
    return res.status(400).json({ error: 'That code is not right. Please check and try again.' });
  }
  const verified = await db.one("UPDATE login_requests SET status = 'verified', via = 'code', verified_at = now() WHERE id = $1 RETURNING *", [r.id]);
  return signInFromRequest(req, res, verified);
});

authRouter.post('/api/auth/logout', async (req, res) => {
  await endSession(req, res, 'member');
  res.json({ ok: true });
});

// ---- WhatsApp webhook (Meta Cloud API) ----
async function handleInbound(fromDigits, text) {
  const phone = normalizeIndianPhone(fromDigits) || `+${String(fromDigits).replace(/\D/g, '')}`;
  const m = /MAYFAIR\s+(?:SIGN\s*IN|LOGIN|REGISTER)?\s*([A-HJ-NP-Z2-9]{6})\b/i.exec(text || '');
  const r = m && await db.one(
    "UPDATE login_requests SET status = 'verified', phone = $2, via = 'whatsapp', verified_at = now() WHERE nonce = $1 AND status = 'pending' AND expires_at > now() RETURNING *",
    [m[1].toUpperCase(), phone],
  );
  if (r) {
    await sendWhatsAppText(phone, `✅ You are signed in to Mayfair Poker Lounge.\n\nGo back to your browser, it will continue by itself.\n\nOn another phone? Tap: ${config.appUrl}/l/${r.link_token}\n\nDid not try to sign in? Ignore this message.`);
    return { signedIn: true };
  }
  await sendWhatsAppText(phone, `Welcome to Mayfair Poker Lounge.\n\nTo sign in or become a member, open ${config.appUrl} and tap "Continue with WhatsApp".`);
  return { signedIn: false };
}

authRouter.get('/api/whatsapp/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken && req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

authRouter.post('/api/whatsapp/webhook', async (req, res) => {
  if (!verifyWebhookSignature(req.rawBody || Buffer.alloc(0), req.headers['x-hub-signature-256'])) return res.sendStatus(401);
  res.sendStatus(200); // Meta expects a fast reply
  try {
    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        for (const msg of change.value?.messages || []) {
          if (msg.type === 'text') await handleInbound(msg.from, msg.text?.body);
        }
      }
    }
  } catch (e) {
    console.error('WhatsApp webhook error', e);
  }
});

// Test mode only: pretend the player sent the WhatsApp message.
authRouter.post('/api/auth/test/whatsapp', async (req, res) => {
  if (!config.authTestMode) return res.sendStatus(404);
  const phone = normalizeIndianPhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  const r = await db.one('SELECT nonce FROM login_requests WHERE id = $1', [req.body?.requestId]);
  if (!r) return res.status(410).json({ error: 'This sign-in has expired. Please start again.' });
  res.json(await handleInbound(phone.slice(1), `MAYFAIR SIGN IN ${r.nonce}`));
});
