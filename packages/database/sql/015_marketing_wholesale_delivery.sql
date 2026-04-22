-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 015_marketing_wholesale_delivery.sql
-- Campaign Recipients, Email/SMS Templates, Push Tokens,
-- Wholesale Orders/Items/Tiers/Contracts,
-- Delivery Zones/Providers/Events/Slots
-- Blueprint Phase 5 (Wholesale & White-Glove) + Phase 6 (Outreach)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- MARKETING / OUTREACH
-- ═══════════════════════════════════════════════════════════

-- ── CAMPAIGN RECIPIENTS ───────────────────────────────────────────────────

CREATE TABLE campaign_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  campaign_id       BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES customers(id),
  outreach_queue_id BIGINT REFERENCES outreach_queue(id),
  -- Delivery tracking
  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|sent|delivered|read|failed|unsubscribed
  sent_at           TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  failure_reason    TEXT,
  UNIQUE(campaign_id, customer_id)
);

CREATE INDEX idx_campaign_recipients_campaign  ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_customer  ON campaign_recipients(customer_id);
CREATE INDEX idx_campaign_recipients_status    ON campaign_recipients(campaign_id, status);

-- ── EMAIL TEMPLATES ───────────────────────────────────────────────────────

CREATE TABLE email_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  slug              VARCHAR(100) NOT NULL,
  subject           VARCHAR(255) NOT NULL,
  subject_ar        VARCHAR(255),
  -- Content (HTML with {{variable}} placeholders)
  html_content      TEXT NOT NULL,
  html_content_ar   TEXT,
  text_content      TEXT,
  -- Metadata
  outreach_type     outreach_type,
  variables_schema  JSONB DEFAULT '{}',                     -- {customer_name: 'string', receipt_number: 'number'}
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);

CREATE INDEX idx_email_templates_org ON email_templates(organization_id, is_active);

-- ── SMS TEMPLATES ─────────────────────────────────────────────────────────

CREATE TABLE sms_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  slug              VARCHAR(100) NOT NULL,
  body_en           TEXT NOT NULL,                          -- English SMS text (max 160 chars)
  body_ar           TEXT,                                   -- Arabic SMS text
  outreach_type     outreach_type,
  character_count   INTEGER GENERATED ALWAYS AS (LENGTH(body_en)) STORED,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);

CREATE INDEX idx_sms_templates_org ON sms_templates(organization_id, is_active);

-- ── EMAIL SUPPRESSIONS (unsubscribe / bounce) ─────────────────────────────

CREATE TABLE email_suppressions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  email             VARCHAR(255) NOT NULL,
  reason            VARCHAR(50) NOT NULL,                   -- 'unsubscribe'|'bounce'|'complaint'
  suppressed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);

CREATE INDEX idx_suppressions_email ON email_suppressions(email);

-- ── PUSH NOTIFICATION TOKENS ──────────────────────────────────────────────

