import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { api } from '../api.js';
import { navigate } from '../nav.js';
import { Alert, Spinner } from '../components/ui.jsx';

const Desk = lazy(() => import('./Desk.jsx'));
const Today = lazy(() => import('./Today.jsx'));
const Admin = lazy(() => import('./Admin.jsx'));

export default function Staff({ path }) {
  const [me, setMe] = useState(undefined);
  const load = useCallback(() => api('/api/staff/me').then(setMe).catch(() => setMe(null)), []);
  useEffect(() => { load(); }, [load]);

  if (me === undefined) return <div className="shell center" style={{ paddingTop: 80 }}><Spinner /></div>;
  if (me === null) return <StaffLogin onDone={load} />;

  const isManager = ['manager', 'owner'].includes(me.staff.role);
  const link = (to, label) => (
    <a href={to} aria-current={path === to ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate(to); }}>{label}</a>
  );
  async function logout() {
    await api('/api/staff/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
  }
  async function switchClub(clubId) {
    await api('/api/staff/club', { method: 'POST', body: { clubId } });
    load();
  }

  return (
    <>
      <header className="staff-top">
        <img src="/logo-horizontal.png" alt="Mayfair" />
        <nav>{link('/staff', 'Front desk')}{link('/staff/today', 'Today')}{isManager && link('/staff/admin', 'Admin')}</nav>
        <div className="who">
          {me.clubs.length > 1 ? (
            <select className="input" style={{ minHeight: 40, padding: '6px 10px', fontSize: 14, width: 'auto' }} value={me.club.id} onChange={(e) => switchClub(e.target.value)} aria-label="Club">
              {me.clubs.map((c) => <option key={c.id} value={c.id}>{c.name.replace('Mayfair Poker Lounge, ', '')}</option>)}
            </select>
          ) : <span className="muted">{me.club.name.replace('Mayfair Poker Lounge, ', '')}</span>}
          <span>{me.staff.name} <span className="muted small">· {me.staff.role}</span></span>
          <button className="btn btn-line btn-sm" onClick={logout}>Lock</button>
        </div>
      </header>
      <Suspense fallback={<div className="center" style={{ padding: 60 }}><Spinner /></div>}>
        {path === '/staff/today' ? <Today me={me} /> : path === '/staff/admin' && isManager ? <Admin me={me} /> : <Desk me={me} key={me.club.id} />}
      </Suspense>
    </>
  );
}

function StaffLogin({ onDone }) {
  const [phone, setPhone] = useState(() => { try { return localStorage.getItem('mpl_staff_phone') || ''; } catch { return ''; } });
  const [pin, setPin] = useState('');
  const [clubs, setClubs] = useState(null);
  const [clubId, setClubId] = useState(() => { try { return localStorage.getItem('mpl_staff_club') || ''; } catch { return ''; } });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/staff/login', { method: 'POST', body: { phone, pin, clubId: clubId || undefined } });
      try { localStorage.setItem('mpl_staff_phone', phone); if (clubId) localStorage.setItem('mpl_staff_club', clubId); } catch { /* ignore */ }
      onDone();
    } catch (err) {
      if (err.data?.chooseClub) setClubs((await api('/api/clubs')).clubs.map((c) => ({ ...c, name: c.name.replace('Mayfair Poker Lounge, ', '') })));
      setError(err.data?.chooseClub ? 'Choose the club this desk is at.' : err.message);
      if (!err.data?.chooseClub) setPin('');
    } finally { setBusy(false); }
  }

  return (
    <main className="shell" style={{ paddingTop: 60 }}>
      <div className="center"><img src="/logo-horizontal.png" alt="Mayfair Poker Lounge" style={{ height: 48, margin: '0 auto 26px' }} /></div>
      <form className="card stack" onSubmit={submit}>
        <p className="eyebrow" style={{ margin: 0 }}>Staff</p>
        <h2>Desk sign-in</h2>
        <label className="field"><span>Mobile number</span>
          <div className="prefix"><b>+91</b><input className="input" inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} autoComplete="username" /></div>
        </label>
        <label className="field"><span>6-digit PIN</span>
          <input className="input big" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="current-password" />
        </label>
        {clubs && (
          <div className="chips" role="group" aria-label="Club">
            {clubs.map((c) => <button type="button" key={c.id} className="chip" aria-pressed={clubId === c.id} onClick={() => setClubId(c.id)}>{c.name}</button>)}
          </div>
        )}
        <Alert>{error}</Alert>
        <button className="btn btn-gold btn-block btn-xl" disabled={busy || phone.length !== 10 || pin.length !== 6}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="center small muted" style={{ marginTop: 18 }}>Players: <a href="/login">sign in here</a></p>
    </main>
  );
}
