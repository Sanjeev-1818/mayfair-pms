// Registration logic shared by self-registration (player's phone) and desk-assisted walk-ins.
import { db } from '../db.js';
import { parseSecureQr, photoToJpeg, mobileMatches } from './aadhaar.js';
import { encrypt, hmac, passToken } from './security.js';
import { putFile } from './storage.js';
import { ageOn, istParts } from './time.js';
import { getSettings } from '../seed.js';

export class UserError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
export const identityHash = (name, dob, last4) => hmac(`id:${normName(name)}|${dob || ''}|${last4 || ''}`);
const panHash = (pan) => hmac(`pan:${pan}`);
export const maskPhone = (p) => (p ? `••••• ${p.slice(-5)}` : '');

export async function assertAdult(dob, yearOfBirth) {
  const { min_age: minAge } = await getSettings();
  const age = dob ? ageOn(dob) : yearOfBirth ? istParts().y - yearOfBirth - 1 : null;
  if (age == null) throw new UserError('We could not read the date of birth. Please use another ID.');
  if (age < minAge) throw new UserError(`Sorry, Mayfair is for players aged ${minAge} and over.`, 403, { underAge: true });
  return age;
}

// Read an Aadhaar QR (text from the scanner) and return what we found, without saving.
export async function readAadhaar(qrText, phone) {
  const parsed = parseSecureQr(qrText);
  if (parsed.signatureStatus === 'invalid') {
    throw new UserError('This Aadhaar QR failed the UIDAI security check. Please scan the original Aadhaar card or the mAadhaar app.', 422, { invalidSignature: true });
  }
  if (!parsed.name) throw new UserError('Name missing on this Aadhaar QR. Please scan again.');
  const age = await assertAdult(parsed.dob, parsed.yob);
  return { ...parsed, age, mobileMatch: mobileMatches(parsed, phone) };
}

export async function findDuplicateIdentity(hash, exceptMemberId) {
  return db.one('SELECT id, phone, member_code, status FROM members WHERE identity_hash = $1 AND id <> $2 LIMIT 1', [hash, exceptMemberId || 0]);
}

export async function saveDocument(q, memberId, kind, buffer, mime = 'image/jpeg') {
  const key = await putFile(kind, buffer);
  await q.query('INSERT INTO member_documents (member_id, kind, storage_key, mime) VALUES ($1,$2,$3,$4)', [memberId, kind, key, mime]);
}

export async function applyAadhaar(memberId, parsed) {
  const hash = identityHash(parsed.name, parsed.dob, parsed.last4);
  const dup = await findDuplicateIdentity(hash, memberId);
  if (dup) {
    throw new UserError(`This Aadhaar is already registered with the phone number ending ${dup.phone.slice(-4)}. Please sign in with that number, or ask the desk to help.`, 409, { duplicate: true });
  }
  const photoJpeg = parsed.photo ? await photoToJpeg(parsed.photo).catch(() => null) : null;
  await db.tx(async (q) => {
    await q.query(
      `UPDATE members SET name=$2, dob=$3, gender=$4, care_of=$5, address=$6, pincode=$7, identity_hash=$8, updated_at=now() WHERE id=$1`,
      [memberId, parsed.name, parsed.dob, parsed.gender, parsed.careOf, parsed.address, parsed.pincode, hash],
    );
    await q.query(
      `INSERT INTO member_kyc (member_id, id_type, aadhaar_last4, aadhaar_signature, aadhaar_qr_version, aadhaar_mobile_match)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (member_id) DO UPDATE SET id_type=$2, aadhaar_last4=$3, aadhaar_signature=$4, aadhaar_qr_version=$5,
         aadhaar_mobile_match=$6, updated_at=now()`,
      [memberId, parsed.format === 'xml_qr' ? 'aadhaar_xml' : 'aadhaar_qr', parsed.last4, parsed.signatureStatus, parsed.version, parsed.mobileMatch],
    );
    if (photoJpeg) await saveDocument(q, memberId, 'aadhaar_photo', photoJpeg);
  });
  return { hasPhoto: !!photoJpeg };
}

