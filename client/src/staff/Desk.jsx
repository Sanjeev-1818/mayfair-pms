// Front desk: one screen. Scan (member pass or Aadhaar) or search -> check face + ID -> guest -> payment -> bill. Done.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, fmtDate, fmtTime, rupees } from '../api.js';
import Scanner from '../components/Scanner.jsx';
import Camera from '../components/Camera.jsx';
import { Alert, Badge, SignatureBadge, Spinner } from '../components/ui.jsx';

export default function Desk({ me }) {
  const [member, setMember] = useState(null);
  const [walkin, setWalkin] = useState(null);     // { qr, prefill } or { manual: true }
  const [receipt, setReceipt] = useState(null);
  const [scanKey, setScanKey] = useState(0);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setMember(null); setWalkin(null); setReceipt(null); setError('');
    setScanKey((k) => k + 1); setScanning(true);
  }

  async function onScan(text) {
    setBusy(true); setError('');
    try {
      const r = await api('/api/staff/scan', { method: 'POST', body: { text } });
      setScanning(false);
      if (r.member) { setMember(r.member); setWalkin(null); setReceipt(null); }
      else if (r.walkin) { setWalkin({ qr: text, prefill: r.walkin }); setMember(null); }
    } catch (e) {
      setError(e.message);
      setScanKey((k) => k + 1);
    } finally { setBusy(false); }
  }

  async function openMember(id) {
    setBusy(true); setError('');
    try {
      const r = await api(`/api/staff/members/${id}`);
      setMember(r.member); setWalkin(null); setReceipt(null); setScanning(false);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="desk">
      <aside className="stack">
        <div className="card stack">
          <div className="spread"><h3>Scan</h3>
            <button className="btn btn-ghost small" onClick={() => { setScanning((s) => !s); setScanKey((k) => k + 1); }}>{scanning ? 'Camera off' : 'Camera on'}</button>
          </div>
          {scanning && <Scanner key={scanKey} onResult={onScan} wide hint="Member pass or Aadhaar QR" uploadLabel="Read QR from a photo" />}
          {busy && <Spinner label="Looking up…" />}
          <Alert>{error}</Alert>
        </div>
        <Search onPick={openMember} />
        <button className="btn btn-line btn-block" onClick={() => { setWalkin({ manual: true }); setMember(null); setReceipt(null); setScanning(false); }}>
          New walk-in without smartphone
        </button>
        <div className="card small muted">
          <b style={{ color: 'var(--gold)' }}>Players with a phone</b> can register themselves from the QR standee at the door while you serve others.
          They then show their member pass here.
        </div>
      </aside>

      <section>
        {receipt ? <Receipt receipt={receipt} onNext={reset} />
          : member ? <MemberPanel member={member} me={me} onChange={setMember} onCheckedIn={setReceipt} onClose={reset} />
            : walkin ? <Walkin me={me} walkin={walkin} onCreated={(m) => { setWalkin(null); setMember(m); }} onCancel={reset} />
              : <Idle />}
      </section>
    </div>
  );
}

function Idle() {
  return (
    <div className="card center" style={{ padding: '60px 20px' }}>
      <img src="/monogram.png" alt="" style={{ width: 60, margin: '0 auto 18px', opacity: 0.8 }} />
      <h2>Ready for the next player</h2>
      <p className="muted" style={{ marginTop: 10 }}>Scan their member pass, scan their Aadhaar, or search by phone, name or member ID.</p>
    </div>
  );
}

function Search({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return undefined; }
    timer.current = setTimeout(() => api(`/api/staff/search?q=${encodeURIComponent(q)}`).then((r) => setResults(r.results)).catch(() => {}), 250);
    return () => clearTimeout(timer.current);
  }, [q]);
  return (
    <div className="card">
      <label className="field"><span>Search</span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Phone, name or MPL-G-00012" autoComplete="off" />
      </label>
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.id}><button onClick={() => { onPick(r.id); setQ(''); }}>
              <span>{r.name || 'Not registered yet'}<br /><span className="small muted">{r.member_code || 'no member ID'} · {r.phone}</span></span>
              <StatusBadge status={r.status} />
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const StatusBadge = ({ status }) => ({
  active: <Badge kind="ok">Active</Badge>,
  registered: <Badge kind="warn">First visit</Badge>,
  new: <Badge>Registering</Badge>,
  blocked: <Badge kind="bad">Blocked</Badge>,
}[status] || null);

