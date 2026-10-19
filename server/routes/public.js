import { Router } from 'express';
import { db } from '../db.js';

export const publicRouter = Router();

// Shareable invoice link (unguessable token), shown on the printable invoice page.
publicRouter.get('/api/invoices/:token', async (req, res) => {
  const inv = await db.one(
    `SELECT i.*, c.name AS club_name, c.legal_name, c.address AS club_address, c.phone AS club_phone, c.gstin, c.state_name, c.state_code,
       m.member_code, p.mode
     FROM invoices i JOIN clubs c ON c.id = i.club_id LEFT JOIN members m ON m.id = i.member_id LEFT JOIN payments p ON p.id = i.payment_id
     WHERE i.share_token = $1`, [req.params.token]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  const { share_token: _t, member_id: _m, payment_id: _p, ...rest } = inv;
  res.set('Cache-Control', 'private, no-store').json({ invoice: rest });
});

publicRouter.get('/api/clubs', async (_req, res) => {
  res.json({ clubs: await db.query('SELECT id, name FROM clubs ORDER BY id') });
});
