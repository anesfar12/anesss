-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 017_blockchain_manufacturing_ai.sql
-- Blockchain Jobs/Events, NFC Chip Keys/Provisioning,
-- Manufacturing (Mixing, QC, Material Receipts, Packaging),
-- AI (Sessions, Feedback, Search History, Product Views),
-- Finance Extras (Currency Rates, VAT Returns, Expenses)
-- Blueprint Phase 7 (Blockchain) + Phase 8-9 (AI) + Phase 10 (Manufacturing)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- BLOCKCHAIN
-- ═══════════════════════════════════════════════════════════

-- ── BLOCKCHAIN JOBS (BullMQ tracking) ────────────────────────────────────

CREATE TABLE blockchain_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  passport_id       UUID REFERENCES digital_passports(id),
  job_type          VARCHAR(30) NOT NULL DEFAULT 'mint_passport',
  bull_job_id       TEXT,                                   -- BullMQ internal job ID
  status            VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued|processing|completed|failed
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 5,
  payload           JSONB NOT NULL DEFAULT '{}',
  result            JSONB,
  error_message     TEXT,
  scheduled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  next_retry_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blockchain_jobs_passport ON blockchain_jobs(passport_id);
CREATE INDEX idx_blockchain_jobs_status   ON blockchain_jobs(organization_id, status);
CREATE INDEX idx_blockchain_jobs_retry    ON blockchain_jobs(next_retry_at)
  WHERE status = 'failed';

COMMENT ON TABLE blockchain_jobs IS 'BullMQ job tracking for async passport minting (Fix 4). Never blocks checkout.';

-- ── BLOCKCHAIN EVENTS (On-chain event log) ────────────────────────────────

CREATE TABLE blockchain_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  passport_id       UUID REFERENCES digital_passports(id),
  event_type        VARCHAR(50) NOT NULL,                   -- 'Minted'|'Transferred'|'Burned'
  block_number      BIGINT,
  transaction_hash  TEXT,
  from_address      TEXT,
  to_address        TEXT,
  token_id          TEXT,
  event_data        JSONB DEFAULT '{}',
  network           blockchain_network NOT NULL DEFAULT 'polygon',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blockchain_events_passport ON blockchain_events(passport_id);
CREATE INDEX idx_blockchain_events_hash     ON blockchain_events(transaction_hash);

-- ── NFC CHIP KEYS (KMS key-to-chip mapping) ──────────────────────────────

CREATE TABLE nfc_chip_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  kms_key_id        VARCHAR(200) NOT NULL,                  -- AWS KMS key ARN
  kms_key_alias     VARCHAR(100),
  purpose           VARCHAR(50) NOT NULL DEFAULT 'bottle_hmac', -- bottle_hmac|batch_hmac
  chip_count        INTEGER NOT NULL DEFAULT 0,             -- how many chips use this key
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at        TIMESTAMPTZ
);

CREATE INDEX idx_nfc_chip_keys_org ON nfc_chip_keys(organization_id, is_active);

-- ── NFC PROVISIONING BATCHES ──────────────────────────────────────────────

CREATE TABLE nfc_provisioning_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  batch_name        VARCHAR(100) NOT NULL,
  kms_key_id        UUID NOT NULL REFERENCES nfc_chip_keys(id),
  product_variant_id UUID REFERENCES product_variants(id), -- NULL = multi-variant batch
  chips_ordered     INTEGER NOT NULL,
  chips_provisioned INTEGER NOT NULL DEFAULT 0,
  chips_deployed    INTEGER NOT NULL DEFAULT 0,
  status            VARCHAR(20) NOT NULL DEFAULT 'ordered', -- ordered|provisioning|ready|deployed
  supplier_ref      VARCHAR(100),
  received_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfc_batches_org ON nfc_provisioning_batches(organization_id, status);

-- ═══════════════════════════════════════════════════════════
-- MANUFACTURING
-- ═══════════════════════════════════════════════════════════

-- ── MIXING SESSIONS ───────────────────────────────────────────────────────

CREATE TABLE mixing_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  formula_id        BIGINT NOT NULL REFERENCES bespoke_formulas(id),
  batch_id          BIGINT REFERENCES batch_provenance(id),
  perfumer_id       UUID NOT NULL REFERENCES users(id),
  -- Session details
  session_number    INTEGER NOT NULL DEFAULT 1,             -- iteration within the formula
  volume_ml         DECIMAL(10,2) NOT NULL,
  carrier_ml        DECIMAL(10,2) NOT NULL,
  fragrance_load    DECIMAL(5,2) NOT NULL,                  -- % concentration
  -- Status
  status            VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  notes             TEXT,
  temperature_c     DECIMAL(5,2),
  humidity_pct      DECIMAL(5,2),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  -- Materials used
  materials_used    JSONB DEFAULT '[]'                      -- [{raw_material_id, quantity_grams}]
);

