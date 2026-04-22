-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 013_inventory_extended.sql
-- Stock Count Sessions/Items, Transfer Orders, Product Categories,
-- Product Attributes, Price Lists, Product Bundles
-- Blueprint Phase 1 (Core Sales) + Phase 2 (CRM)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STOCK COUNT SESSIONS (Cycle Counting) ────────────────────────────────

CREATE TABLE stock_count_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  location_id       UUID NOT NULL REFERENCES locations(id),
  reference         VARCHAR(50) NOT NULL UNIQUE,            -- CYCLE-YYYYMMDD-NNN
  status            VARCHAR(20) NOT NULL DEFAULT 'in_progress', -- in_progress|completed|cancelled
  count_type        VARCHAR(20) NOT NULL DEFAULT 'full',    -- full|partial|spot_check
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  started_by        UUID NOT NULL REFERENCES users(id),
  completed_by      UUID REFERENCES users(id),
  notes             TEXT,
  -- Summary
  items_counted     INTEGER NOT NULL DEFAULT 0,
  items_variance    INTEGER NOT NULL DEFAULT 0,             -- positive = surplus, negative = missing
  variance_value    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_count_location ON stock_count_sessions(location_id, started_at DESC);
CREATE INDEX idx_stock_count_status   ON stock_count_sessions(organization_id, status);

-- ── STOCK COUNT ITEMS ─────────────────────────────────────────────────────

CREATE TABLE stock_count_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
  product_variant_id    UUID NOT NULL REFERENCES product_variants(id),
  -- Expected vs actual
  system_quantity       INTEGER NOT NULL DEFAULT 0,         -- quantity_on_hand at session start
  counted_quantity      INTEGER,                            -- NULL = not yet counted
  variance              INTEGER GENERATED ALWAYS AS (
    CASE WHEN counted_quantity IS NOT NULL
         THEN counted_quantity - system_quantity ELSE NULL END
  ) STORED,
  -- Audit
  counted_by            UUID REFERENCES users(id),
  counted_at            TIMESTAMPTZ,
  notes                 TEXT,
  UNIQUE(session_id, product_variant_id)
);

CREATE INDEX idx_count_items_session  ON stock_count_items(session_id);
CREATE INDEX idx_count_items_variant  ON stock_count_items(product_variant_id);

COMMENT ON TABLE stock_count_items IS 'fn_stock_count_finalize trigger applies counted_quantity to inventory on session complete';

-- ── TRANSFER ORDERS (Inter-location stock moves) ──────────────────────────

CREATE TABLE transfer_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  reference         VARCHAR(50) NOT NULL UNIQUE,            -- XFER-YYYYMMDD-NNN
  from_location_id  UUID NOT NULL REFERENCES locations(id),
  to_location_id    UUID NOT NULL REFERENCES locations(id),
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft|approved|in_transit|received|cancelled
  requested_by      UUID NOT NULL REFERENCES users(id),
  approved_by       UUID REFERENCES users(id),
  received_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  dispatched_at     TIMESTAMPTZ,
  received_at       TIMESTAMPTZ,
  expected_date     DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_location_id != to_location_id)
);

CREATE INDEX idx_transfers_org   ON transfer_orders(organization_id, created_at DESC);
CREATE INDEX idx_transfers_from  ON transfer_orders(from_location_id);
CREATE INDEX idx_transfers_to    ON transfer_orders(to_location_id);
CREATE INDEX idx_transfers_status ON transfer_orders(organization_id, status);

CREATE TABLE transfer_order_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_order_id     UUID NOT NULL REFERENCES transfer_orders(id) ON DELETE CASCADE,
  product_variant_id    UUID NOT NULL REFERENCES product_variants(id),
  quantity_requested    INTEGER NOT NULL CHECK (quantity_requested > 0),
  quantity_dispatched   INTEGER NOT NULL DEFAULT 0,
  quantity_received     INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  UNIQUE(transfer_order_id, product_variant_id)
);

CREATE INDEX idx_transfer_items_order ON transfer_order_items(transfer_order_id);

-- ── PRODUCT CATEGORIES (Hierarchy) ───────────────────────────────────────

CREATE TABLE product_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  name_ar           VARCHAR(100),
  slug              VARCHAR(100) NOT NULL,
  parent_id         UUID REFERENCES product_categories(id),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  icon_url          TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);

CREATE INDEX idx_product_categories_org    ON product_categories(organization_id);
CREATE INDEX idx_product_categories_parent ON product_categories(parent_id);

-- ── PRODUCT ATTRIBUTES ────────────────────────────────────────────────────

CREATE TABLE product_attributes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_key     VARCHAR(100) NOT NULL,                  -- 'concentration', 'longevity_rating'
  attribute_value   TEXT NOT NULL,
  display_order     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, attribute_key)
);

CREATE INDEX idx_product_attributes_product ON product_attributes(product_id);

-- ── PRICE LISTS ───────────────────────────────────────────────────────────

CREATE TABLE price_lists (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  description       TEXT,
  currency          currency_code NOT NULL DEFAULT 'AED',
  -- Applicability
  customer_tier     customer_tier,                          -- NULL = applies to all
  is_wholesale      BOOLEAN NOT NULL DEFAULT FALSE,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from        DATE,
  valid_to          DATE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_lists_org  ON price_lists(organization_id, is_active);

CREATE TABLE price_list_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id     UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants(id),
  price             DECIMAL(14,2) NOT NULL,
  discount_percent  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  min_quantity      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(price_list_id, product_variant_id)
);

CREATE INDEX idx_price_list_items_list    ON price_list_items(price_list_id);
CREATE INDEX idx_price_list_items_variant ON price_list_items(product_variant_id);

-- ── TAX RATES ─────────────────────────────────────────────────────────────

CREATE TABLE tax_rates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  tax_type          tax_type NOT NULL DEFAULT 'vat',
  rate              DECIMAL(5,4) NOT NULL,                  -- 0.0500 = 5%
  country_code      CHAR(2) NOT NULL DEFAULT 'AE',
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from    DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to      DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tax_rates_org ON tax_rates(organization_id, is_active);

-- ── PRODUCT BUNDLES (Gift Sets, Packs) ───────────────────────────────────

CREATE TABLE product_bundles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(255) NOT NULL,
  name_ar           VARCHAR(255),
  sku               VARCHAR(80) NOT NULL UNIQUE,
  bundle_price      DECIMAL(14,2) NOT NULL,
  compare_at_price  DECIMAL(14,2),                          -- original price before bundle
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  thumbnail_url     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bundles_org ON product_bundles(organization_id, is_active);

CREATE TABLE product_bundle_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id         UUID NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants(id),
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  display_order     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bundle_id, product_variant_id)
);

CREATE INDEX idx_bundle_items_bundle  ON product_bundle_items(bundle_id);
CREATE INDEX idx_bundle_items_variant ON product_bundle_items(product_variant_id);
