-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 014_customer_extended.sql
-- Customer Addresses, Tier History, Notes, Referrals,
-- Loyalty Tiers/Rules/Redemptions, Gift Card Transactions,
-- Wishlists, Bespoke Orders, Consultation Sessions
-- Blueprint Phase 2 (CRM & Black Book)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── CUSTOMER ADDRESSES ────────────────────────────────────────────────────

CREATE TABLE customer_addresses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  label             VARCHAR(50) NOT NULL DEFAULT 'Home',    -- Home | Work | Hotel | Yacht | Villa
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Address fields
  recipient_name    VARCHAR(200),
  phone             VARCHAR(50),
  address_line1     VARCHAR(255) NOT NULL,
  address_line2     VARCHAR(255),
  city              VARCHAR(100) NOT NULL,
  emirate           VARCHAR(100),
  country_code      CHAR(2) NOT NULL DEFAULT 'AE',
  postal_code       VARCHAR(20),
  -- VIP logistics
  hotel_name        VARCHAR(255),
  room_number       VARCHAR(20),
  floor_number      VARCHAR(10),
  building_name     VARCHAR(255),
  lat               DECIMAL(10,8),
  lng               DECIMAL(11,8),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_addresses_customer ON customer_addresses(customer_id);

-- ── CUSTOMER TIER HISTORY ─────────────────────────────────────────────────

CREATE TABLE customer_tier_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  previous_tier     customer_tier NOT NULL,
  new_tier          customer_tier NOT NULL,
  reason            TEXT,                                   -- 'ltv_milestone', 'manual', 'downgrade'
  ltv_at_change     DECIMAL(14,2),                          -- lifetime value snapshot
  changed_by        UUID REFERENCES users(id),              -- NULL = automatic
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tier_history_customer ON customer_tier_history(customer_id, created_at DESC);

-- ── CUSTOMER NOTES ────────────────────────────────────────────────────────

CREATE TABLE customer_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  note              TEXT NOT NULL,
  note_type         VARCHAR(30) NOT NULL DEFAULT 'general', -- general|preference|complaint|compliment|allergy
  is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  is_private        BOOLEAN NOT NULL DEFAULT FALSE,         -- private = manager only
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_notes_customer ON customer_notes(customer_id, created_at DESC);

-- ── REFERRAL CODES ────────────────────────────────────────────────────────

CREATE TABLE referral_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  code              VARCHAR(30) NOT NULL UNIQUE,
  -- Rewards
  referrer_points   INTEGER NOT NULL DEFAULT 500,           -- points given to referrer
  referee_discount  DECIMAL(5,2) NOT NULL DEFAULT 10.00,   -- % discount for new customer
  -- Stats
  times_used        INTEGER NOT NULL DEFAULT 0,
  max_uses          INTEGER,                                 -- NULL = unlimited
  -- Validity
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referral_codes_customer ON referral_codes(customer_id);
CREATE INDEX idx_referral_codes_code     ON referral_codes(code) WHERE is_active = TRUE;

-- ── LOYALTY TIERS ─────────────────────────────────────────────────────────

CREATE TABLE loyalty_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  tier              customer_tier NOT NULL,
  -- Qualification
  min_ltv           DECIMAL(14,2) NOT NULL DEFAULT 0.00,    -- minimum lifetime spend
  min_purchases     INTEGER NOT NULL DEFAULT 0,
  -- Benefits
  earn_multiplier   DECIMAL(4,2) NOT NULL DEFAULT 1.00,     -- points earn rate multiplier
  birthday_bonus    INTEGER NOT NULL DEFAULT 0,             -- bonus points on birthday
  -- Display
  name              VARCHAR(100) NOT NULL,
  name_ar           VARCHAR(100),
  description       TEXT,
  badge_color       VARCHAR(7) DEFAULT '#6B7280',           -- hex color
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, tier)
);

CREATE INDEX idx_loyalty_tiers_org ON loyalty_tiers(organization_id);

-- ── LOYALTY TIER RULES ────────────────────────────────────────────────────

CREATE TABLE loyalty_tier_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  tier              customer_tier NOT NULL,
  rule_type         VARCHAR(50) NOT NULL,                   -- 'earn_per_aed', 'redeem_min', 'birthday_bonus'
  rule_value        DECIMAL(10,4) NOT NULL,
  description       TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loyalty_rules_org ON loyalty_tier_rules(organization_id, tier);

