-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 005_transactions_payments.sql
-- Transactions, Transaction Items, Payments, Tax-Free Export
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- TRANSACTIONS (Sales / Refunds / Layaway)
-- ══════════════════════════════════════════════════════

CREATE TABLE transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  location_id         UUID NOT NULL REFERENCES locations(id),
  device_id           UUID REFERENCES pos_devices(id),
  receipt_number      BIGINT UNIQUE DEFAULT nextval('seq_receipt_number'),
  type                transaction_type NOT NULL DEFAULT 'sale',
  status              transaction_status NOT NULL DEFAULT 'draft',
  channel             transaction_channel NOT NULL DEFAULT 'in_store',
  customer_id         UUID REFERENCES customers(id),
  staff_id            UUID NOT NULL REFERENCES users(id),
  -- Amounts
  subtotal            DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_amount          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  rounding_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total               DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  currency            currency_code NOT NULL DEFAULT 'AED',
  exchange_rate       DECIMAL(10,6) DEFAULT 1.000000,
  -- Points
  loyalty_points_earned  INTEGER NOT NULL DEFAULT 0,
  loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
  -- References
  parent_transaction_id UUID REFERENCES transactions(id), -- for refunds/exchanges
  idempotency_key     VARCHAR(128),
  -- Delivery
  delivery_method     delivery_method DEFAULT 'in_store_pickup',
  delivery_address    JSONB,
  delivery_scheduled_at TIMESTAMPTZ,
  -- Tax Free
  is_tax_free_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  tax_free_claim_id   UUID,
  -- Notes
  staff_notes         TEXT,
  customer_note       TEXT,
  -- Timestamps
  completed_at        TIMESTAMPTZ,
  voided_at           TIMESTAMPTZ,
  voided_by           UUID REFERENCES users(id),
  void_reason         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_org        ON transactions(organization_id, created_at DESC);
CREATE INDEX idx_transactions_location   ON transactions(location_id, created_at DESC);
CREATE INDEX idx_transactions_customer   ON transactions(customer_id, created_at DESC);
CREATE INDEX idx_transactions_staff      ON transactions(staff_id, created_at DESC);
CREATE INDEX idx_transactions_status     ON transactions(organization_id, status);
CREATE INDEX idx_transactions_receipt    ON transactions(receipt_number);
CREATE INDEX idx_transactions_completed  ON transactions(organization_id, completed_at DESC)
  WHERE status = 'completed';

COMMENT ON TABLE transactions IS 'Master sales ledger — <500ms checkout SLA via async inventory deduction';

-- ══════════════════════════════════════════════════════
-- TRANSACTION ITEMS (line items)
-- ══════════════════════════════════════════════════════

CREATE TABLE transaction_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
  product_id          UUID NOT NULL REFERENCES products(id),
  -- NFC Authentication
  nfc_bottle_id       VARCHAR(100),                       -- links to nfc_bottle_registry
  nfc_validated       BOOLEAN NOT NULL DEFAULT FALSE,
  nfc_validation_status nfc_validation_status DEFAULT 'not_required',
  -- Pricing
  quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price          DECIMAL(14,2) NOT NULL,
  discount_percent    DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  discount_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_rate            DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  vat_amount          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_total          DECIMAL(14,2) NOT NULL,
  cost_price          DECIMAL(14,2),                      -- for margin calc
  -- Engraving / Bespoke
  customization       JSONB DEFAULT '{}',                 -- {engraving_text, font, style}
  engraving_price     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  -- Blockchain
  digital_passport_id UUID,
  passport_mint_queued BOOLEAN NOT NULL DEFAULT FALSE,
  -- Status
  item_status         VARCHAR(30) NOT NULL DEFAULT 'active', -- active|voided|refunded
  refunded_qty        INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_transaction ON transaction_items(transaction_id);
CREATE INDEX idx_items_variant     ON transaction_items(product_variant_id);
CREATE INDEX idx_items_nfc         ON transaction_items(nfc_bottle_id) WHERE nfc_bottle_id IS NOT NULL;

COMMENT ON TABLE transaction_items IS 'Trigger: trg_inventory_on_transaction_item_insert fires on INSERT (WHEN item_status != voided)';