CREATE INDEX idx_mixing_sessions_formula ON mixing_sessions(formula_id, started_at DESC);

-- ── QUALITY CHECKS ────────────────────────────────────────────────────────

CREATE TABLE quality_checks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  batch_id          BIGINT NOT NULL REFERENCES batch_provenance(id),
  mixing_session_id UUID REFERENCES mixing_sessions(id),
  inspector_id      UUID NOT NULL REFERENCES users(id),
  check_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  -- QC criteria
  color_pass        BOOLEAN,
  clarity_pass      BOOLEAN,
  scent_pass        BOOLEAN,
  longevity_pass    BOOLEAN,
  stability_pass    BOOLEAN,
  -- Overall
  overall_result    VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|conditional
  rejection_reason  TEXT,
  corrective_action TEXT,
  -- pH and stability
  ph_value          DECIMAL(4,2),
  stability_days    INTEGER,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quality_checks_batch ON quality_checks(batch_id, check_date DESC);

-- ── MATERIAL RECEIPTS ─────────────────────────────────────────────────────

CREATE TABLE material_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  raw_material_id   UUID NOT NULL REFERENCES raw_materials(id),
  supplier_id       UUID REFERENCES suppliers(id),
  purchase_order_id BIGINT REFERENCES purchase_orders(id),
  -- Received
  quantity_kg       DECIMAL(10,4) NOT NULL,
  unit_cost         DECIMAL(14,4) NOT NULL,
  total_cost        DECIMAL(14,2) NOT NULL,
  -- Quality
  batch_number      VARCHAR(50),
  lot_number        VARCHAR(50),
  expiry_date       DATE,
  certificate_url   TEXT,                                   -- CoA / MSDS document URL
  -- Status
  received_by       UUID NOT NULL REFERENCES users(id),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes             TEXT
);

CREATE INDEX idx_material_receipts_material ON material_receipts(raw_material_id, received_at DESC);
CREATE INDEX idx_material_receipts_org      ON material_receipts(organization_id, received_at DESC);

-- ── PACKAGING MATERIALS ───────────────────────────────────────────────────

CREATE TABLE packaging_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(255) NOT NULL,
  sku               VARCHAR(80),
  material_type     VARCHAR(50) NOT NULL,                   -- bottle|cap|box|ribbon|tissue|bag
  dimensions        JSONB,                                   -- {height_mm, width_mm, depth_mm}
  supplier_id       UUID REFERENCES suppliers(id),
  unit_cost         DECIMAL(10,4) NOT NULL,
  stock_count       INTEGER NOT NULL DEFAULT 0,
  reorder_point     INTEGER NOT NULL DEFAULT 50,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_packaging_org ON packaging_materials(organization_id, is_active);

-- ═══════════════════════════════════════════════════════════
-- AI / ANALYTICS
-- ═══════════════════════════════════════════════════════════

-- ── AI SESSIONS (Conversation Memory) ────────────────────────────────────

CREATE TABLE ai_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID REFERENCES customers(id),
  staff_id          UUID REFERENCES users(id),
  session_key       TEXT NOT NULL UNIQUE,                   -- session_id passed to AI microservice
  locale            language_preference NOT NULL DEFAULT 'en',
  -- LangGraph state
  message_count     INTEGER NOT NULL DEFAULT 0,
  context           JSONB DEFAULT '{}',                     -- conversation context
  last_model        VARCHAR(50),                            -- 'llama-3.3-70b-versatile'|'jais-30b-chat'
  -- Lifecycle
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_sessions_customer ON ai_sessions(customer_id, started_at DESC);
CREATE INDEX idx_ai_sessions_key      ON ai_sessions(session_key);

-- ── AI FEEDBACK (Thumbs up/down on recommendations) ──────────────────────

CREATE TABLE ai_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  session_id        UUID REFERENCES ai_sessions(id),
  customer_id       UUID REFERENCES customers(id),
  staff_id          UUID REFERENCES users(id),
  product_id        UUID REFERENCES products(id),
  feedback_type     VARCHAR(20) NOT NULL,                   -- 'thumbs_up'|'thumbs_down'|'purchased'|'dismissed'
  recommendation_rank INTEGER,                              -- position in the list shown
  cosine_similarity DECIMAL(6,4),                          -- similarity score at time of recommendation
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_feedback_product ON ai_feedback(product_id, created_at DESC);
CREATE INDEX idx_ai_feedback_type    ON ai_feedback(organization_id, feedback_type);

-- ── SEARCH HISTORY ────────────────────────────────────────────────────────

CREATE TABLE search_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID REFERENCES users(id),
  customer_id       UUID REFERENCES customers(id),
  query             TEXT NOT NULL,
  results_count     INTEGER NOT NULL DEFAULT 0,
  clicked_product_id UUID REFERENCES products(id),
  source            VARCHAR(30) NOT NULL DEFAULT 'pos',     -- pos|dashboard|storefront|mobile
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_history_org  ON search_history(organization_id, created_at DESC);
CREATE INDEX idx_search_history_user ON search_history(user_id, created_at DESC);

