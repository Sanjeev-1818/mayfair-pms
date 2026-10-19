// Business dates and financial years are always in India time, whatever the server's timezone.
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export function istParts(date = new Date()) {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() };
}

// A club night runs past midnight, so the business day changes at 6 am IST.
export function businessDate(date = new Date()) {
  const shifted = new Date(date.getTime() - 6 * 3600 * 1000);
  const { y, m, d } = istParts(shifted);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Indian financial year, e.g. '26-27' for April 2026 to March 2027.
export function financialYear(date = new Date()) {
  const { y, m } = istParts(date);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export function ageOn(dobIso, date = new Date()) {
  const [y, m, d] = dobIso.split('-').map(Number);
  const t = istParts(date);
  let age = t.y - y;
  if (t.m < m || (t.m === m && t.d < d)) age -= 1;
  return age;
}
