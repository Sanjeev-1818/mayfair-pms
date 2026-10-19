# Mayfair PMS

Poker Management System for Mayfair Poker Lounge. See README.md for the full guide.

- Node 20, Express API in `server/`, React (Vite) app in `client/`, built into `dist/`.
- Database: Replit PostgreSQL via `DATABASE_URL` (migrations in `server/migrations/` run on start).
- Files: Replit Object Storage when `REPLIT_OBJECT_STORAGE=1`.
- Run: `npm run build && npm start` (port 5000). Tests: `npm test`.
- Required secrets: ENCRYPTION_KEY, SESSION_SECRET, OWNER_PHONE, OWNER_PIN, APP_URL. Optional: WA_* for WhatsApp sign-in.
- Never change ENCRYPTION_KEY after real data exists (PAN numbers are encrypted with it).
- Never store full Aadhaar numbers; only the last 4 digits are kept.
