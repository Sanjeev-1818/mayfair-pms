# Mayfair PMS: Poker Management System

Member sign-in, 40-second registration, member pass, and front desk for Mayfair Poker Lounge (Gurugram and Panchkula).
Phase 1 of the PMS. Floor, cashier and accounting are built on top of it next.

## How a player joins (nothing to type)

1. **Continue with WhatsApp**: the player sends one ready-made message. WhatsApp proves the phone number. Free, no SMS OTP.
2. **Scan the Aadhaar QR**: name, date of birth (18+ check), gender, address, photo and last 4 digits are read from UIDAI's signed QR. A fake or edited QR fails the signature check.
3. **Photo of the PAN card**: the PAN number is read from the photo on the phone.
4. **Selfie**, pick a club, tick consent. The member pass (QR) appears instantly.

At the desk: scan the pass, compare the selfie with the Aadhaar photo, add a guest (scan their Aadhaar), choose cash, tap **Check in**.
The visit, payment, and bill number (`MPLG/26-27/00001`) are created automatically. The bill appears in the member's app and can be sent on WhatsApp.

Not collected: typed address, bank details (not needed for a cash-only club), photocopies, paper registers.

## Pages

| URL | Who | What |
|---|---|---|
| `/login` | Players | Sign in / join with WhatsApp |
| `/register` | Players | 4-step registration |
| `/` | Players | Member pass, visits, bills, details |
| `/staff` | Staff | Front desk: scan, verify, check in, walk-ins |
| `/staff/today` | Staff | Today's entries, guests, cash/UPI/card totals, check out |
| `/staff/admin` | Manager, owner | Members, staff and PINs, club GSTIN, settings, activity log |
| `/invoice/<token>` | Anyone with the link | Printable receipt / tax invoice |

Staff roles: **owner** (everything), **manager** (admin except settings and club details), **cashier** and **floor** (front desk), **dealer** (no desk access yet).
Full PAN and PAN card images: manager and owner only. Every look at a member's ID is recorded in the activity log.

## Run on Replit

1. Import this GitHub repo into Replit.
2. Tools → **Database** → add PostgreSQL (this sets `DATABASE_URL`).
3. Tools → **Object Storage** → create a bucket (selfies and ID photos go here).
4. Tools → **Secrets**: add the values from `.env.example` (`ENCRYPTION_KEY`, `SESSION_SECRET`, `OWNER_PHONE`, `OWNER_PIN`, `APP_URL`, `REPLIT_OBJECT_STORAGE=1`).
   Keep `ENCRYPTION_KEY` safe and never change it: PANs are encrypted with it.
5. Press **Run**, then **Deploy** (Autoscale). Point `members.mayfairlounge.in` at the deployment.
6. Sign in at `/staff` with the owner phone and PIN, then add GSTINs in Admin → Clubs & GST and create staff accounts.

### Aadhaar signature check
Download UIDAI's offline e-KYC public certificate (`.cer`) from uidai.gov.in and put it in `certs/`.
Without it the app still reads Aadhaar QRs but shows "signature not checked", and the desk should look at the original card.

### WhatsApp sign-in
Needs a WhatsApp Business **API** number from Meta (developers.facebook.com → WhatsApp → Cloud API). It must be a number not used in the normal WhatsApp app.
Set `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_NUMBER`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`,
and set the webhook URL to `https://members.mayfairlounge.in/api/whatsapp/webhook` (subscribe to `messages`).
Until then, `AUTH_TEST_MODE=1` lets you test with on-screen codes. **Never leave test mode on for real players.**

## Develop on a Mac

```bash
npm install
npm run dev        # http://localhost:5173 (API on 5050)
npm test           # 20 tests: Aadhaar reader, GST, full desk journey, permissions
```

Local data lives in `data/` (embedded database, uploads, generated dev secrets, first owner PIN in `data/FIRST-LOGIN.txt`).
`node scripts/make-test-aadhaar.js test.png "Name" 15-08-1992 1234 9991300311` makes a sample Aadhaar QR for testing the scanner.

## Settings to confirm with the CA
GST rate and whether ₹2,500 includes GST (default: 18%, included) · SAC code · TDS on winnings (default: 30% above ₹10,000 per payout) ·
cash limit warning (default ₹2 lakh per person per day). All are in Admin → Settings. No code change needed.

## Code map
- `server/`: Express API. `lib/aadhaar.js` (Secure QR reader), `lib/members.js` (registration rules), `routes/staff.js` (front desk), `migrations/` (database tables)
- `client/src/`: React app. `pages/` (player), `staff/` (desk and admin), `components/Scanner.jsx` (QR camera)
- `test/`: automated tests
