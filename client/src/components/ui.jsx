export function Orn() {
  return <div className="orn" aria-hidden="true"><span /><img src="/monogram.png" alt="" /><span /></div>;
}

export function TopBar({ right }) {
  return (
    <header className="top">
      <a href="/" aria-label="Mayfair home"><img src="/logo-horizontal.png" alt="Mayfair Poker Lounge" /></a>
      {right}
    </header>
  );
}

export function Alert({ kind = 'bad', children }) {
  if (!children) return null;
  return <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>{children}</div>;
}

export const Spinner = ({ label }) => <span className="row" style={{ justifyContent: 'center' }}><span className="spinner" aria-hidden="true" />{label && <span className="muted">{label}</span>}</span>;

export function Badge({ kind, children }) {
  return <span className={`badge ${kind || ''}`}>{children}</span>;
}

export function TestBanner({ on }) {
  return on ? <div className="test-banner">Test mode · sign-in codes are shown on screen</div> : null;
}

export function SignatureBadge({ status }) {
  if (status === 'verified') return <Badge kind="ok">✓ Aadhaar verified by UIDAI signature</Badge>;
  if (status === 'not_checked') return <Badge kind="warn">Aadhaar read · signature not checked</Badge>;
  if (status === 'unsigned') return <Badge kind="warn">Old Aadhaar QR · check card</Badge>;
  if (status === 'manual') return <Badge kind="warn">Other ID · check card</Badge>;
  if (status === 'invalid') return <Badge kind="bad">Aadhaar failed check</Badge>;
  return null;
}
