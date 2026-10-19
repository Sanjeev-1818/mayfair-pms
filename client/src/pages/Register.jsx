import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { navigate } from '../nav.js';
import Scanner from '../components/Scanner.jsx';
import Camera from '../components/Camera.jsx';
import { Alert, Badge, SignatureBadge, Spinner, TopBar } from '../components/ui.jsx';
import { findPan, ocrImage, preloadOcr } from '../lib/pan.js';
import { readQr } from '../lib/qr.js';

const STEPS = ['identity', 'pan', 'selfie', 'confirm'];

export default function Register() {
  const [me, setMe] = useState(null);
  const [step, setStep] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api('/api/me');
      if (data.member.code) return navigate('/', { replace: true });
      setMe(data);
      const s = data.member.steps;
      setStep((cur) => cur || (!s.identity ? 'identity' : !s.pan ? 'pan' : !s.selfie ? 'selfie' : 'confirm'));
    } catch (e) {
      if (e.status === 401) navigate('/login', { replace: true });
      else setError(e.message);
    }
  }, []);

  useEffect(() => { load(); preloadOcr().catch(() => {}); }, [load]);

  if (!me) return <main className="shell"><TopBar />{error ? <Alert>{error}</Alert> : <Spinner />}</main>;
  const index = STEPS.indexOf(step);

  return (
    <main className="shell">
      <TopBar right={<span className="small muted">Step {index + 1} of 4</span>} />
      <div className="progress" aria-hidden="true">{STEPS.map((s, i) => <i key={s} className={i <= index ? 'on' : ''} />)}</div>
      {step === 'identity' && <IdentityStep me={me} onDone={async () => { await load(); setStep('pan'); }} />}
      {step === 'pan' && <PanStep onDone={async () => { await load(); setStep('selfie'); }} onBack={() => setStep('identity')} />}
      {step === 'selfie' && <SelfieStep onDone={async () => { await load(); setStep('confirm'); }} onBack={() => setStep('pan')} />}
      {step === 'confirm' && <ConfirmStep me={me} onBack={() => setStep('selfie')} />}
    </main>
  );
}

