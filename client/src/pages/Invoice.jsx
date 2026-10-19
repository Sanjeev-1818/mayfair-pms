import { useEffect, useState } from 'react';
import { api, fmtDate, rupees } from '../api.js';
import { Alert, Spinner } from '../components/ui.jsx';

export default function Invoice({ token }) {
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/api/invoices/${token}`).then((d) => setInv(d.invoice)).catch((e) => setError(e.message)); }, [token]);

  if (error) return <main className="shell"><Alert>{error}</Alert></main>;
  if (!inv) return <main className="shell center"><Spinner /></main>;
  const tax = inv.doc_type === 'tax_invoice';
  const half = inv.gst_rate / 2;

  return (
    <>
      <div className="invoice">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{tax ? 'Tax Invoice' : 'Receipt'}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>{inv.invoice_no} · {fmtDate(inv.created_at)}</p>
          </div>
          <img src="/icon-512.png" alt="Mayfair" style={{ width: 64, borderRadius: 6 }} />
        </div>
        <hr style={{ border: 0, borderTop: '1px solid #ddd', margin: '18px 0' }} />
        <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 340 }}>
            <b>{inv.legal_name || inv.club_name}</b><br />
            <span className="muted">{inv.club_address}</span><br />
            {inv.club_phone && <span className="muted">{inv.club_phone}<br /></span>}
            {inv.gstin && <span>GSTIN: <b>{inv.gstin}</b><br /></span>}
            <span className="muted">State: {inv.state_name} ({inv.state_code})</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="muted">Billed to</span><br />
            <b>{inv.customer_name}</b><br />
            {inv.member_code && <span className="muted">Member {inv.member_code}<br /></span>}
            <span className="muted">Paid by {inv.mode?.toUpperCase()}</span>
          </div>
        </div>
        <table>
          <thead><tr><th>Description</th>{tax && <th>SAC</th>}<th className="r">Amount</th></tr></thead>
          <tbody>
            <tr><td>{inv.description}</td>{tax && <td>{inv.sac || '-'}</td>}<td className="r">{rupees(inv.taxable_paise)}</td></tr>
            {tax && <tr><td>CGST @ {half}%</td><td /><td className="r">{rupees(inv.cgst_paise)}</td></tr>}
            {tax && <tr><td>SGST @ {half}%</td><td /><td className="r">{rupees(inv.sgst_paise)}</td></tr>}
            <tr><th>Total</th>{tax && <th />}<th className="r">{rupees(inv.total_paise)}</th></tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>Computer-generated {tax ? 'invoice' : 'receipt'}, no signature required. Thank you for visiting Mayfair Poker Lounge.</p>
      </div>
      <p className="center no-print"><button className="btn btn-line btn-sm" onClick={() => window.print()}>Print or save as PDF</button></p>
    </>
  );
}
