import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gstSplit } from '../server/lib/invoice.js';
import { financialYear, businessDate, ageOn } from '../server/lib/time.js';
import { passToken, readPassToken, normalizeIndianPhone, encrypt, decrypt } from '../server/lib/security.js';
import { cleanPan, nameMatches } from '../server/lib/members.js';

test('GST inside ₹2,500 at 18%', () => {
  const s = gstSplit(250000, 18, true);
  assert.equal(s.total, 250000);
  assert.equal(s.taxable, 211864);
  assert.equal(s.cgst + s.sgst, 38136);
});

test('GST added on top', () => {
  assert.deepEqual(gstSplit(100000, 18, false), { taxable: 100000, cgst: 9000, sgst: 9000, total: 118000 });
});

test('financial year and business day are in India time', () => {
  assert.equal(financialYear(new Date('2026-03-31T18:30:00Z')), '26-27'); // midnight, 1 April IST
  assert.equal(financialYear(new Date('2026-03-31T18:00:00+05:30')), '25-26');
  assert.equal(businessDate(new Date('2026-10-19T02:00:00+05:30')), '2026-10-18'); // 2 am still belongs to last night
  assert.equal(businessDate(new Date('2026-10-19T07:00:00+05:30')), '2026-10-19');
});

test('age', () => {
  assert.equal(ageOn('2008-10-20', new Date('2026-10-19T12:00:00+05:30')), 17);
  assert.equal(ageOn('2008-10-19', new Date('2026-10-19T12:00:00+05:30')), 18);
});

test('member pass cannot be forged', () => {
  const t = passToken('MPL-G-00001');
  assert.equal(readPassToken(t), 'MPL-G-00001');
  assert.equal(readPassToken(t.replace('00001', '00002')), null);
});

test('phone, PAN and encryption helpers', () => {
  assert.equal(normalizeIndianPhone('099913 00311'), '+919991300311');
  assert.equal(normalizeIndianPhone('+91 99913-00311'), '+919991300311');
  assert.equal(normalizeIndianPhone('12345'), null);
  assert.equal(cleanPan('abcpe 1234 f'), 'ABCPE1234F');
  assert.throws(() => cleanPan('ABCCE1234F'), /business PAN/);
  assert.equal(nameMatches('Rohan Sharma', 'INCOME TAX DEPARTMENT ROHAN SHARMA RAJESH SHARMA'), true);
  assert.equal(nameMatches('Rohan Sharma', 'PRIYA GUPTA'), false);
  assert.equal(decrypt(encrypt('ABCPE1234F')), 'ABCPE1234F');
});