function IdentityStep({ me, onDone }) {
  const [mode, setMode] = useState(me.member.steps.identity ? 'review' : 'scan');
  const [result, setResult] = useState(me.member.steps.identity ? {
    name: me.member.name, dob: me.member.dob, age: me.member.age, gender: me.member.gender, address: me.member.address,
    last4: me.member.kyc?.aadhaarLast4, signature: me.member.kyc?.signature, mobileMatch: me.member.kyc?.mobileMatch,
    hasPhoto: me.member.steps.docs.includes('aadhaar_photo'),
  } : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  async function onScan(text) {
    setBusy(true); setError('');
    try {
      setResult(await api('/api/register/aadhaar', { method: 'POST', body: { qr: text } }));
      setMode('review');
    } catch (e) {
      setError(e.message);
      setAttempt((n) => n + 1);
    } finally { setBusy(false); }
  }

  if (mode === 'alt') return <AltIdForm onDone={onDone} onBack={() => setMode('scan')} />;

  if (mode === 'review' && result) {
    return (
      <div className="stack">
        <p className="eyebrow">Is this you?</p>
        <h1>{result.name}</h1>
        <div className="card">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {result.hasPhoto && <img src={`/api/me/doc/aadhaar_photo?v=${Date.now()}`} alt="Photo from Aadhaar" style={{ width: 84, borderRadius: 4, border: '1px solid var(--line)' }} />}
            <dl className="kv" style={{ flex: 1 }}>
              {result.dob && <><dt>Born</dt><dd>{fmtDate(result.dob)}</dd></>}
              {result.age != null && <><dt>Age</dt><dd>{result.age}</dd></>}
              {result.gender && <><dt>Gender</dt><dd>{result.gender}</dd></>}
              {result.last4 && <><dt>Aadhaar</dt><dd>XXXX XXXX {result.last4}</dd></>}
            </dl>
          </div>
          {result.address && <p className="small muted" style={{ margin: '14px 0 0' }}>{result.address}</p>}
          <div className="row wrap" style={{ marginTop: 14 }}>
            <SignatureBadge status={result.signature} />
            {result.mobileMatch === true && <Badge kind="ok">✓ Mobile matches Aadhaar</Badge>}
          </div>
        </div>
        <button className="btn btn-gold btn-block btn-xl" onClick={onDone}>Yes, this is me</button>
        <button className="btn btn-ghost btn-block" onClick={() => { setResult(null); setMode('scan'); }}>Scan again</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="eyebrow">Your Aadhaar</p>
      <h1>Scan the QR on your Aadhaar</h1>
      <p className="muted">It is the big QR code on the back of the card, in e-Aadhaar, or in the mAadhaar app. We read your name, date of birth and address from it, so you type nothing.</p>
      {busy ? <div className="card center"><Spinner label="Reading your Aadhaar…" /></div>
        : <Scanner key={attempt} onResult={onScan} hint="Fit the whole Aadhaar QR in the frame" />}
      <Alert>{error}</Alert>
      <button className="btn btn-ghost btn-block" onClick={() => setMode('alt')}>No Aadhaar with me? Use passport, driving licence or voter ID</button>
    </div>
  );
}

function AltIdForm({ onDone, onBack }) {
  const [idType, setIdType] = useState('driving_licence');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError('');
    try { await api('/api/register/alt-id', { method: 'POST', body: { idType, name, dob, image } }); onDone(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="eyebrow">Other photo ID</p>
      <h1>Your photo ID</h1>
      <div className="chips" role="group" aria-label="ID type">
        {[['driving_licence', 'Driving licence'], ['passport', 'Passport'], ['voter_id', 'Voter ID']].map(([v, l]) => (
          <button key={v} className="chip" aria-pressed={idType === v} onClick={() => setIdType(v)}>{l}</button>
        ))}
      </div>
      {!image ? <Camera facing="environment" onCapture={setImage} hint="Photo page or front of the card" shutterLabel="Take photo of ID" />
        : (
          <div className="stack">
            <img src={image} alt="Your ID" style={{ borderRadius: 4, border: '1px solid var(--line)' }} />
            <button className="btn btn-ghost" onClick={() => setImage(null)}>Retake photo</button>
          </div>
        )}
      <label className="field"><span>Full name as on the ID</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <label className="field"><span>Date of birth</span><input className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></label>
      <Alert>{error}</Alert>
      <button className="btn btn-gold btn-block btn-xl" onClick={save} disabled={busy || !image || !name || !dob}>{busy ? 'Saving…' : 'Continue'}</button>
      <p className="small muted center">The desk will check this ID on your first visit.</p>
      <button className="btn btn-ghost btn-block" onClick={onBack}>Back to Aadhaar scan</button>
    </div>
  );
}

function PanStep({ onDone, onBack }) {
  const [image, setImage] = useState(null);
  const [reading, setReading] = useState(false);
  const [pan, setPan] = useState('');
  const [source, setSource] = useState('typed');
  const [ocrText, setOcrText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);

  async function onCapture(dataUrl) {
    setImage(dataUrl); setReading(true); setNote(''); setError('');
    try {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const qrText = await readQr(c.getContext('2d').getImageData(0, 0, c.width, c.height)).catch(() => null);
      const fromQr = findPan(qrText);
      if (fromQr) { setPan(fromQr); setSource('qr'); return; }
      const text = await ocrImage(dataUrl);
      setOcrText(text);
      const found = findPan(text);
      if (found) { setPan(found); setSource('ocr'); }
      else { setNote('We could not read the PAN number from the photo. Please type it, or take a clearer photo.'); setSource('typed'); }
    } catch {
      setNote('Please type your PAN number.');
    } finally { setReading(false); }
  }

  async function save() {
    setBusy(true); setError('');
    try { await api('/api/register/pan', { method: 'POST', body: { pan, source, image, ocrText } }); onDone(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const valid = /^[A-Z]{5}\d{4}[A-Z]$/.test(pan);
  return (
    <div className="stack">
      <p className="eyebrow">Your PAN</p>
      <h1>Photo of your PAN card</h1>
      <p className="muted">Needed by income-tax rules. We read the number from the photo.</p>
      {!image && !typing && (
        <>
          <Camera facing="environment" onCapture={onCapture} hint="Fit the PAN card in the frame" shutterLabel="Take photo of PAN" />
          <button className="btn btn-ghost btn-block" onClick={() => setTyping(true)}>Type my PAN instead</button>
        </>
      )}
      {image && <img src={image} alt="Your PAN card" style={{ borderRadius: 4, border: '1px solid var(--line)' }} />}
      {reading && <div className="card center"><Spinner label="Reading your PAN…" /></div>}
      {(typing || (image && !reading)) && (
        <>
          {note && <Alert kind="warn">{note}</Alert>}
          <label className="field"><span>PAN number</span>
            <input className="input big" value={pan} maxLength={10} autoCapitalize="characters" spellCheck={false}
              onChange={(e) => { setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setSource(image ? source : 'typed'); }} placeholder="ABCDE1234F" />
          </label>
          {source !== 'typed' && valid && <p className="small muted" style={{ marginTop: -6 }}>Read from your card. Please check it is right.</p>}
          <Alert>{error}</Alert>
          <button className="btn btn-gold btn-block btn-xl" onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Continue'}</button>
          {image && <button className="btn btn-ghost btn-block" onClick={() => { setImage(null); setPan(''); setNote(''); }}>Retake photo</button>}
        </>
      )}
      <button className="btn btn-ghost btn-block" onClick={onBack}>Back</button>
    </div>
  );
}

function SelfieStep({ onDone, onBack }) {
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError('');
    try { await api('/api/register/selfie', { method: 'POST', body: { image } }); onDone(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="eyebrow">Your photo</p>
      <h1>A quick selfie</h1>
      <p className="muted">For your member card. Face the camera, no sunglasses or cap.</p>
      {!image ? <Camera facing="user" onCapture={setImage} hint="Your face inside the oval" shutterLabel="Take selfie" />
        : (
          <>
            <div className="camera"><img src={image} alt="Your selfie" /></div>
            <Alert>{error}</Alert>
            <button className="btn btn-gold btn-block btn-xl" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Use this photo'}</button>
            <button className="btn btn-ghost btn-block" onClick={() => setImage(null)}>Retake</button>
          </>
        )}
      <button className="btn btn-ghost btn-block" onClick={onBack}>Back</button>
    </div>
  );
}

function ConfirmStep({ me, onBack }) {
  let saved = '';
  try { saved = localStorage.getItem('mpl_club') || ''; } catch { /* private mode */ }
  const [clubId, setClubId] = useState(me.clubs.some((c) => c.id === saved) ? saved : '');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true); setError('');
    try {
      await api('/api/register/complete', { method: 'POST', body: { clubId, consent } });
      navigate('/?welcome=1', { replace: true });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="eyebrow">Last step</p>
      <h1>Choose your club</h1>
      <p className="muted">Your membership works at both clubs. Pick the one you will visit most.</p>
      <div className="chips" role="group" aria-label="Home club">
        {me.clubs.map((c) => (
          <button key={c.id} className="chip" aria-pressed={clubId === c.id} onClick={() => setClubId(c.id)}>{c.name.replace('Mayfair Poker Lounge, ', '')}</button>
        ))}
      </div>
      <div className="card small">
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I am 18 or older. I agree that Mayfair Poker Lounge may keep my name, date of birth, address, photo, the last 4 digits of my Aadhaar
            and my PAN to register me, check my identity at the door and meet tax and legal rules. My details are stored securely, are never
            sold, and I can ask the club to see or correct them. I have read the <a href="https://www.mayfairlounge.in/membership.html" target="_blank" rel="noreferrer">house rules</a> and <a href="https://www.mayfairlounge.in/responsible-play.html" target="_blank" rel="noreferrer">responsible play</a> policy.
          </span>
        </label>
      </div>
      <Alert>{error}</Alert>
      <button className="btn btn-gold btn-block btn-xl" onClick={finish} disabled={busy || !clubId || !consent}>{busy ? 'Creating your pass…' : 'Become a member'}</button>
      <button className="btn btn-ghost btn-block" onClick={onBack}>Back</button>
    </div>
  );
}
