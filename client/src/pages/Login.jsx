import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../nav.js';
import { Alert, Orn, Spinner, TestBanner, TopBar } from '../components/ui.jsx';

export default function Login() {
  const [options, setOptions] = useState(null);
  const [req, setReq] = useState(null);       // { requestId, nonce, message, whatsappUrl }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(null);
  const [code, setCode] = useState('');
  const polling = useRef(null);
  const params = new URLSearchParams(window.location.search);

  useEffect(() => {
    api('/api/auth/options').then(setOptions).catch(() => setOptions({}));
    if (params.get('club')) try { localStorage.setItem('mpl_club', params.get('club')); } catch { /* private mode */ }
    return () => clearTimeout(polling.current);
  }, []);

  function finish(r) {
    clearTimeout(polling.current);
    navigate(r.next || '/', { replace: true });
  }

  function poll(id) {
    clearTimeout(polling.current);
    polling.current = setTimeout(async () => {
      try {
        const r = await api(`/api/auth/poll/${id}`);
        if (r.done) return finish(r);
      } catch (e) {
        if (e.status === 410) { setReq(null); setError(e.message); return; }
      }
      poll(id);
    }, document.hidden ? 4000 : 1500);
  }

  async function start(openWhatsApp) {
    setError(''); setBusy(true);
    try {
      const r = await api('/api/auth/start', { method: 'POST', body: {} });
      setReq(r);
      poll(r.requestId);
      if (openWhatsApp && r.whatsappUrl) window.location.href = r.whatsappUrl;
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function simulate() {
    setError(''); setBusy(true);
    try { await api('/api/auth/test/whatsapp', { method: 'POST', body: { requestId: req.requestId, phone } }); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function sendCode() {
    setError(''); setBusy(true);
    try { setCodeSent(await api('/api/auth/code/send', { method: 'POST', body: { requestId: req.requestId, phone } })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function verifyCode() {
    setError(''); setBusy(true);
    try { finish(await api('/api/auth/code/verify', { method: 'POST', body: { requestId: req.requestId, code } })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!options) return <div className="shell center" style={{ paddingTop: 80 }}><Spinner /></div>;
  const canSignIn = options.whatsapp || options.testMode;

  return (
    <>
      <TestBanner on={options.testMode} />
      <main className="shell">
        <TopBar />
        <p className="eyebrow">Members</p>
        <h1>Welcome to Mayfair</h1>
        <p className="lede" style={{ marginTop: 10 }}>Sign in, or become a member in under a minute. Nothing to type.</p>
        <Orn />
        {params.get('expired') && !req && <Alert kind="warn">That sign-in link has expired. Please start again.</Alert>}
        {params.get('blocked') && <Alert>This membership is not active. Please contact the club.</Alert>}

        {!canSignIn && <Alert kind="warn">Online sign-in opens soon. Please visit the desk and we will register you in a minute.</Alert>}

        {canSignIn && !req && (
          <div className="stack">
            <button className="btn btn-wa btn-block btn-xl" onClick={() => start(true)} disabled={busy}>
              <WhatsAppIcon /> Continue with WhatsApp
            </button>
            <p className="small muted center">WhatsApp opens with a message ready. Tap send and come back here. Your number is confirmed instantly.</p>
          </div>
        )}

        {req && (
          <div className="card stack">
            <div className="row"><Spinner /><b>Waiting for your WhatsApp message…</b></div>
            <p className="small muted" style={{ margin: 0 }}>
              Send <b style={{ color: 'var(--gold)' }}>{req.message}</b> {options.whatsapp ? 'to Mayfair on WhatsApp' : ''}. This page will continue by itself.
            </p>
            {req.whatsappUrl && <a className="btn btn-wa btn-block" href={req.whatsappUrl}><WhatsAppIcon /> Open WhatsApp again</a>}

            {options.testMode && (
              <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <p className="eyebrow" style={{ margin: 0 }}>Test mode</p>
                <label className="field"><span>Mobile number</span>
                  <div className="prefix"><b>+91</b><input className="input" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="10-digit mobile" /></div>
                </label>
                <button className="btn btn-line btn-block" onClick={simulate} disabled={busy || phone.length !== 10}>Pretend I sent the WhatsApp</button>
                {!codeSent ? (
                  <button className="btn btn-ghost" onClick={sendCode} disabled={busy || phone.length !== 10}>Or get a 6-digit code</button>
                ) : (
                  <div className="stack">
                    {codeSent.testCode && <Alert kind="warn">Test code: <b>{codeSent.testCode}</b></Alert>}
                    <input className="input big" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="6-digit code" />
                    <button className="btn btn-gold btn-block" onClick={verifyCode} disabled={busy || code.length !== 6}>Sign in</button>
                  </div>
                )}
              </div>
            )}
            <button className="btn btn-ghost" onClick={() => { clearTimeout(polling.current); setReq(null); setCodeSent(null); }}>Start again</button>
          </div>
        )}
        <div style={{ marginTop: 14 }}><Alert>{error}</Alert></div>

        <section className="card" style={{ marginTop: 28 }}>
          <h3>New to Mayfair?</h3>
          <ol className="small muted" style={{ paddingLeft: 18, margin: '10px 0 0' }}>
            <li>Continue with WhatsApp</li>
            <li>Scan the QR on the back of your Aadhaar</li>
            <li>Take a photo of your PAN card</li>
            <li>Take a selfie. You get your member pass instantly.</li>
          </ol>
          <p className="small muted" style={{ margin: '12px 0 0' }}>Players aged 18 and over only. Entry is ₹2,500 per visit and includes one guest.</p>
        </section>
        <p className="center small" style={{ marginTop: 28 }}><a href="https://www.mayfairlounge.in/">mayfairlounge.in</a> · <a href="https://www.mayfairlounge.in/responsible-play.html">Responsible play</a></p>
      </main>
    </>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z" />
    </svg>
  );
}
