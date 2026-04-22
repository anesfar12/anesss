-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- PostgreSQL 18 | File: 002_core_tables.sql
-- Core: Organizations, Locations, Users, Devices, Feature Flags, Sequences
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PostgreSQL 18 io_uring tuning comment ─────────────────────────────────
-- In postgresql.conf (Supabase managed param override):
--   io_method = io_uring   (async I/O — enabled for pg18)
--   max_parallel_workers_per_gather = 4
--   max_worker_processes = 16

-- ══════════════════════════════════════════════════════
-- SEQUENCES (17 total — all use nextval(), race-safe)
-- ══════════════════════════════════════════════════════

CREATE SEQUENCE seq_receipt_number       START 100001 INCREMENT 1 CACHE 20;
CREATE SEQUENCE seq_invoice_number       START 10001  INCREMENT 1 CACHE 10;
CREATE SEQUENCE seq_po_number            START 50001  INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_journal_entry        START 1      INCREMENT 1 CACHE 10;
CREATE SEQUENCE seq_loyalty_txn          START 1      INCREMENT 1 CACHE 50;
CREATE SEQUENCE seq_delivery_number      START 20001  INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_appointment_number   START 30001  INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_campaign_number      START 40001  INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_batch_number         START 60001  INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_formula_number       START 70001  INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_customer_number      START 100001 INCREMENT 1 CACHE 20;
CREATE SEQUENCE seq_product_sku          START 200001 INCREMENT 1 CACHE 20;
CREATE SEQUENCE seq_nfc_scan_number      START 1      INCREMENT 1 CACHE 100;
CREATE SEQUENCE seq_blockchain_job       START 1      INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_outreach_number      START 1      INCREMENT 1 CACHE 20;
CREATE SEQUENCE seq_tax_claim_number     START 1      INCREMENT 1 CACHE 5;
CREATE SEQUENCE seq_wholesale_order      START 1      INCREMENT 1 CACHE 5;

-- ══════════════════════════════════════════════════════
-- ORGANIZATIONS
-- ══════════════════════════════════════════════════════

CREATE TABLE organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  name_ar           VARCHAR(255),                          -- Arabic display name
  slug              VARCHAR(100) NOT NULL UNIQUE,
  logo_url          TEXT,
  website           TEXT,
  email             VARCHAR(255),
  phone             VARCHAR(50),
  vat_number        VARCHAR(50),                           -- UAE/KSA VAT TRN
  trn               VARCHAR(50),                           -- Tax Registration Number
  country_code      CHAR(2) NOT NULL DEFAULT 'AE',
  currency          currency_code NOT NULL DEFAULT 'AED',
  timezone          VARCHAR(50) NOT NULL DEFAULT 'Asia/Dubai',
  locale            VARCHAR(10) NOT NULL DEFAULT 'en-AE',
  settings          JSONB NOT NULL DEFAULT '{}',           -- org-wide config
  subscription_plan VARCHAR(50) NOT NULL DEFAULT 'enterprise',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);

COMMENT ON TABLE organizations IS 'Multi-tenant org root — one per boutique group';

-- ══════════════════════════════════════════════════════
-- LOCATIONS (Boutique / Warehouse)
-- ══════════════════════════════════════════════════════

CREATE TABLE locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name              VARCHAR(255) NOT NULL,
  name_ar           VARCHAR(255),
  type              VARCHAR(50) NOT NULL DEFAULT 'boutique', -- boutique|warehouse|popup
  address_line1     VARCHAR(255),
  address_line2     VARCHAR(255),
  city              VARCHAR(100),
  emirate           VARCHAR(100),                           -- Dubai, Abu Dhabi, etc.
  country_code      CHAR(2) NOT NULL DEFAULT 'AE',
  postal_code       VARCHAR(20),
  lat               DECIMAL(10, 8),
  lng               DECIMAL(11, 8),
  phone             VARCHAR(50),
  email             VARCHAR(255),
  manager_id        UUID,                                   -- FK to users (set post-creation)
  pos_terminal_count INTEGER NOT NULL DEFAULT 1,
  has_diffuser      BOOLEAN NOT NULL DEFAULT FALSE,
  diffuser_zone_ids JSONB DEFAULT '[]',                    -- IoT diffuser UUIDs
  operating_hours   JSONB DEFAULT '{}',                    -- {mon: {open: "10:00", close: "22:00"}}
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_org ON locations(organization_id);
CREATE INDEX idx_locations_active ON locations(organization_id, is_active) WHERE is_active = TRUE;

