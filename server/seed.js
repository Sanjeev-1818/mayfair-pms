import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config, DATA_DIR } from './config.js';
import { hashPin, numericCode, normalizeIndianPhone } from './lib/security.js';

export const DEFAULT_SETTINGS = {
  entry_fee_paise: 250000,     // ₹2,500 per visit
  entry_guests_included: 1,    // one player plays, one guest may enter
  gst_rate: 18,                // confirm with CA
  gst_inclusive: true,         // ₹2,500 includes GST
  sac_code: '',                // confirm with CA
  min_age: 18,
  collect_bank: false,         // bank details are not needed for a cash-only club
  tds_threshold_paise: 1000000,  // Phase 3: TDS on a single payout above ₹10,000
  tds_rate: 30,
  cash_receipt_limit_paise: 20000000, // Phase 3: warn before ₹2 lakh cash from one person in a day
  consent_version: '2026-10',
};

const CLUBS = [
  { id: 'gurugram', code: 'G', name: 'Mayfair Poker Lounge, Gurugram', invoice_prefix: 'MPLG', phone: '+91 99913 00311',
    address: 'Basement, Limewood Stay Oasis, 1873-P, Sector 52, near Ardee Mall, Golf Course Road, Gurugram, Haryana 122003' },
  { id: 'panchkula', code: 'P', name: 'Mayfair Poker Lounge, Panchkula', invoice_prefix: 'MPLP', phone: '+91 99911 30077',
    address: 'SCO 10, Sector 5, Panchkula, Haryana 134109' },
];

export async function seed() {
  for (const c of CLUBS) {
    await db.query(
      `INSERT INTO clubs (id, code, name, legal_name, address, phone, invoice_prefix) VALUES ($1,$2,$3,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`, [c.id, c.code, c.name, c.address, c.phone, c.invoice_prefix]);
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(value)]);
  }

  // First owner account. Production: set OWNER_PHONE and OWNER_PIN secrets before first start.
  const { n } = await db.one('SELECT count(*)::int AS n FROM staff');
  if (n === 0) {
    const phone = normalizeIndianPhone(config.ownerPhone) || '+919999999999';
    const pin = config.ownerPin || numericCode(6);
    await db.query(`INSERT INTO staff (name, phone, role, pin_hash) VALUES ('Owner', $1, 'owner', $2)`, [phone, hashPin(pin)]);
    if (!config.ownerPin) {
      const file = path.join(DATA_DIR, 'FIRST-LOGIN.txt');
      fs.writeFileSync(file, `Staff login: ${phone}\nPIN: ${pin}\nChange this PIN in Admin → Staff after first login.\n`, { mode: 0o600 });
      console.log(`Owner account created. Login details saved in ${file}`);
    }
  }
}

export async function getSettings(q = db) {
  const rows = await q.query('SELECT key, value FROM settings');
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