function Photo({ memberId, kind, label }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure>
      {failed ? <div className="noimg">No {label.toLowerCase()}</div>
        : <img src={`/api/staff/members/${memberId}/doc/${kind}`} alt={label} onError={() => setFailed(true)} />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function MemberPanel({ member: m, me, onChange, onCheckedIn, onClose }) {
  const [guestOn, setGuestOn] = useState(false);
  const [guest, setGuest] = useState({ name: '', phone: '', idChecked: false, qr: null, scanned: null });
  const [guestScan, setGuestScan] = useState(false);
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [askAgain, setAskAgain] = useState(false);
  const firstVisit = m.status === 'registered';
  const docs = m.steps?.docs || [];
  const idPhoto = docs.includes('aadhaar_photo') ? ['aadhaar_photo', 'Aadhaar photo'] : docs.includes('alt_id') ? ['alt_id', 'ID card'] : ['aadhaar_photo', 'Aadhaar photo'];

  async function checkin(force = false) {
    setBusy(true); setError('');
    try {
      const body = {
        memberId: m.id, verify: firstVisit, mode, reference: reference || undefined, force,
        guest: guestOn ? (guest.qr ? { qr: guest.qr, phone: guest.phone } : { name: guest.name, phone: guest.phone, idChecked: guest.idChecked }) : null,
      };
      const r = await api('/api/staff/checkin', { method: 'POST', body });
      onCheckedIn({ ...r, guest: guestOn ? (guest.scanned?.name || guest.name) : null });
    } catch (e) {
      if (e.data?.alreadyIn) setAskAgain(true);
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onGuestScan(text) {
    setGuestScan(false);
    try {
      const r = await api('/api/staff/scan', { method: 'POST', body: { text } });
      const p = r.walkin || r.member;
      setGuest((g) => ({ ...g, qr: text, scanned: { name: p.name, age: p.age }, name: p.name, idChecked: true }));
    } catch (e) { setError(`Guest: ${e.message}`); }
  }

  async function checkout() {
    await api(`/api/staff/visits/${m.today.id}/checkout`, { method: 'POST' });
    onChange((await api(`/api/staff/members/${m.id}`)).member);
  }

  const fee = rupees(me.settings.entryFeePaise);
  const blocked = m.status === 'blocked';
  const incomplete = m.status === 'new';

  return (
    <div className="card stack">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>{m.code || 'Not registered'}</p>
          <h2 style={{ marginTop: 6 }}>{m.name || m.phone}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {m.age != null && `${m.age} yrs · `}{m.gender && `${m.gender} · `}{m.phone}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="faces">
        <Photo memberId={m.id} kind="selfie" label="Selfie" />
        <Photo memberId={m.id} kind={idPhoto[0]} label={idPhoto[1]} />
      </div>

      <div className="row wrap">
        <StatusBadge status={m.status} />
        <SignatureBadge status={m.kyc?.signature} />
        {m.kyc?.mobileMatch === true && <Badge kind="ok">✓ Mobile matches Aadhaar</Badge>}
        {m.kyc?.panMasked ? <Badge kind={m.kyc.panNameMatch === false ? 'warn' : 'ok'}>PAN {m.kyc.panMasked}{m.kyc.panNameMatch === false ? ' · name differs' : ''}</Badge> : <Badge kind="bad">No PAN</Badge>}
        {m.phoneVerified ? <Badge kind="ok">✓ WhatsApp number</Badge> : <Badge kind="warn">Phone not verified</Badge>}
      </div>
      {m.kyc?.aadhaarLast4 && <p className="small muted" style={{ margin: 0 }}>Aadhaar XXXX XXXX {m.kyc.aadhaarLast4}{m.dob && ` · born ${fmtDate(m.dob)}`}{m.stats?.visits ? ` · ${m.stats.visits} visit${m.stats.visits === 1 ? '' : 's'}` : ' · first visit'}</p>}

      {blocked && <Alert>This membership is blocked. Do not check in. Call the manager.</Alert>}
      {incomplete && <Alert kind="warn">This player has not finished registering. Ask them to finish on their phone, or use “New walk-in”.</Alert>}

      {m.today?.status === 'in' && (
        <Alert kind="ok">
          Checked in today at {fmtTime(m.today.checked_in_at)}{m.today.invoice_no && ` · bill ${m.today.invoice_no}`}.{' '}
          <button className="btn btn-ghost btn-sm" onClick={checkout}>Check out</button>
        </Alert>
      )}

      {!blocked && !incomplete && (
        <>
          {firstVisit && (
            <Alert kind="warn">
              <b>First visit:</b> check the person in front of you matches both photos{m.kyc?.signature !== 'verified' ? ' and look at their original ID card' : ''}.
            </Alert>
          )}

          <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <label className="check"><input type="checkbox" checked={guestOn} onChange={(e) => setGuestOn(e.target.checked)} />
              <span>Bringing a guest (included in the {fee} entry)</span></label>
            {guestOn && (
              <div className="stack" style={{ paddingLeft: 34 }}>
                {guestScan ? <Scanner onResult={onGuestScan} wide hint="Guest's Aadhaar QR" />
                  : guest.scanned ? <Badge kind="ok">✓ {guest.scanned.name}, {guest.scanned.age} yrs (Aadhaar scanned)</Badge>
                    : (
                      <>
                        <button className="btn btn-line btn-sm" onClick={() => setGuestScan(true)}>Scan guest's Aadhaar (fastest)</button>
                        <div className="row wrap">
                          <input className="input" style={{ flex: '2 1 200px' }} placeholder="Guest name" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
                          <input className="input" style={{ flex: '1 1 140px' }} placeholder="Mobile (optional)" inputMode="numeric" maxLength={10} value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value.replace(/\D/g, '') })} />
                        </div>
                        <label className="check"><input type="checkbox" checked={guest.idChecked} onChange={(e) => setGuest({ ...guest, idChecked: e.target.checked })} />
                          <span>I have seen the guest's photo ID. They are 18 or older.</span></label>
                      </>
                    )}
              </div>
            )}
          </div>

          <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <div className="chips" role="group" aria-label="Payment">
              {[['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']].map(([v, l]) => (
                <button key={v} className="chip" aria-pressed={mode === v} onClick={() => setMode(v)}>{l}</button>
              ))}
            </div>
            {mode !== 'cash' && <input className="input" placeholder={mode === 'upi' ? 'UPI ref (last 4-6 digits, optional)' : 'Card slip number (optional)'} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </div>

          <Alert>{error}</Alert>
          {askAgain ? (
            <div className="row wrap">
              <button className="btn btn-gold btn-xl" style={{ flex: 1 }} onClick={() => checkin(true)} disabled={busy}>Yes, new entry · {fee}</button>
              <button className="btn btn-line btn-xl" onClick={() => { setAskAgain(false); setError(''); }}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-gold btn-block btn-xl" onClick={() => checkin(false)} disabled={busy || (guestOn && !guest.qr && (!guest.name || !guest.idChecked))}>
              {busy ? 'Saving…' : `${firstVisit ? 'Verify & check in' : 'Check in'} · ${fee} ${mode}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Receipt({ receipt, onNext }) {
  const { invoice, member } = receipt;
  const canvas = useRef(null);
  const link = `${window.location.origin}/invoice/${invoice.share_token}`;
  useEffect(() => { QRCode.toCanvas(canvas.current, link, { margin: 1, width: 360 }); }, [link]);
  const wa = `https://wa.me/${member.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Mayfair Poker Lounge: your bill ${invoice.invoice_no} for ${rupees(invoice.total_paise)}. ${link}`)}`;

  useEffect(() => {
    const t = setTimeout(onNext, 45_000); // back to scanning automatically
    return () => clearTimeout(t);
  }, [onNext]);

  return (
    <div className="card stack center">
      <div style={{ fontSize: 44, color: 'var(--ok)' }} aria-hidden="true">✓</div>
      <h2>{member.name} is checked in</h2>
      <p className="muted" style={{ margin: 0 }}>{member.code}{receipt.guest ? ` · guest ${receipt.guest}` : ''}</p>
      <p className="lede" style={{ margin: '6px auto 0' }}>{rupees(invoice.total_paise)} · {invoice.doc_type === 'tax_invoice' ? 'Tax invoice' : 'Receipt'} {invoice.invoice_no}</p>
      <div className="qrbox" style={{ width: 200 }}><canvas ref={canvas} /></div>
      <p className="small muted" style={{ margin: 0 }}>Player can scan for the bill. It is also saved in their member app.</p>
      <div className="row wrap" style={{ justifyContent: 'center' }}>
        <a className="btn btn-wa btn-sm" href={wa} target="_blank" rel="noreferrer">Send on WhatsApp</a>
        <a className="btn btn-line btn-sm" href={`/invoice/${invoice.share_token}`} target="_blank" rel="noreferrer">Print</a>
      </div>
      <button className="btn btn-gold btn-block btn-xl" onClick={onNext}>Next player</button>
    </div>
  );
}

function Walkin({ me, walkin, onCreated, onCancel }) {
  const [qr, setQr] = useState(walkin.qr || null);
  const [prefill, setPrefill] = useState(walkin.prefill || null);
  const [useAlt, setUseAlt] = useState(false);
  const [alt, setAlt] = useState({ idType: 'driving_licence', name: '', dob: '', image: null });
  const [phone, setPhone] = useState('');
  const [pan, setPan] = useState('');
  const [selfie, setSelfie] = useState(null);
  const [facing, setFacing] = useState('environment');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onScan(text) {
    setError('');
    try {
      const r = await api('/api/staff/scan', { method: 'POST', body: { text } });
      if (r.member) { onCreated(r.member); return; }
      setQr(text); setPrefill(r.walkin);
    } catch (e) { setError(e.message); }
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      const r = await api('/api/staff/walkin', { method: 'POST', body: { phone, qr: useAlt ? null : qr, alt: useAlt ? alt : null, pan, selfie, consent } });
      onCreated(r.member);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const idReady = useAlt ? alt.name && alt.dob && alt.image : !!qr;
  return (
    <div className="card stack">
      <div className="spread"><h2>New walk-in</h2><button className="btn btn-ghost" onClick={onCancel}>Cancel</button></div>
      <p className="muted small" style={{ margin: 0 }}>For players without a smartphone. Takes about a minute.</p>

      <h3>1 · ID</h3>
      {!useAlt && (prefill ? (
        <div className="stack">
          <div><b>{prefill.name}</b> · {prefill.age} yrs · {prefill.gender} · Aadhaar XXXX {prefill.last4}</div>
          <p className="small muted" style={{ margin: 0 }}>{prefill.address}</p>
          <SignatureBadge status={prefill.signature} />
        </div>
      ) : <Scanner onResult={onScan} wide hint="Player's Aadhaar QR" uploadLabel="Read from a photo" />)}
      <button className="btn btn-ghost" onClick={() => setUseAlt(!useAlt)}>{useAlt ? 'Use Aadhaar instead' : 'No Aadhaar? Use another photo ID'}</button>
      {useAlt && (
        <div className="stack">
          <div className="chips">{[['driving_licence', 'Driving licence'], ['passport', 'Passport'], ['voter_id', 'Voter ID']].map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={alt.idType === v} onClick={() => setAlt({ ...alt, idType: v })}>{l}</button>))}</div>
          <input className="input" placeholder="Full name as on ID" value={alt.name} onChange={(e) => setAlt({ ...alt, name: e.target.value })} />
          <input className="input" type="date" value={alt.dob} onChange={(e) => setAlt({ ...alt, dob: e.target.value })} aria-label="Date of birth" />
          {alt.image ? <img src={alt.image} alt="ID" style={{ maxWidth: 260, borderRadius: 4 }} /> : <Camera facing="environment" onCapture={(img) => setAlt({ ...alt, image: img })} shutterLabel="Photo of ID" />}
        </div>
      )}

      <h3>2 · Mobile and PAN</h3>
      <div className="row wrap">
        <div className="prefix" style={{ flex: '1 1 200px' }}><b>+91</b><input className="input" inputMode="numeric" maxLength={10} placeholder="Mobile" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} /></div>
        <input className="input" style={{ flex: '1 1 200px', letterSpacing: '.12em' }} maxLength={10} placeholder="PAN e.g. ABCPE1234F" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
      </div>

      <h3>3 · Photo</h3>
      {selfie ? (
        <div className="row"><img src={selfie} alt="Player" style={{ width: 120, borderRadius: 4 }} /><button className="btn btn-ghost" onClick={() => setSelfie(null)}>Retake</button></div>
      ) : (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>Switch camera</button>
          <Camera key={facing} facing={facing} onCapture={setSelfie} shutterLabel="Take player's photo" />
        </>
      )}

      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="small">I told the player we keep their name, date of birth, address, photo, last 4 Aadhaar digits and PAN for registration, identity checks and tax rules, and they agreed. They are 18 or older.</span></label>
      <Alert>{error}</Alert>
      <button className="btn btn-gold btn-block btn-xl" onClick={submit} disabled={busy || !idReady || phone.length !== 10 || pan.length !== 10 || !selfie || !consent}>
        {busy ? 'Creating member…' : `Create member at ${me.club.name.replace('Mayfair Poker Lounge, ', '')}`}
      </button>
    </div>
  );
}
