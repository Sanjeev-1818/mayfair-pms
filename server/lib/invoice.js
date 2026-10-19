import { financialYear } from './time.js';
import { randomToken } from './security.js';

// GST is worked out from the settings (rate, inclusive or not). Intra-state (Haryana) so CGST + SGST.
export function gstSplit(amountPaise, rate, inclusive) {
  if (!rate) return { taxable: amountPaise, cgst: 0, sgst: 0, total: amountPaise };
  const taxable = inclusive ? Math.round((amountPaise * 100) / (100 + rate)) : amountPaise;
  const tax = inclusive ? amountPaise - taxable : Math.round((amountPaise * rate) / 100);
  const cgst = Math.floor(tax / 2);
  return { taxable, cgst, sgst: tax - cgst, total: taxable + tax };
}

// Invoice numbers are sequential per club per financial year, max 16 characters (GST rule): MPLG/26-27/00001
export async function createInvoice(q, { club, paymentId, memberId, description, customerName, customerPhone, amountPaise, settings }) {
  const fy = financialYear();
  const [{ last_seq: seq }] = await q.query(
    `INSERT INTO invoice_counters (club_id, fy, last_seq) VALUES ($1,$2,1)
     ON CONFLICT (club_id, fy) DO UPDATE SET last_seq = invoice_counters.last_seq + 1 RETURNING last_seq`,
    [club.id, fy],
  );
  const invoiceNo = `${club.invoice_prefix}/${fy}/${String(seq).padStart(5, '0')}`;
  const isTax = !!club.gstin;
  const rate = isTax ? Number(settings.gst_rate) : 0;
  const split = gstSplit(amountPaise, rate, settings.gst_inclusive);
  const [invoice] = await q.query(
    `INSERT INTO invoices (club_id, payment_id, member_id, invoice_no, fy, seq, doc_type, description, customer_name,
       customer_phone, sac, gst_rate, taxable_paise, cgst_paise, sgst_paise, total_paise, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [club.id, paymentId, memberId, invoiceNo, fy, seq, isTax ? 'tax_invoice' : 'receipt', description, customerName,
      customerPhone, settings.sac_code || null, rate, split.taxable, split.cgst, split.sgst, split.total, randomToken(18)],
  );
  return invoice;
}