COMMENT ON TABLE locations IS 'Physical boutique or warehouse — scoped by organization';

-- ══════════════════════════════════════════════════════
-- USERS (Staff)
-- ══════════════════════════════════════════════════════

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  location_id           UUID REFERENCES locations(id),      -- home location
  email                 VARCHAR(255) NOT NULL,
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  phone                 VARCHAR(50),
  first_name            VARCHAR(100) NOT NULL,
  last_name             VARCHAR(100) NOT NULL,
  first_name_ar         VARCHAR(100),
  last_name_ar          VARCHAR(100),
  display_name          VARCHAR(200) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  avatar_url            TEXT,
  role                  user_role NOT NULL DEFAULT 'sales',
  pin_hash              TEXT,                               -- bcrypt hash of 4-6 digit PIN
  password_hash         TEXT,                               -- bcrypt hash for web dashboard
  mfa_secret            TEXT,                               -- TOTP secret (encrypted at rest)
  mfa_type              mfa_type NOT NULL DEFAULT 'none',
  mfa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  biometric_enrolled    BOOLEAN NOT NULL DEFAULT FALSE,
  biometric_type        biometric_type NOT NULL DEFAULT 'none',
  biometric_token_ref   TEXT,                               -- provider reference (not raw biometric)
  language_preference   language_preference NOT NULL DEFAULT 'en',
  commission_rate       DECIMAL(5,4) DEFAULT 0.0300,        -- e.g. 0.03 = 3%
  sales_target_monthly  DECIMAL(14,2),
  preferred_location_ids JSONB DEFAULT '[]',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at         TIMESTAMPTZ,
  last_pin_at           TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);

CREATE INDEX idx_users_org         ON users(organization_id);
CREATE INDEX idx_users_location    ON users(location_id);
CREATE INDEX idx_users_role        ON users(organization_id, role);
CREATE INDEX idx_users_active      ON users(organization_id, is_active) WHERE is_active = TRUE AND is_deleted = FALSE;
CREATE INDEX idx_users_email       ON users(email);

COMMENT ON TABLE users IS 'Staff accounts — maps to RLS via auth.uid()';

-- ══════════════════════════════════════════════════════
-- POS DEVICES
-- ══════════════════════════════════════════════════════

CREATE TABLE pos_devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  device_name       VARCHAR(100) NOT NULL,
  device_type       VARCHAR(50) NOT NULL DEFAULT 'ipad',   -- ipad|iphone|web
  device_fingerprint TEXT UNIQUE NOT NULL,                 -- derived from hardware ID
  hardware_model    VARCHAR(100),                          -- "iPad Pro M4", "iPhone 17 Pro"
  os_version        VARCHAR(50),
  app_version       VARCHAR(20),
  nfc_capable       BOOLEAN NOT NULL DEFAULT FALSE,
  uwb_nfc_capable   BOOLEAN NOT NULL DEFAULT FALSE,        -- iPhone 17 Pro UWB
  biometric_capable BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by_id    UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ,
  last_sync_at      TIMESTAMPTZ,
  is_approved       BOOLEAN NOT NULL DEFAULT FALSE,        -- requires manager approval
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  crdt_vector_clock BIGINT NOT NULL DEFAULT 0,             -- Yjs sync state
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_org      ON pos_devices(organization_id);
CREATE INDEX idx_devices_location ON pos_devices(location_id);
CREATE INDEX idx_devices_approved ON pos_devices(organization_id, is_approved) WHERE is_approved = TRUE;

COMMENT ON TABLE pos_devices IS 'Registered POS terminals — require manager approval before first use (Security Fix 5)';

-- ══════════════════════════════════════════════════════
-- USER SESSIONS & REFRESH TOKENS
-- ══════════════════════════════════════════════════════

CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       UUID REFERENCES pos_devices(id) ON DELETE SET NULL,
  refresh_token   TEXT NOT NULL UNIQUE,                    -- hashed JWT refresh token
  access_expires  TIMESTAMPTZ NOT NULL,                    -- 15 minutes
  refresh_expires TIMESTAMPTZ NOT NULL,                    -- 7 days
  ip_address      INET,
  user_agent      TEXT,
  auth_method     auth_method NOT NULL,
  is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user    ON user_sessions(user_id);
CREATE INDEX idx_sessions_refresh ON user_sessions(refresh_token) WHERE is_revoked = FALSE;
CREATE INDEX idx_sessions_expires ON user_sessions(refresh_expires) WHERE is_revoked = FALSE;

-- ══════════════════════════════════════════════════════
-- IDEMPOTENCY KEYS (checkout deduplication)
-- ══════════════════════════════════════════════════════

CREATE TABLE idempotency_keys (
  key             VARCHAR(128) PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  device_id       UUID REFERENCES pos_devices(id),
  endpoint        VARCHAR(100) NOT NULL,
  response_status INTEGER,
  response_body   JSONB,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

COMMENT ON TABLE idempotency_keys IS 'Prevents duplicate checkouts on network retry';

-- ══════════════════════════════════════════════════════
-- FEATURE FLAGS (51 flags — AI all OFF by default)
-- ══════════════════════════════════════════════════════

CREATE TABLE feature_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  flag_key        VARCHAR(100) NOT NULL,
  flag_type       feature_flag_type NOT NULL DEFAULT 'boolean',
  value_boolean   BOOLEAN,
  value_percentage DECIMAL(5,2),                           -- 0.00–100.00
  value_json      JSONB,
  value_string    TEXT,
  description     TEXT,
  is_global       BOOLEAN NOT NULL DEFAULT FALSE,          -- applies across all orgs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, flag_key)
);

CREATE INDEX idx_feature_flags_org ON feature_flags(organization_id);
CREATE INDEX idx_feature_flags_key ON feature_flags(flag_key) WHERE is_global = TRUE;

COMMENT ON TABLE feature_flags IS 'Database-driven feature flags — AI flags all FALSE by default';

-- ══════════════════════════════════════════════════════
-- AUDIT LOG (security & compliance)
-- ══════════════════════════════════════════════════════

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  user_id         UUID REFERENCES users(id),
  device_id       UUID REFERENCES pos_devices(id),
  action          VARCHAR(100) NOT NULL,                   -- e.g. 'user.login', 'transaction.void'
  resource_type   VARCHAR(100),
  resource_id     UUID,
  old_data        JSONB,
  new_data        JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);                         -- monthly partitions

-- Create initial partitions (2026)
CREATE TABLE audit_log_2026_01 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_log_2026_02 PARTITION OF audit_log
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_log_2026_03 PARTITION OF audit_log
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_log_2026_04 PARTITION OF audit_log
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_log_2026_06 PARTITION OF audit_log
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_log_2026_07 PARTITION OF audit_log
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_log_2026_09 PARTITION OF audit_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_log_2026_10 PARTITION OF audit_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_log_2026_12 PARTITION OF audit_log
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE INDEX idx_audit_org    ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_user   ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

-- ══════════════════════════════════════════════════════
-- CRDT DELTA QUEUE (offline-first sync)
-- ══════════════════════════════════════════════════════

CREATE TABLE crdt_delta_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  device_id       UUID REFERENCES pos_devices(id),
  document_type   VARCHAR(50) NOT NULL,                    -- 'inventory', 'cart', 'customer_profile'
  document_id     UUID NOT NULL,
  delta_type      crdt_delta_type NOT NULL,
  delta_payload   JSONB NOT NULL,
  vector_clock    BIGINT NOT NULL,
  status          crdt_delta_status NOT NULL DEFAULT 'crdt_pending',
  applied_at      TIMESTAMPTZ,
  conflict_data   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crdt_pending   ON crdt_delta_queue(organization_id, status, created_at)
  WHERE status = 'crdt_pending';
CREATE INDEX idx_crdt_document  ON crdt_delta_queue(document_type, document_id);
CREATE INDEX idx_crdt_gc        ON crdt_delta_queue(status, created_at)
  WHERE status = 'crdt_applied';

COMMENT ON TABLE crdt_delta_queue IS 'CRDT deltas from offline POS terminals — merged inside pg18 transactions with advisory lock (Fix 2)';
