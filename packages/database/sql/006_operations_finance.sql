-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 006_operations_finance.sql
-- Staff KPIs, Outreach, Appointments, White-Glove Delivery,
-- Purchase Orders, Finance/Accounting, Blockchain, Manufacturing, Diffuser
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- STAFF PERFORMANCE SNAPSHOTS (pg_cron daily/weekly)
-- ══════════════════════════════════════════════════════

CREATE TABLE staff_performance_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  location_id     UUID REFERENCES locations(id),
  period          VARCHAR(10) NOT NULL,                    -- 'daily' | 'weekly' | 'monthly'
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  -- Sales KPIs
  total_sales     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  avg_transaction DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  units_sold      INTEGER NOT NULL DEFAULT 0,
  returns_count   INTEGER NOT NULL DEFAULT 0,
  -- Black Book KPIs
  black_book_updates INTEGER NOT NULL DEFAULT 0,
  outreach_sent   INTEGER NOT NULL DEFAULT 0,
  appointments_booked INTEGER NOT NULL DEFAULT 0,
  -- Commission
  commission_earned DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  target_amount   DECIMAL(14,2),
  target_achieved DECIMAL(5,2),                           -- percentage
  -- Computed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, period, period_start)
);

CREATE INDEX idx_perf_user   ON staff_performance_snapshots(user_id, period_start DESC);
CREATE INDEX idx_perf_org    ON staff_performance_snapshots(organization_id, period_start DESC);

-- ══════════════════════════════════════════════════════
-- OUTREACH QUEUE (CRM outreach campaigns)
-- ══════════════════════════════════════════════════════