const ALT_IDS = { passport: 'Passport', driving_licence: 'Driving licence', voter_id: 'Voter ID' };
export async function applyAltId(memberId, { idType, name, dob, image }) {
  if (!ALT_IDS[idType]) throw new UserError('Please choose the type of ID.');
  if (normName(name).length < 3) throw new UserError('Please enter your full name as on the ID.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) throw new UserError('Please enter your date of birth.');
  await assertAdult(dob);
  const img = decodeImage(image);
  const hash = identityHash(name, dob, idType);
  await db.tx(async (q) => {
    await q.query('UPDATE members SET name=$2, dob=$3, identity_hash=$4, updated_at=now() WHERE id=$1', [memberId, String(name).trim(), dob, hash]);
    await q.query(
      `INSERT INTO member_kyc (member_id, id_type, aadhaar_signature) VALUES ($1,$2,'manual')
       ON CONFLICT (member_id) DO UPDATE SET id_type=$2, aadhaar_last4=NULL, aadhaar_signature='manual', updated_at=now()`,
      [memberId, idType],
    );
    await saveDocument(q, memberId, 'alt_id', img);
  });
}

// PAN: personal PANs have 'P' as the 4th character.
export function cleanPan(input) {
  const pan = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new UserError('That PAN does not look right. It should be like ABCDE1234F.');
  if (pan[3] !== 'P') throw new UserError('This is a business PAN. Please use your personal PAN card.');
  return pan;
}

export function nameMatches(name, text) {
  const words = normName(name).split(' ').filter((w) => w.length > 1);
  const hay = normName(text);
  if (!words.length || !hay) return null;
  return words.filter((w) => hay.includes(w)).length >= Math.ceil(words.length / 2);
}

export async function applyPan(memberId, { pan, source, image, ocrText }) {
  const clean = cleanPan(pan);
  const member = await db.one('SELECT name FROM members WHERE id = $1', [memberId]);
  const hash = panHash(clean);
  const dup = await db.one('SELECT member_id FROM member_kyc WHERE pan_hash = $1 AND member_id <> $2', [hash, memberId]);
  if (dup) throw new UserError('This PAN is already registered on another Mayfair account. Please ask the desk to help.', 409, { duplicate: true });
  const match = ocrText ? nameMatches(member?.name, ocrText) : null;
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO member_kyc (member_id, pan_enc, pan_hash, pan_masked, pan_source, pan_name_match) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (member_id) DO UPDATE SET pan_enc=$2, pan_hash=$3, pan_masked=$4, pan_source=$5, pan_name_match=$6, updated_at=now()`,
      [memberId, encrypt(clean), hash, `${clean.slice(0, 2)}XXXXX${clean.slice(7)}`, ['qr', 'ocr', 'typed'].includes(source) ? source : 'typed', match],
    );
    if (image) await saveDocument(q, memberId, 'pan_image', decodeImage(image));
  });
  return { panMasked: `${clean.slice(0, 2)}XXXXX${clean.slice(7)}`, nameMatch: match };
}

export function decodeImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new UserError('Photo missing. Please take the photo again.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 2000) throw new UserError('Photo is too small. Please take it again.');
  if (buf.length > 3_000_000) throw new UserError('Photo is too large. Please take it again.');
  return buf;
}

export async function saveSelfie(memberId, image) {
  await saveDocument(db, memberId, 'selfie', decodeImage(image));
}

export async function registrationSteps(memberId) {
  const kyc = await db.one('SELECT id_type, pan_masked FROM member_kyc WHERE member_id = $1', [memberId]);
  const docs = await db.query('SELECT DISTINCT kind FROM member_documents WHERE member_id = $1', [memberId]);
  const kinds = new Set(docs.map((d) => d.kind));
  return { identity: !!kyc?.id_type, pan: !!kyc?.pan_masked, selfie: kinds.has('selfie'), docs: [...kinds] };
}

export async function completeRegistration(memberId, { clubId, consent, via }) {
  if (!consent) throw new UserError('Please accept the consent to continue.');
  const steps = await registrationSteps(memberId);
  if (!steps.identity || !steps.pan || !steps.selfie) throw new UserError('Some steps are not finished yet.');
  const settings = await getSettings();
  return db.tx(async (q) => {
    const [m] = await q.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [memberId]);
    if (m.member_code) return m;
    const club = (await q.query('UPDATE clubs SET member_seq = member_seq + 1 WHERE id = $1 RETURNING code, member_seq', [clubId]))[0];
    if (!club) throw new UserError('Please choose your club.');
    const code = `MPL-${club.code}-${String(club.member_seq).padStart(5, '0')}`;
    const [updated] = await q.query(
      `UPDATE members SET member_code=$2, status='registered', home_club=$3, consent_at=now(), consent_version=$4,
         registered_via=$5, updated_at=now() WHERE id=$1 RETURNING *`,
      [memberId, code, clubId, settings.consent_version, via],
    );
    return updated;
  });
}

export async function memberSummary(m) {
  const kyc = await db.one(
    `SELECT k.*, s.name AS verified_by_name FROM member_kyc k LEFT JOIN staff s ON s.id = k.verified_by WHERE k.member_id = $1`, [m.id]);
  const steps = await registrationSteps(m.id);
  return {
    id: m.id,
    code: m.member_code,
    status: m.status,
    phone: m.phone,
    phoneVerified: m.phone_verified,
    name: m.name,
    dob: m.dob,
    age: m.dob ? ageOn(m.dob) : null,
    gender: m.gender,
    careOf: m.care_of,
    address: m.address,
    homeClub: m.home_club,
    registeredVia: m.registered_via,
    createdAt: m.created_at,
    pass: m.member_code ? passToken(m.member_code) : null,
    steps,
    kyc: kyc ? {
      idType: kyc.id_type,
      aadhaarLast4: kyc.aadhaar_last4,
      signature: kyc.aadhaar_signature,
      mobileMatch: kyc.aadhaar_mobile_match,
      panMasked: kyc.pan_masked,
      panSource: kyc.pan_source,
      panNameMatch: kyc.pan_name_match,
      verifiedAt: kyc.verified_at,
      verifiedBy: kyc.verified_by_name,
    } : null,
  };
}
