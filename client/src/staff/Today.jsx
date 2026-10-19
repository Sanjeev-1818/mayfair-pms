import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime, rupees } from '../api.js';
import { Alert, Badge, Spinner } from '../components/ui.jsx';

export default function Today({ me }) {
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(`/api/staff/today${date ? `?date=${date}` : ''}`).then(setData).catch((e) => setError(e.message)), [date]);
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  async function checkout(id) {
    await api(`/api/staff/visits/${id}/checkout`, { method: 'POST' }).catch((e) => setError(e.message));
    load();
  }

  if (!data) return <div className="center" style={{ padding: 60 }}>{error ? <Alert>{error}</Alert> : <Spinner />}</div>;
  const t = data.totals;
  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }} className="stack">
      <div className="spread wrap">
        <div><p className="eyebrow" style={{ margin: 0 }}>{me.club.name.replace('Mayfair Poker Lounge, ', '')}</p><h2>Business day {data.date}</h2></div>
        <input className="input" type="date" style={{ width: 'auto' }} value={date || data.date} onChange={(e) => setDate(e.target.value)} aria-label="Business day" />
      </div>
      <div className="stats">
        <div className="stat"><b>{t.players}</b><span>Player entries</span></div>
        <div className="stat"><b>{t.guests}</b><span>Guests</span></div>
        <div className="stat"><b>{t.inside}</b><span>Inside now</span></div>
        <div className="stat"><b>{rupees(t.cash)}</b><span>Cash</span></div>
        <div className="stat"><b>{rupees(t.upi)}</b><span>UPI</span></div>
        <div className="stat"><b>{rupees(t.card)}</b><span>Card</span></div>
        <div className="stat"><b>{rupees(t.cash + t.upi + t.card)}</b><span>Total entry</span></div>
      </div>
      <Alert>{error}</Alert>
      <div className="card t-wrap">
        <table className="t">
          <thead><tr><th>In</th><th>Member</th><th>Guest</th><th>Paid</th><th>Bill</th><th>By</th><th>Status</th></tr></thead>
          <tbody>
            {data.visits.length === 0 && <tr><td colSpan={7} className="muted">No entries yet.</td></tr>}
            {data.visits.map((v) => (
              <tr key={v.id}>
                <td>{fmtTime(v.checked_in_at)}</td>
                <td>{v.name}<br /><span className="small muted">{v.member_code}</span></td>
                <td>{v.guest || <span className="muted">-</span>}</td>
                <td>{v.amount_paise != null ? `${rupees(v.amount_paise)} ${v.mode}` : '-'}</td>
                <td>{v.invoice_no ? <a href={`/invoice/${v.share_token}`} target="_blank" rel="noreferrer">{v.invoice_no}</a> : '-'}</td>
                <td className="small muted">{v.staff}</td>
                <td>{v.status === 'in' ? <button className="btn btn-line btn-sm" onClick={() => checkout(v.id)}>Check out</button>
                  : <Badge>Left {fmtTime(v.checked_out_at)}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
