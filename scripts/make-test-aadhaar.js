// Makes a sample Aadhaar Secure QR image for testing the scanner (signed with a throwaway key, so the
// app reports "signature not checked" or "failed" for it, exactly as it would for a fake).
// Usage: node scripts/make-test-aadhaar.js out.png [name] [dd-mm-yyyy] [last4] [mobile]
import QRCode from 'qrcode';
import { makeSecureQr } from '../test/fixtures.js';

const [out = 'test-aadhaar.png', name, dob, last4, mobile] = process.argv.slice(2);
const text = await makeSecureQr({ name, dob, last4, mobile });
await QRCode.toFile(out, [{ data: text, mode: 'numeric' }], { errorCorrectionLevel: 'M', margin: 4, scale: 4 });
console.log(`${out}: ${text.length} digits`);