-- ══════════════════════════════════════════════════════
-- PAYMENTS
-- ══════════════════════════════════════════════════════

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  method              payment_method_type NOT NULL,
  status              payment_status NOT NULL DEFAULT 'pending',
  amount              DECIMAL(14,2) NOT NULL,
  currency            currency_code NOT NULL DEFAULT 'AED',
  -- Provider
  provider            VARCHAR(50),                        -- 'stripe', 'network_international', 'tap'
  provider_reference  TEXT,
  provider_response   JSONB,
  terminal_id         VARCHAR(100),
  -- Gift Card
  gift_card_id        UUID REFERENCES gift_cards(id),
  gift_card_amount    DECIMAL(14,2),
  -- Biometric Auth
  biometric_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  biometric_token_ref TEXT,
  -- Refund
  refund_of_payment_id UUID REFERENCES payments(id),
  -- Timestamps
  authorized_at       TIMESTAMPTZ,
  captured_at         TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_transaction ON payments(transaction_id);
CREATE INDEX idx_payments_status      ON payments(status, created_at DESC);
CREATE INDEX idx_payments_provider    ON payments(provider_reference) WHERE provider_reference IS NOT NULL;

-- ══════════════════════════════════════════════════════
-- PAYMENT LINKS (WhatsApp / Email checkout)
-- ══════════════════════════════════════════════════════

CREATE TABLE payment_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_id     UUID REFERENCES customers(id),
  staff_id        UUID REFERENCES users(id),
  amount          DECIMAL(14,2) NOT NULL,
  currency        currency_code NOT NULL DEFAULT 'AED',
  description     TEXT,
  items           JSONB DEFAULT '[]',                     -- snapshot of cart items
  link_token      TEXT NOT NULL UNIQUE,                   -- signed URL token
  provider        VARCHAR(50),
  provider_link   TEXT,
  status          payment_status NOT NULL DEFAULT 'pending',
  paid_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '72 hours'),
  sent_via        outreach_channel,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_links_customer ON payment_links(customer_id);
CREATE INDEX idx_payment_links_expires  ON payment_links(expires_at) WHERE status = 'pending';

COMMENT ON TABLE payment_links IS 'Managed by pg_cron luxe-expire-payment-links daily 02:00 (skip policy)';

-- ══════════════════════════════════════════════════════
-- CASH MANAGEMENT
-- ══════════════════════════════════════════════════════

CREATE TABLE cash_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  location_id     UUID NOT NULL REFERENCES locations(id),
  device_id       UUID REFERENCES pos_devices(id),
  opened_by       UUID NOT NULL REFERENCES users(id),
  closed_by       UUID REFERENCES users(id),
  opening_float   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  closing_count   DECIMAL(14,2),
  expected_cash   DECIMAL(14,2),
  variance        DECIMAL(14,2) GENERATED ALWAYS AS (
    CASE WHEN closing_count IS NOT NULL THEN closing_count - expected_cash ELSE NULL END
  ) STORED,
  status          VARCHAR(20) NOT NULL DEFAULT 'open',    -- open|closed
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  notes           TEXT
);

CREATE INDEX idx_cash_sessions_location ON cash_sessions(location_id, opened_at DESC);
CREATE INDEX idx_cash_sessions_open     ON cash_sessions(organization_id, status)
  WHERE status = 'open';

-- ══════════════════════════════════════════════════════
-- TAX-FREE EXPORT CLAIMS (Global Blue / Planet)
-- ══════════════════════════════════════════════════════

CREATE TABLE tax_free_export_claims (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_tax_claim_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  transaction_id  UUID NOT NULL REFERENCES transactions(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  claim_number    VARCHAR(50) UNIQUE,
  provider        VARCHAR(50) NOT NULL DEFAULT 'global_blue', -- 'global_blue' | 'planet'
  vat_amount      DECIMAL(14,2) NOT NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'pending', -- pending|submitted|validated|refunded|expired
  passport_number TEXT,                                   -- encrypted
  nationality     CHAR(2),
  flight_date     DATE,
  airport_code    VARCHAR(10),
  qr_code_url     TEXT,
  submitted_at    TIMESTAMPTZ,
  validated_at    TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '90 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tax_claims_transaction ON tax_free_export_claims(transaction_id);
CREATE INDEX idx_tax_claims_status      ON tax_free_export_claims(status);
CREATE INDEX idx_tax_claims_expires     ON tax_free_export_claims(expires_at)
  WHERE status IN ('pending', 'submitted');

COMMENT ON TABLE tax_free_export_claims IS 'Managed by pg_cron luxe-tax-free-expire daily 02:30 — expires after 90 days';