CREATE TABLE push_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID REFERENCES users(id),
  customer_id       UUID REFERENCES customers(id),
  device_id         UUID REFERENCES pos_devices(id),
  token             TEXT NOT NULL UNIQUE,                   -- Expo push token or FCM/APNS token
  platform          VARCHAR(10) NOT NULL,                   -- 'ios'|'android'|'web'
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_tokens_user     ON push_tokens(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_push_tokens_customer ON push_tokens(customer_id) WHERE is_active = TRUE;

-- ═══════════════════════════════════════════════════════════
-- WHOLESALE
-- ═══════════════════════════════════════════════════════════

-- ── WHOLESALE ORDERS ──────────────────────────────────────────────────────

CREATE TABLE wholesale_orders (
  id                BIGINT PRIMARY KEY DEFAULT nextval('seq_wholesale_order'),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  wholesale_customer_id UUID NOT NULL REFERENCES wholesale_customers(id),
  account_manager_id UUID REFERENCES users(id),
  -- Status
  status            purchase_order_status NOT NULL DEFAULT 'draft',
  -- Amounts
  currency          currency_code NOT NULL DEFAULT 'AED',
  subtotal          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_amount        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  -- Payment
  payment_terms     INTEGER NOT NULL DEFAULT 30,            -- days net
  deposit_percent   DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  deposit_paid      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  balance_due       DECIMAL(14,2) GENERATED ALWAYS AS (total - deposit_paid) STORED,
  due_date          DATE,
  -- References
  purchase_order_ref VARCHAR(100),
  invoice_id        UUID REFERENCES invoices(id),
  -- Delivery
  delivery_address  JSONB,
  delivery_date     DATE,
  -- Notes
  notes             TEXT,
  internal_notes    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wholesale_orders_org      ON wholesale_orders(organization_id, created_at DESC);
CREATE INDEX idx_wholesale_orders_customer ON wholesale_orders(wholesale_customer_id);
CREATE INDEX idx_wholesale_orders_status   ON wholesale_orders(organization_id, status);

CREATE TABLE wholesale_order_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wholesale_order_id    BIGINT NOT NULL REFERENCES wholesale_orders(id) ON DELETE CASCADE,
  product_variant_id    UUID NOT NULL REFERENCES product_variants(id),
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  unit_price            DECIMAL(14,2) NOT NULL,             -- negotiated wholesale price
  discount_percent      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  line_total            DECIMAL(14,2) NOT NULL
);

CREATE INDEX idx_wholesale_order_items_order ON wholesale_order_items(wholesale_order_id);

-- ── WHOLESALE PRICE TIERS ─────────────────────────────────────────────────

CREATE TABLE wholesale_price_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,                  -- Bronze | Silver | Gold | Platinum
  min_order_value   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_percent  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  free_shipping_threshold DECIMAL(14,2),
  payment_terms     INTEGER NOT NULL DEFAULT 30,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wholesale_tiers_org ON wholesale_price_tiers(organization_id);

-- ── WHOLESALE CONTRACTS ───────────────────────────────────────────────────

CREATE TABLE wholesale_contracts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  wholesale_customer_id UUID NOT NULL REFERENCES wholesale_customers(id),
  contract_number   VARCHAR(50) NOT NULL UNIQUE,
  status            VARCHAR(20) NOT NULL DEFAULT 'active',  -- draft|active|expired|terminated
  -- Terms
  start_date        DATE NOT NULL,
  end_date          DATE,
  min_annual_purchase DECIMAL(14,2),
  payment_terms     INTEGER NOT NULL DEFAULT 30,
  discount_percent  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  credit_limit      DECIMAL(14,2),
  -- Document
  document_url      TEXT,                                   -- Cloudflare R2 signed URL
  signed_at         TIMESTAMPTZ,
  signed_by_ref     TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contracts_customer ON wholesale_contracts(wholesale_customer_id);
CREATE INDEX idx_contracts_status   ON wholesale_contracts(organization_id, status);

-- ═══════════════════════════════════════════════════════════
-- DELIVERY EXTENDED
-- ═══════════════════════════════════════════════════════════

-- ── DELIVERY ZONES ────────────────────────────────────────────────────────

CREATE TABLE delivery_zones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  name_ar           VARCHAR(100),
  emirate           VARCHAR(100) NOT NULL,                  -- Dubai, Abu Dhabi etc.
  -- SLA
  standard_sla_hours INTEGER NOT NULL DEFAULT 24,
  express_sla_hours  INTEGER NOT NULL DEFAULT 4,
  same_day_cutoff   TIME NOT NULL DEFAULT '14:00',          -- orders after this → next day
  -- Pricing
  standard_fee      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  express_fee       DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  free_threshold    DECIMAL(14,2),                          -- free delivery above this amount
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_zones_org ON delivery_zones(organization_id, is_active);

-- ── DELIVERY PROVIDERS ────────────────────────────────────────────────────

CREATE TABLE delivery_providers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,                  -- 'Aramex', 'DHL', 'In-house Chauffeur'
  provider_type     VARCHAR(30) NOT NULL DEFAULT 'courier', -- courier|chauffeur|in_house
  api_endpoint      TEXT,
  api_key_hash      TEXT,                                   -- bcrypt hash
  tracking_url_template TEXT,                               -- https://aramex.com/track/{tracking_number}
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_providers_org ON delivery_providers(organization_id, is_active);

-- ── DELIVERY EVENTS (Tracking log) ───────────────────────────────────────

CREATE TABLE delivery_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       BIGINT NOT NULL REFERENCES white_glove_deliveries(id),
  event_type        delivery_status NOT NULL,
  description       TEXT,
  location_description TEXT,
  lat               DECIMAL(10,8),
  lng               DECIMAL(11,8),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by       UUID REFERENCES users(id),
  provider_event_id TEXT                                    -- external provider event ID
);

CREATE INDEX idx_delivery_events_delivery ON delivery_events(delivery_id, occurred_at DESC);

-- ── DELIVERY SLOTS ────────────────────────────────────────────────────────

CREATE TABLE delivery_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  location_id       UUID NOT NULL REFERENCES locations(id),
  zone_id           UUID REFERENCES delivery_zones(id),
  slot_date         DATE NOT NULL,
  slot_start        TIME NOT NULL,
  slot_end          TIME NOT NULL,
  max_deliveries    INTEGER NOT NULL DEFAULT 10,
  booked_count      INTEGER NOT NULL DEFAULT 0,
  is_available      BOOLEAN GENERATED ALWAYS AS (booked_count < max_deliveries) STORED,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, slot_date, slot_start)
);

CREATE INDEX idx_delivery_slots_date     ON delivery_slots(location_id, slot_date);
CREATE INDEX idx_delivery_slots_available ON delivery_slots(location_id, slot_date, is_available) WHERE is_available = TRUE;
