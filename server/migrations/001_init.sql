-- Mayfair PMS: Phase 1 schema. Money is stored in paise (integer). Nothing is hard-deleted.

CREATE TABLE clubs (
  id text PRIMARY KEY,                -- 'gurugram', 'panchkula'
  code text NOT NULL UNIQUE,          -- 'G', 'P' (used in member codes)
  name text NOT NULL,
  legal_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  state_name text NOT NULL DEFAULT 'Haryana',
  state_code text NOT NULL DEFAULT '06',
  invoice_prefix text NOT NULL,
  member_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE staff (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('owner','manager','cashier','floor','dealer')),
  club_id text REFERENCES clubs(id),  -- NULL = all clubs
  pin_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id serial PRIMARY KEY,
  member_code text UNIQUE,
  phone text NOT NULL UNIQUE,         -- E.164, e.g. +919991300311
  phone_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','registered','active','blocked')),
  name text,
  dob date,
  gender text,
  care_of text,
  address text,
  pincode text,
  home_club text REFERENCES clubs(id),
  identity_hash text,                 -- hash of name+dob+aadhaar last 4, to spot duplicates
  consent_at timestamptz,
  consent_version text,
  registered_via text,                -- 'self', 'desk'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX members_identity_idx ON members(identity_hash);
CREATE INDEX members_name_idx ON members(lower(name));

CREATE TABLE member_kyc (
  member_id integer PRIMARY KEY REFERENCES members(id),
  id_type text,                       -- 'aadhaar_qr', 'aadhaar_xml', 'passport', 'driving_licence', 'voter_id'
  aadhaar_last4 text,
  aadhaar_signature text,             -- 'verified', 'invalid', 'not_checked', 'unsigned'
  aadhaar_qr_version text,
  aadhaar_mobile_match boolean,
  pan_enc text,
  pan_hash text,                      -- keyed hash, to stop one PAN being used on two accounts
  pan_masked text,
  pan_source text,                    -- 'qr', 'ocr', 'typed'
  pan_name_match boolean,
  bank_enc text,                      -- optional, off by default (settings.collect_bank)
  verified_by integer REFERENCES staff(id),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX member_kyc_pan_idx ON member_kyc(pan_hash);

CREATE TABLE member_documents (
  id serial PRIMARY KEY,
  member_id integer NOT NULL REFERENCES members(id),
  kind text NOT NULL,                 -- 'selfie', 'aadhaar_photo', 'pan_image', 'alt_id'
  storage_key text NOT NULL,
  mime text NOT NULL DEFAULT 'image/jpeg',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_documents_member_idx ON member_documents(member_id, kind);

CREATE TABLE login_requests (
  id text PRIMARY KEY,                -- secret held only by the browser that started sign-in
  nonce text NOT NULL UNIQUE,         -- short code sent in the WhatsApp message
  link_token text UNIQUE,             -- one-time link sent back on WhatsApp
  phone text,
  code_hash text,                     -- SMS/WhatsApp code fallback
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','used','expired')),
  via text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz
);

CREATE TABLE sessions (
  id text PRIMARY KEY,                -- sha256 of the cookie token
  kind text NOT NULL CHECK (kind IN ('member','staff')),
  subject_id integer NOT NULL,
  club_id text REFERENCES clubs(id),  -- staff: the club this desk is working for
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE visits (
  id serial PRIMARY KEY,
  member_id integer NOT NULL REFERENCES members(id),
  club_id text NOT NULL REFERENCES clubs(id),
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'in' CHECK (status IN ('in','out')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by integer REFERENCES staff(id),
  checked_out_at timestamptz
);
CREATE INDEX visits_day_idx ON visits(club_id, business_date);
CREATE INDEX visits_member_idx ON visits(member_id);

CREATE TABLE guests (
  id serial PRIMARY KEY,
  visit_id integer NOT NULL REFERENCES visits(id),
  name text NOT NULL,
  phone text,
  dob date,
  aadhaar_last4 text,
  id_checked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id serial PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id),
  member_id integer REFERENCES members(id),
  visit_id integer REFERENCES visits(id),
  kind text NOT NULL,                 -- 'entry' (Phase 3 adds 'buy_in', 'cash_out')
  amount_paise integer NOT NULL,
  mode text NOT NULL CHECK (mode IN ('cash','upi','card')),
  reference text,
  received_by integer REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_club_day_idx ON payments(club_id, created_at);

CREATE TABLE invoice_counters (
  club_id text NOT NULL REFERENCES clubs(id),
  fy text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (club_id, fy)
);

CREATE TABLE invoices (
  id serial PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id),
  payment_id integer NOT NULL REFERENCES payments(id),
  member_id integer REFERENCES members(id),
  invoice_no text NOT NULL UNIQUE,
  fy text NOT NULL,
  seq integer NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('tax_invoice','receipt')),
  description text NOT NULL,
  customer_name text,
  customer_phone text,
  sac text,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  taxable_paise integer NOT NULL,
  cgst_paise integer NOT NULL DEFAULT 0,
  sgst_paise integer NOT NULL DEFAULT 0,
  total_paise integer NOT NULL,
  share_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_kind text NOT NULL,           -- 'member', 'staff', 'system'
  actor_id integer,
  action text NOT NULL,
  target_kind text,
  target_id text,
  club_id text,
  details jsonb,
  ip text
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);
