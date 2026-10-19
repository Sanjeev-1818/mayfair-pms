import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, rupees } from '../api.js';
import { Alert, Badge, SignatureBadge, Spinner } from '../components/ui.jsx';

const TABS = [['members', 'Members'], ['staff', 'Staff'], ['clubs', 'Clubs & GST'], ['settings', 'Settings'], ['audit', 'Activity log']];

export default function Admin({ me }) {
  const [tab, setTab] = useState('members');
  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }} className="stack">
      <div className="chips" role="tablist">
        {TABS.map(([id, label]) => <button key={id} role="tab" className="chip" aria-pressed={tab === id} aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'members' && <Members me={me} />}
      {tab === 'staff' && <StaffTab me={me} />}
      {tab === 'clubs' && <Clubs me={me} />}
      {tab === 'settings' && <Settings me={me} />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Members({ me }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api(`/api/admin/members?q=${encodeURIComponent(q)}&status=${status}`).then((r) => setRows(r.members)), [q, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div className="stack">
      <div className="row wrap">
        <input className="input" style={{ flex: '1 1 260px' }} placeholder="Search name, phone or member ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option><option value="active">Active</option><option value="registered">First visit pending</option><option value="new">Still registering</option><option value="blocked">Blocked</option>
        </select>
      </div>
      {open && <MemberDetail id={open} me={me} onClose={() => { setOpen(null); load(); }} />}
      <div className="card t-wrap">
        {!rows ? <Spinner /> : (
          <table className="t">
            <thead><tr><th>Member</th><th>Phone</th><th>Club</th><th>ID</th><th>PAN</th><th>Visits</th><th>Joined</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="muted">No members found.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(r.id)}>
                  <td>{r.name || <span className="muted">-</span>}<br /><span className="small muted">{r.member_code}</span></td>
                  <td>{r.phone}</td><td style={{ textTransform: 'capitalize' }}>{r.home_club || '-'}</td>
                  <td><SignatureBadge status={r.aadhaar_signature} /></td>
                  <td>{r.pan_masked || '-'}</td><td>{r.visits}</td><td className="small">{fmtDate(r.created_at)}</td>
                  <td><Badge kind={r.status === 'active' ? 'ok' : r.status === 'blocked' ? 'bad' : 'warn'}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MemberDetail({ id, me, onClose }) {
  const [m, setM] = useState(null);
  const [pan, setPan] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api(`/api/staff/members/${id}`).then((r) => setM(r.member)).catch((e) => setError(e.message)); }, [id]);

  async function reveal() {
    try { setPan((await api(`/api/staff/members/${id}/reveal-pan`, { method: 'POST' })).pan); } catch (e) { setError(e.message); }
  }
  async function setStatus(status) {
    const reason = status === 'blocked' ? window.prompt('Reason for blocking (kept in the activity log):') : '';
    if (status === 'blocked' && !reason) return;
    try { await api(`/api/admin/members/${id}/status`, { method: 'POST', body: { status, reason } }); onClose(); } catch (e) { setError(e.message); }
  }

  if (!m) return <div className="card">{error ? <Alert>{error}</Alert> : <Spinner />}</div>;
  return (
    <div className="card stack">
      <div className="spread"><div><p className="eyebrow" style={{ margin: 0 }}>{m.code}</p><h2>{m.name}</h2></div><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        {['selfie', 'aadhaar_photo', 'alt_id', 'pan_image'].filter((k) => m.steps.docs.includes(k)).map((k) => (
          <figure key={k} style={{ margin: 0 }}><img src={`/api/staff/members/${id}/doc/${k}`} alt={k} style={{ height: 160, borderRadius: 4, border: '1px solid var(--line)' }} />
            <figcaption className="small muted center">{k.replace('_', ' ')}</figcaption></figure>
        ))}
      </div>
      <dl className="kv" style={{ maxWidth: 560 }}>
        <dt>Phone</dt><dd>{m.phone} {m.phoneVerified ? '✓' : '(not verified)'}</dd>
        <dt>Born</dt><dd>{fmtDate(m.dob)} ({m.age})</dd>
        <dt>Gender</dt><dd>{m.gender || '-'}</dd>
        <dt>Care of</dt><dd>{m.careOf || '-'}</dd>
        <dt>Address</dt><dd>{m.address || '-'}</dd>
        <dt>Aadhaar</dt><dd>{m.kyc?.aadhaarLast4 ? `XXXX XXXX ${m.kyc.aadhaarLast4}` : m.kyc?.idType}</dd>
        <dt>PAN</dt><dd>{pan || m.kyc?.panMasked} {!pan && m.kyc?.panMasked && <button className="btn btn-ghost btn-sm" onClick={reveal}>Show full (logged)</button>}</dd>
        <dt>Verified</dt><dd>{m.kyc?.verifiedAt ? `${fmtDate(m.kyc.verifiedAt)} by ${m.kyc.verifiedBy}` : 'Not yet'}</dd>
        <dt>Registered</dt><dd>{fmtDate(m.createdAt)} ({m.registeredVia === 'desk' ? 'at desk' : 'own phone'})</dd>
        <dt>Visits</dt><dd>{m.stats?.visits}</dd>
      </dl>
      <Alert>{error}</Alert>
      <div className="row">
        {m.status === 'blocked' ? <button className="btn btn-line" onClick={() => setStatus('active')}>Unblock</button>
          : m.code && <button className="btn btn-line" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={() => setStatus('blocked')}>Block member</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Viewing this page is recorded in the activity log. Signed in as {me.staff.name}.</p>
    </div>
  );
}

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier / desk', floor: 'Floor', dealer: 'Dealer' };

function StaffTab({ me }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', role: 'cashier', clubId: me.club.id, pin: '' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const load = () => api('/api/admin/staff').then((r) => setList(r.staff));
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault(); setError(''); setOk('');
    try { await api('/api/admin/staff', { method: 'POST', body: form }); setOk(`${form.name} can now sign in with their PIN.`); setForm({ ...form, name: '', phone: '', pin: '' }); load(); }
    catch (err) { setError(err.message); }
  }
  async function update(s, changes) {
    setError(''); setOk('');
    try { await api(`/api/admin/staff/${s.id}`, { method: 'PUT', body: changes }); load(); setOk('Saved.'); } catch (err) { setError(err.message); }
  }
  async function resetPin(s) {
    const pin = window.prompt(`New 6-digit PIN for ${s.name}:`);
    if (pin) update(s, { pin });
  }
  const roles = me.staff.role === 'owner' ? Object.keys(ROLE_LABEL) : ['cashier', 'floor', 'dealer'];

  return (
    <div className="stack">
      <form className="card stack" onSubmit={add}>
        <h3>Add staff</h3>
        <div className="row wrap">
          <input className="input" style={{ flex: '2 1 180px' }} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" style={{ flex: '1 1 150px' }} placeholder="Mobile" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} />
          <select className="input" style={{ flex: '1 1 150px' }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role">
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {me.clubs.length > 1 && (
            <select className="input" style={{ flex: '1 1 150px' }} value={form.clubId} onChange={(e) => setForm({ ...form, clubId: e.target.value })} aria-label="Club">
              {me.clubs.map((c) => <option key={c.id} value={c.id}>{c.name.replace('Mayfair Poker Lounge, ', '')}</option>)}
              {me.staff.role === 'owner' && <option value="">Both clubs</option>}
            </select>
          )}
          <input className="input" style={{ flex: '1 1 130px' }} placeholder="6-digit PIN" inputMode="numeric" maxLength={6} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
          <button className="btn btn-gold">Add</button>
        </div>
        <Alert>{error}</Alert><Alert kind="ok">{ok}</Alert>
      </form>
      <div className="card t-wrap">
        {!list ? <Spinner /> : (
          <table className="t">
            <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>Club</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}{s.id === me.staff.id && <span className="small muted"> (you)</span>}</td><td>{s.phone}</td><td>{ROLE_LABEL[s.role]}</td>
                  <td style={{ textTransform: 'capitalize' }}>{s.club_id || 'Both'}</td><td>{s.active ? <Badge kind="ok">Active</Badge> : <Badge>Off</Badge>}</td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => resetPin(s)}>Change PIN</button>
                    {s.id !== me.staff.id && <button className="btn btn-ghost btn-sm" onClick={() => update(s, { active: !s.active })}>{s.active ? 'Switch off' : 'Switch on'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Clubs({ me }) {
  const [clubs, setClubs] = useState(null);
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/api/admin/clubs').then((r) => setClubs(r.clubs)); }, []);
  const owner = me.staff.role === 'owner';

  async function save(c) {
    setMsg({ [c.id]: null });
    try { await api(`/api/admin/clubs/${c.id}`, { method: 'PUT', body: c }); setMsg({ [c.id]: ['ok', 'Saved.'] }); }
    catch (e) { setMsg({ [c.id]: ['bad', e.message] }); }
  }
  if (!clubs) return <Spinner />;
  return (
    <div className="stack">
      <Alert kind="warn">Bills are printed as <b>Receipts</b> until you add the club's GSTIN. With a GSTIN they become <b>Tax Invoices</b> with CGST and SGST.</Alert>
      {clubs.map((c, i) => (
        <div className="card stack" key={c.id}>
          <h3>{c.name}</h3>
          {[['legal_name', 'Legal / business name (as on GST)'], ['address', 'Address on bills'], ['phone', 'Phone'], ['gstin', 'GSTIN'], ['invoice_prefix', 'Bill number prefix']].map(([k, label]) => (
            <label className="field" key={k}><span>{label}</span>
              <input className="input" disabled={!owner} value={c[k] || ''} onChange={(e) => setClubs(clubs.map((x, j) => (j === i ? { ...x, [k]: k === 'gstin' || k === 'invoice_prefix' ? e.target.value.toUpperCase() : e.target.value } : x)))} />
            </label>
          ))}
          {msg[c.id] && <Alert kind={msg[c.id][0]}>{msg[c.id][1]}</Alert>}
          {owner && <button className="btn btn-gold" onClick={() => save(c)}>Save {c.name.replace('Mayfair Poker Lounge, ', '')}</button>}
        </div>
      ))}
    </div>
  );
}

function Settings({ me }) {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api('/api/admin/settings').then((r) => setS(r.settings)); }, []);
  const owner = me.staff.role === 'owner';
  if (!s) return <Spinner />;

  async function save() {
    setMsg(null);
    const { consent_version: _c, ...body } = s;
    try { setS((await api('/api/admin/settings', { method: 'PUT', body })).settings); setMsg(['ok', 'Saved.']); }
    catch (e) { setMsg(['bad', e.message]); }
  }
  const rupeeField = (key, label) => (
    <label className="field"><span>{label}</span>
      <input className="input" inputMode="numeric" disabled={!owner} value={s[key] / 100} onChange={(e) => setS({ ...s, [key]: Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || 0 })} />
    </label>
  );

  return (
    <div className="card stack" style={{ maxWidth: 640 }}>
      <h3>Entry</h3>
      {rupeeField('entry_fee_paise', 'Entry fee per visit (₹)')}
      <label className="field"><span>Guests included per entry</span>
        <input className="input" inputMode="numeric" disabled={!owner} value={s.entry_guests_included} onChange={(e) => setS({ ...s, entry_guests_included: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
      <h3>GST (confirm with your CA)</h3>
      <label className="field"><span>GST rate %</span>
        <input className="input" inputMode="decimal" disabled={!owner} value={s.gst_rate} onChange={(e) => setS({ ...s, gst_rate: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></label>
      <label className="check"><input type="checkbox" disabled={!owner} checked={s.gst_inclusive} onChange={(e) => setS({ ...s, gst_inclusive: e.target.checked })} />
        <span>Entry fee already includes GST (₹{s.entry_fee_paise / 100} total). Untick to add GST on top.</span></label>
      <label className="field"><span>SAC code</span>
        <input className="input" inputMode="numeric" disabled={!owner} value={s.sac_code} onChange={(e) => setS({ ...s, sac_code: e.target.value.replace(/\D/g, '') })} /></label>
      <h3>Cash rules (used by the cashier module)</h3>
      {rupeeField('tds_threshold_paise', 'TDS applies to a single payout above (₹)')}
      <label className="field"><span>TDS rate %</span>
        <input className="input" inputMode="numeric" disabled={!owner} value={s.tds_rate} onChange={(e) => setS({ ...s, tds_rate: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></label>
      {rupeeField('cash_receipt_limit_paise', 'Warn before taking this much cash from one person in a day (₹)')}
      <label className="check"><input type="checkbox" disabled={!owner} checked={s.collect_bank} onChange={(e) => setS({ ...s, collect_bank: e.target.checked })} />
        <span>Collect bank details (off: not needed for a cash-only club)</span></label>
      {msg && <Alert kind={msg[0]}>{msg[1]}</Alert>}
      {owner ? <button className="btn btn-gold" onClick={save}>Save settings</button> : <p className="small muted">Only the owner can change settings.</p>}
      <p className="small muted">Current entry: {rupees(s.entry_fee_paise)}{s.gst_inclusive ? ' including' : ' plus'} {s.gst_rate}% GST.</p>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/admin/audit').then((r) => setRows(r.audit)); }, []);
  if (!rows) return <Spinner />;
  return (
    <div className="card t-wrap">
      <table className="t">
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="small">{new Date(a.at).toLocaleString('en-IN')}</td>
              <td>{a.staff_name || a.member_name || a.actor_kind}<br /><span className="small muted">{a.actor_kind}</span></td>
              <td>{a.action}</td>
              <td className="small muted" style={{ maxWidth: 420, wordBreak: 'break-word' }}>{a.target_kind ? `${a.target_kind} ${a.target_id} ` : ''}{a.details ? JSON.stringify(a.details) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
