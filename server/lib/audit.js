import { db } from '../db.js';

export async function audit(req, action, { targetKind, targetId, clubId, details } = {}, q = db) {
  const actor = req?.staff ? ['staff', req.staff.id] : req?.member ? ['member', req.member.id] : ['system', null];
  await q.query(
    `INSERT INTO audit_log (actor_kind, actor_id, action, target_kind, target_id, club_id, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor[0], actor[1], action, targetKind || null, targetId != null ? String(targetId) : null,
      clubId || req?.staff?.clubId || null, details ? JSON.stringify(details) : null, req?.ip || null],
  );
}