-- ── LOYALTY REDEMPTIONS (detailed log) ───────────────────────────────────

CREATE TABLE loyalty_redemptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  transaction_id    UUID REFERENCES transactions(id),
  points_redeemed   INTEGER NOT NULL,
  aed_value         DECIMAL(14,2) NOT NULL,                 -- 100 pts = AED 1.00
  redeemed_by       UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_redemptions_customer ON loyalty_redemptions(customer_id, created_at DESC);

-- ── GIFT CARD TRANSACTIONS ────────────────────────────────────────────────

CREATE TABLE gift_card_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  gift_card_id      UUID NOT NULL REFERENCES gift_cards(id),
  transaction_id    UUID REFERENCES transactions(id),
  transaction_type  VARCHAR(20) NOT NULL,                   -- 'issue'|'redeem'|'load'|'void'
  amount            DECIMAL(14,2) NOT NULL,
  balance_before    DECIMAL(14,2) NOT NULL,
  balance_after     DECIMAL(14,2) NOT NULL,
  processed_by      UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gc_transactions_card ON gift_card_transactions(gift_card_id, created_at DESC);

-- ── WISHLISTS ─────────────────────────────────────────────────────────────

CREATE TABLE wishlists (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  product_variant_id UUID NOT NULL REFERENCES product_variants(id),
  added_by          UUID REFERENCES users(id),              -- staff can add on behalf
  notes             TEXT,
  notify_on_restock BOOLEAN NOT NULL DEFAULT TRUE,
  notify_on_price_drop BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, product_variant_id)
);

CREATE INDEX idx_wishlists_customer ON wishlists(customer_id);
CREATE INDEX idx_wishlists_variant  ON wishlists(product_variant_id);

-- ── BESPOKE ORDERS ────────────────────────────────────────────────────────

CREATE TABLE bespoke_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  -- Assignment
  perfumer_id       UUID REFERENCES users(id),
  staff_id          UUID NOT NULL REFERENCES users(id),     -- account manager
  -- Product link
  formula_id        BIGINT REFERENCES bespoke_formulas(id),
  -- Details
  name              VARCHAR(255),                           -- tentative fragrance name
  brief             TEXT NOT NULL,                          -- customer's scent brief
  occasion          TEXT,
  budget_aed        DECIMAL(14,2),
  -- Status
  status            VARCHAR(30) NOT NULL DEFAULT 'briefing',-- briefing|sampling|approved|production|ready|delivered
  consultation_date DATE,
  sample_dates      JSONB DEFAULT '[]',                     -- [{date, session_id, notes}]
  approval_date     DATE,
  delivery_date     DATE,
  -- Pricing
  quoted_price      DECIMAL(14,2),
  deposit_paid      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  final_price       DECIMAL(14,2),
  linked_transaction_id UUID REFERENCES transactions(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bespoke_orders_customer ON bespoke_orders(customer_id);
CREATE INDEX idx_bespoke_orders_org      ON bespoke_orders(organization_id, status);

CREATE TABLE bespoke_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bespoke_order_id  UUID NOT NULL REFERENCES bespoke_orders(id) ON DELETE CASCADE,
  description       TEXT NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_price        DECIMAL(14,2) NOT NULL,
  line_total        DECIMAL(14,2) NOT NULL
);

CREATE INDEX idx_bespoke_order_items ON bespoke_order_items(bespoke_order_id);

-- ── CONSULTATION SESSIONS ─────────────────────────────────────────────────

CREATE TABLE consultation_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  staff_id          UUID NOT NULL REFERENCES users(id),
  appointment_id    BIGINT REFERENCES appointments(id),
  bespoke_order_id  UUID REFERENCES bespoke_orders(id),
  -- Session details
  session_type      VARCHAR(30) NOT NULL DEFAULT 'scent_consultation', -- scent_consultation|bespoke_brief|sample_review
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  duration_minutes  INTEGER,
  -- Notes
  products_tested   JSONB DEFAULT '[]',                     -- [{product_id, variant_id, reaction}]
  outcome_notes     TEXT,
  follow_up_date    DATE,
  -- Conversion
  resulted_in_sale  BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_id    UUID REFERENCES transactions(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consultation_customer ON consultation_sessions(customer_id, started_at DESC);
CREATE INDEX idx_consultation_staff    ON consultation_sessions(staff_id, started_at DESC);