CREATE TABLE outreach_queue (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_outreach_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  staff_id        UUID REFERENCES users(id),
  campaign_id     UUID,
  outreach_type   outreach_type NOT NULL,
  channel         outreach_channel NOT NULL,
  status          outreach_status NOT NULL DEFAULT 'scheduled',
  -- Content
  subject         VARCHAR(255),
  body            TEXT NOT NULL,
  template_vars   JSONB DEFAULT '{}',
  -- Scheduling
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at          TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  -- Provider
  provider        VARCHAR(50),
  provider_message_id TEXT,
  failure_reason  TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  -- Reference
  reference_transaction_id UUID REFERENCES transactions(id),
  key_date_ref    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outreach_customer  ON outreach_queue(customer_id, created_at DESC);
CREATE INDEX idx_outreach_due       ON outreach_queue(organization_id, status, due_at)
  WHERE status IN ('scheduled', 'due');
CREATE INDEX idx_outreach_staff     ON outreach_queue(staff_id);

COMMENT ON TABLE outreach_queue IS 'Managed by pg_cron luxe-mark-due-outreach daily 00:00 (skip policy)';

-- ══════════════════════════════════════════════════════
-- CAMPAIGNS
-- ══════════════════════════════════════════════════════

CREATE TABLE campaigns (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_campaign_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          campaign_status NOT NULL DEFAULT 'draft',
  outreach_type   outreach_type NOT NULL,
  channels        outreach_channel[] NOT NULL DEFAULT '{}',
  target_segment  JSONB DEFAULT '{}',                     -- tier, nationality, last_visit, etc.
  template_body   TEXT NOT NULL,
  template_vars_schema JSONB DEFAULT '{}',
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count      INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_org    ON campaigns(organization_id, status);
CREATE INDEX idx_campaigns_active ON campaigns(organization_id, scheduled_at)
  WHERE status IN ('scheduled', 'active');

-- ══════════════════════════════════════════════════════
-- APPOINTMENTS
-- ══════════════════════════════════════════════════════

CREATE TABLE appointments (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_appointment_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  location_id     UUID REFERENCES locations(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  staff_id        UUID REFERENCES users(id),
  type            appointment_type NOT NULL DEFAULT 'scent_consultation',
  status          appointment_status NOT NULL DEFAULT 'requested',
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  notes           TEXT,
  customer_requests TEXT,
  staff_preparation TEXT,
  outcome_notes   TEXT,
  related_transaction_id UUID REFERENCES transactions(id),
  reminder_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appts_customer  ON appointments(customer_id);
CREATE INDEX idx_appts_staff     ON appointments(staff_id, scheduled_at);
CREATE INDEX idx_appts_location  ON appointments(location_id, scheduled_at);
CREATE INDEX idx_appts_upcoming  ON appointments(organization_id, scheduled_at)
  WHERE status IN ('requested', 'confirmed');

-- ══════════════════════════════════════════════════════
-- WHITE-GLOVE DELIVERY
-- ══════════════════════════════════════════════════════

CREATE TABLE white_glove_deliveries (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_delivery_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  transaction_id  UUID NOT NULL REFERENCES transactions(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  staff_id        UUID REFERENCES users(id),              -- assigned delivery concierge
  method          delivery_method NOT NULL,
  sla             white_glove_sla NOT NULL DEFAULT '4_hours',
  status          delivery_status NOT NULL DEFAULT 'pending',
  -- Destination
  destination_type VARCHAR(50),                           -- 'hotel', 'yacht', 'residence', 'airport'
  hotel_name      VARCHAR(255),
  room_number     VARCHAR(20),
  delivery_address JSONB,
  recipient_name  VARCHAR(255),
  recipient_phone VARCHAR(50),
  -- Scheduling
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  promised_at     TIMESTAMPTZ,                            -- SLA deadline
  dispatched_at   TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  -- Tracking
  tracking_code   VARCHAR(50) UNIQUE,
  courier_name    VARCHAR(100),
  courier_phone   VARCHAR(50),
  proof_of_delivery JSONB,                                -- {photo_url, signature, timestamp}
  -- Notes
  special_instructions TEXT,
  packaging_notes TEXT,
  gift_message    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_transaction ON white_glove_deliveries(transaction_id);
CREATE INDEX idx_delivery_status      ON white_glove_deliveries(organization_id, status);
CREATE INDEX idx_delivery_promised    ON white_glove_deliveries(promised_at)
  WHERE status NOT IN ('delivered', 'cancelled');

-- ══════════════════════════════════════════════════════
-- PURCHASE ORDERS (Supplier restocking)
-- ══════════════════════════════════════════════════════

CREATE TABLE purchase_orders (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_po_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  location_id     UUID NOT NULL REFERENCES locations(id),
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  created_by      UUID REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  status          purchase_order_status NOT NULL DEFAULT 'draft',
  currency        currency_code NOT NULL DEFAULT 'AED',
  subtotal        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_amount      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  payment_terms   INTEGER NOT NULL DEFAULT 30,
  expected_at     DATE,
  received_at     TIMESTAMPTZ,
  invoice_number  VARCHAR(100),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_org      ON purchase_orders(organization_id);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_status   ON purchase_orders(organization_id, status);

CREATE TABLE purchase_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
  quantity_ordered    INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received   INTEGER NOT NULL DEFAULT 0,
  unit_cost           DECIMAL(14,2) NOT NULL,
  line_total          DECIMAL(14,2) NOT NULL
);

CREATE INDEX idx_po_items_po ON purchase_order_items(purchase_order_id);

-- ══════════════════════════════════════════════════════
-- CHART OF ACCOUNTS (double-entry finance)
-- ══════════════════════════════════════════════════════

CREATE TABLE accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  code            VARCHAR(20) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  account_type    account_type NOT NULL,
  currency        currency_code NOT NULL DEFAULT 'AED',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  parent_id       UUID REFERENCES accounts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);

CREATE INDEX idx_accounts_org ON accounts(organization_id);

CREATE TABLE journal_entries (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_journal_entry'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  entry_type      journal_entry_type NOT NULL,
  reference_id    UUID,
  reference_type  VARCHAR(50),
  description     TEXT NOT NULL,
  total_debit     DECIMAL(14,2) NOT NULL,
  total_credit    DECIMAL(14,2) NOT NULL,
  CONSTRAINT balanced CHECK (total_debit = total_credit),
  currency        currency_code NOT NULL DEFAULT 'AED',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_org  ON journal_entries(organization_id, created_at DESC);
CREATE INDEX idx_journal_ref  ON journal_entries(reference_type, reference_id);

CREATE TABLE journal_entry_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id),
  debit           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  credit          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  description     TEXT,
  CONSTRAINT debit_or_credit CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);

CREATE INDEX idx_jel_entry   ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_jel_account ON journal_entry_lines(account_id);

-- ══════════════════════════════════════════════════════
-- BLOCKCHAIN / DIGITAL PASSPORTS
-- ══════════════════════════════════════════════════════

CREATE TABLE digital_passports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  transaction_item_id UUID NOT NULL REFERENCES transaction_items(id),
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
  customer_id         UUID REFERENCES customers(id),
  mint_status         passport_mint_status NOT NULL DEFAULT 'pending',
  network             blockchain_network NOT NULL DEFAULT 'polygon',
  contract_address    TEXT,
  token_id            TEXT,
  token_uri           TEXT,                               -- IPFS metadata URI
  ipfs_cid            TEXT,                               -- content hash
  metadata            JSONB DEFAULT '{}',                 -- name, description, attributes
  transaction_hash    TEXT,                               -- blockchain tx hash
  minted_at           TIMESTAMPTZ,
  current_owner       TEXT,                               -- wallet address
  transfer_count      INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  job_id              BIGINT DEFAULT nextval('seq_blockchain_job'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_passport_customer ON digital_passports(customer_id);
CREATE INDEX idx_passport_status   ON digital_passports(mint_status);
CREATE INDEX idx_passport_token    ON digital_passports(token_id) WHERE token_id IS NOT NULL;

COMMENT ON TABLE digital_passports IS 'Async BullMQ queue — never blocks checkout (Engineering Fix 4)';

-- ══════════════════════════════════════════════════════
-- BESPOKE MANUFACTURING (Phase 2 — ready, not active)
-- ══════════════════════════════════════════════════════

CREATE TABLE raw_materials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name            VARCHAR(255) NOT NULL,
  inci_name       TEXT,                                   -- INCI cosmetic standard name
  supplier_id     UUID REFERENCES suppliers(id),
  unit            VARCHAR(20) NOT NULL DEFAULT 'kg',
  cost_per_unit   DECIMAL(14,4) NOT NULL,
  stock_kg        DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  reorder_kg      DECIMAL(10,3) NOT NULL DEFAULT 1.000,
  origin_country  CHAR(2),
  cas_number      VARCHAR(20),
  safety_notes    TEXT,
  is_restricted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_raw_materials_org ON raw_materials(organization_id);

CREATE TABLE bespoke_formulas (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_formula_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  product_id      UUID REFERENCES products(id),
  customer_id     UUID REFERENCES customers(id),          -- NULL = house formula
  name            VARCHAR(255) NOT NULL,
  status          formula_status NOT NULL DEFAULT 'concept',
  perfumer_id     UUID REFERENCES users(id),
  concentration   DECIMAL(5,2) NOT NULL DEFAULT 20.00,    -- % fragrance in carrier
  target_volume_ml INTEGER NOT NULL DEFAULT 50,
  notes           TEXT,
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE formula_ingredients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id      BIGINT NOT NULL REFERENCES bespoke_formulas(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id),
  percentage      DECIMAL(6,4) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  role            VARCHAR(50) DEFAULT 'modifier'          -- top_note|heart_note|base_note|modifier|carrier
);

CREATE INDEX idx_formula_ingredients_formula ON formula_ingredients(formula_id);

CREATE TABLE batch_provenance (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_batch_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  formula_id      BIGINT REFERENCES bespoke_formulas(id),
  product_id      UUID REFERENCES products(id),
  batch_number    VARCHAR(50) UNIQUE DEFAULT 'BATCH-' || nextval('seq_batch_number'),
  status          batch_status NOT NULL DEFAULT 'planned',
  planned_qty_ml  INTEGER NOT NULL,
  actual_qty_ml   INTEGER,
  bottles_filled  INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  qc_approved_by  UUID REFERENCES users(id),
  qc_notes        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_batch_org ON batch_provenance(organization_id);

-- ══════════════════════════════════════════════════════
-- SMART DIFFUSER IoT
-- ══════════════════════════════════════════════════════

CREATE TABLE diffuser_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  location_id     UUID NOT NULL REFERENCES locations(id),
  name            VARCHAR(100) NOT NULL,
  zone            VARCHAR(50),
  manufacturer    VARCHAR(100),
  model           VARCHAR(100),
  api_endpoint    TEXT,
  api_key_hash    TEXT,
  cartridge_product_id UUID REFERENCES products(id),
  cartridge_percent INTEGER NOT NULL DEFAULT 100 CHECK (cartridge_percent BETWEEN 0 AND 100),
  last_poll_at    TIMESTAMPTZ,
  is_online       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diffuser_location ON diffuser_devices(location_id);

CREATE TABLE diffuser_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diffuser_id     UUID NOT NULL REFERENCES diffuser_devices(id),
  alert_type      diffuser_alert_type NOT NULL,
  cartridge_level INTEGER,
  raw_payload     JSONB,
  acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diffuser_events_device ON diffuser_events(diffuser_id, created_at DESC);
CREATE INDEX idx_diffuser_events_unack  ON diffuser_events(acknowledged) WHERE acknowledged = FALSE;

-- ══════════════════════════════════════════════════════
-- WHOLESALE CUSTOMERS & ORDERS
-- ══════════════════════════════════════════════════════

CREATE TABLE wholesale_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  customer_type   wholesale_customer_type NOT NULL,
  company_name    VARCHAR(255) NOT NULL,
  trade_license   VARCHAR(100),
  vat_number      VARCHAR(50),
  credit_limit    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  payment_terms   INTEGER NOT NULL DEFAULT 30,
  discount_tier   INTEGER NOT NULL DEFAULT 0,             -- % wholesale discount
  account_manager_id UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id)
);

CREATE INDEX idx_wholesale_org ON wholesale_customers(organization_id);
