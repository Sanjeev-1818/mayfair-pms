import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, fmtDate, fmtTime, rupees } from '../api.js';
import { navigate } from '../nav.js';
import { Alert, Badge, Orn, Spinner, TopBar } from '../components/ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const welcome = new URLSearchParams(window.location.search).get('welcome');

  useEffect(() => {
    api('/api/me').then((d) => {
      if (!d.member.code) return navigate('/register', { replace: true });
      setData(d);
    }).catch((e) => {
      if (e.status === 401) navigate('/login' + window.location.search, { replace: true });
      else setError(e.message);
    });
  }, []);

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    navigate('/login', { replace: true });
  }

  if (!data) return <main className="shell"><TopBar />{error ? <Alert>{error}</Alert> : <Spinner />}</main>;
  const m = data.member;
  const club = data.clubs.find((c) => c.id === m.homeClub);
  const inside = data.visits.find((v) => v.status === 'in');

  return (
    <main className="shell">
      <TopBar right={<button className="btn btn-ghost small" onClick={signOut}>Sign out</button>} />
      {welcome && <div style={{ marginBottom: 16 }}><Alert kind="ok">Welcome to Mayfair, {m.name?.split(' ')[0]}. Your member pass is ready.</Alert></div>}

      <section className="mcard" aria-label="Member pass">
        <img className="mono" src="/monogram.png" alt="" />
        <p className="eyebrow" style={{ color: 'var(--gold)', margin: 0 }}>Member</p>
        <div className="name">{m.name}</div>
        <div className="code">{m.code}</div>
        <Pass token={m.pass} />
        <p className="center small" style={{ margin: 0, color: 'var(--gold)' }}>{club?.name.replace('Mayfair Poker Lounge, ', 'Home club: ')}</p>
      </section>

      <div style={{ marginTop: 16 }}>
        {m.status === 'registered' && <Alert kind="warn">Show this pass at the desk on your first visit. We match your face with your ID and you are in. It takes a few seconds.</Alert>}
        {m.status === 'active' && !inside && <p className="center muted small">Show this pass at the desk when you arrive.</p>}
        {inside && <Alert kind="ok">You are checked in at {inside.club.replace('Mayfair Poker Lounge, ', '')} since {fmtTime(inside.checked_in_at)}. Enjoy your game.</Alert>}
      </div>

      <InstallHint />
      <Orn />

      <section className="card">
        <h3>Your visits</h3>
        {data.visits.length === 0 ? <p className="muted small" style={{ margin: '10px 0 0' }}>No visits yet. See you at the table.</p> : (
          <ul className="list">
            {data.visits.map((v) => (
              <li key={v.id}><span>{fmtDate(v.business_date)}<br /><span className="small muted">{v.club.replace('Mayfair Poker Lounge, ', '')}{v.guest ? ` · guest ${v.guest}` : ''}</span></span>
                <span className="small muted" style={{ textAlign: 'right' }}>{fmtTime(v.checked_in_at)}{v.checked_out_at ? ` – ${fmtTime(v.checked_out_at)}` : ''}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Bills</h3>
        {data.invoices.length === 0 ? <p className="muted small" style={{ margin: '10px 0 0' }}>Your entry bills will appear here automatically.</p> : (
          <ul className="list">
            {data.invoices.map((i) => (
              <li key={i.invoice_no}><a href={`/invoice/${i.share_token}`} onClick={(e) => { e.preventDefault(); navigate(`/invoice/${i.share_token}`); }}>{i.invoice_no}</a>
                <span>{rupees(i.total_paise)} <span className="small muted">· {fmtDate(i.created_at)}</span></span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Your details</h3>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Mobile</dt><dd>{m.phone}</dd>
          {m.dob && <><dt>Born</dt><dd>{fmtDate(m.dob)}</dd></>}
          {m.kyc?.aadhaarLast4 && <><dt>Aadhaar</dt><dd>XXXX XXXX {m.kyc.aadhaarLast4}</dd></>}
          {m.kyc?.panMasked && <><dt>PAN</dt><dd>{m.kyc.panMasked}</dd></>}
          <dt>Status</dt><dd>{m.status === 'active' ? <Badge kind="ok">Verified member</Badge> : <Badge kind="warn">Verify on first visit</Badge>}</dd>
        </dl>
        {m.address && <p className="small muted" style={{ margin: '12px 0 0' }}>{m.address}</p>}
        <p className="small muted" style={{ margin: '12px 0 0' }}>To change any detail, please ask the desk.</p>
      </section>
      <p className="center small muted" style={{ marginTop: 24 }}>Play responsibly. Need a break? Talk to our team any time.</p>
    </main>
  );
}

function Pass({ token }) {
  const canvas = useRef(null);
  useEffect(() => {
    if (token && canvas.current) QRCode.toCanvas(canvas.current, token, { margin: 1, width: 480, color: { dark: '#2A0813', light: '#EFE6D6' } });
  }, [token]);
  return <div className="qrbox"><canvas ref={canvas} aria-label="Member pass QR code" /></div>;
}

function InstallHint() {
  const [prompt, setPrompt] = useState(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  useEffect(() => {
    const on = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  if (standalone) return null;
  if (prompt) return <button className="btn btn-line btn-block" style={{ marginTop: 14 }} onClick={() => prompt.prompt()}>Add pass to home screen</button>;
  if (/iPhone|iPad/.test(navigator.userAgent)) return <p className="center small muted" style={{ marginTop: 14 }}>Tip: tap Share, then “Add to Home Screen” to keep your pass one tap away.</p>;
  return null;
}