-- ── PRODUCT VIEWS (Analytics) ────────────────────────────────────────────

CREATE TABLE product_views (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  product_id        UUID NOT NULL REFERENCES products(id),
  customer_id       UUID REFERENCES customers(id),
  user_id           UUID REFERENCES users(id),
  source            VARCHAR(30) NOT NULL DEFAULT 'pos',     -- pos|storefront|mobile|ar_viewer
  view_duration_sec INTEGER,
  ar_used           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE product_views_2026_04 PARTITION OF product_views FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE product_views_2026_05 PARTITION OF product_views FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE product_views_2026_06 PARTITION OF product_views FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE product_views_2026_07 PARTITION OF product_views FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE product_views_2026_08 PARTITION OF product_views FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE product_views_2026_09 PARTITION OF product_views FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE product_views_2026_10 PARTITION OF product_views FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE product_views_2026_11 PARTITION OF product_views FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE product_views_2026_12 PARTITION OF product_views FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE INDEX idx_product_views_product ON product_views(product_id, created_at DESC);

-- ── RECOMMENDATION CLICKS (AI training signal) ────────────────────────────

CREATE TABLE recommendation_clicks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID REFERENCES customers(id),
  product_id        UUID NOT NULL REFERENCES products(id),
  session_id        UUID REFERENCES ai_sessions(id),
  click_type        VARCHAR(20) NOT NULL DEFAULT 'view',    -- view|add_to_cart|purchase
  position          INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rec_clicks_product ON recommendation_clicks(product_id, created_at DESC);
CREATE INDEX idx_rec_clicks_customer ON recommendation_clicks(customer_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- FINANCE EXTRAS
-- ═══════════════════════════════════════════════════════════

-- ── CURRENCY EXCHANGE RATES ───────────────────────────────────────────────

CREATE TABLE currency_exchange_rates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency     currency_code NOT NULL DEFAULT 'AED',
  target_currency   currency_code NOT NULL,
  rate              DECIMAL(14,6) NOT NULL,
  source            VARCHAR(50) NOT NULL DEFAULT 'ecb',     -- 'ecb'|'manual'|'provider'
  rate_date         DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(base_currency, target_currency, rate_date)
);

CREATE INDEX idx_exchange_rates_date ON currency_exchange_rates(rate_date DESC, base_currency);

-- ── VAT RETURNS (UAE quarterly submission) ────────────────────────────────

CREATE TABLE vat_returns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  -- Outputs (Sales)
  standard_rated_sales    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_on_sales            DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  zero_rated_sales        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  exempt_sales            DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  -- Inputs (Purchases)
  standard_rated_purchases DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_on_purchases        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  -- Net
  net_vat_due             DECIMAL(14,2) GENERATED ALWAYS AS (vat_on_sales - vat_on_purchases) STORED,
  -- Submission
  status                  VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft|submitted|accepted|paid
  submission_ref          VARCHAR(100),
  submitted_at            TIMESTAMPTZ,
  due_date                DATE,
  paid_at                 TIMESTAMPTZ,
  notes                   TEXT,
  prepared_by             UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, period_start)
);

CREATE INDEX idx_vat_returns_org ON vat_returns(organization_id, period_start DESC);

-- ── EXPENSE CATEGORIES ────────────────────────────────────────────────────

CREATE TABLE expense_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  name_ar           VARCHAR(100),
  account_id        UUID REFERENCES accounts(id),           -- maps to chart of accounts
  parent_id         UUID REFERENCES expense_categories(id),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- ── EXPENSES ──────────────────────────────────────────────────────────────

CREATE TABLE expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  location_id       UUID REFERENCES locations(id),
  category_id       UUID NOT NULL REFERENCES expense_categories(id),
  -- Details
  description       TEXT NOT NULL,
  amount            DECIMAL(14,2) NOT NULL,
  vat_amount        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  currency          currency_code NOT NULL DEFAULT 'AED',
  expense_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor            TEXT,
  receipt_url       TEXT,                                   -- Cloudflare R2 URL
  -- Approval
  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|paid
  submitted_by      UUID NOT NULL REFERENCES users(id),
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_org    ON expenses(organization_id, expense_date DESC);
CREATE INDEX idx_expenses_status ON expenses(organization_id, status);

-- ── PETTY CASH LOG ────────────────────────────────────────────────────────

CREATE TABLE petty_cash_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  location_id       UUID NOT NULL REFERENCES locations(id),
  cash_session_id   UUID REFERENCES cash_sessions(id),
  amount            DECIMAL(10,2) NOT NULL,
  direction         VARCHAR(10) NOT NULL,                   -- 'out'|'in' (replenishment)
  description       TEXT NOT NULL,
  receipt_url       TEXT,
  recorded_by       UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_petty_cash_location ON petty_cash_log(location_id, created_at DESC);
