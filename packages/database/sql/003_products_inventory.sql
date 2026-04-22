-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 003_products_inventory.sql
-- Products, Brands, Variants, Inventory, NFC, AR Assets
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- BRANDS
-- ══════════════════════════════════════════════════════

CREATE TABLE brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name            VARCHAR(255) NOT NULL,
  name_ar         VARCHAR(255),
  slug            VARCHAR(100) NOT NULL,
  logo_url        TEXT,
  country_of_origin VARCHAR(100),
  description     TEXT,
  description_ar  TEXT,
  is_house_brand  BOOLEAN NOT NULL DEFAULT FALSE,          -- TRUE for bespoke in-house
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);

CREATE INDEX idx_brands_org ON brands(organization_id);

-- ══════════════════════════════════════════════════════
-- SUPPLIERS
-- ══════════════════════════════════════════════════════

CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  brand_id        UUID REFERENCES brands(id),
  name            VARCHAR(255) NOT NULL,
  contact_name    VARCHAR(255),
  email           VARCHAR(255),
  phone           VARCHAR(50),
  address         TEXT,
  country_code    CHAR(2),
  payment_terms   INTEGER NOT NULL DEFAULT 30,             -- days
  currency        currency_code NOT NULL DEFAULT 'AED',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_org ON suppliers(organization_id);

-- ══════════════════════════════════════════════════════
-- PRODUCTS
-- ══════════════════════════════════════════════════════

CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  brand_id            UUID REFERENCES brands(id),
  sku_base            VARCHAR(50) NOT NULL UNIQUE DEFAULT 'SKU-' || nextval('seq_product_sku'),
  name                VARCHAR(255) NOT NULL,
  name_ar             VARCHAR(255),
  slug                VARCHAR(255),
  description         TEXT,
  description_ar      TEXT,
  category            product_category NOT NULL,
  fragrance_family    fragrance_family[],
  top_notes           TEXT[],
  heart_notes         TEXT[],
  base_notes          TEXT[],
  perfumer            VARCHAR(255),
  year_created        INTEGER,
  concentration       VARCHAR(50),                         -- "Eau de Parfum", "Pure Parfum"
  longevity_hours     DECIMAL(4,1),                        -- avg wear time
  sillage             VARCHAR(50),                         -- intimate|moderate|strong|enormous
  season              TEXT[],                              -- ['winter', 'evening']
  gender_target       gender DEFAULT 'non_binary',
  is_nfc_tagged       BOOLEAN NOT NULL DEFAULT FALSE,      -- bottles >AED500 get NFC
  nfc_price_threshold DECIMAL(10,2) DEFAULT 500.00,
  inventory_mode      inventory_mode NOT NULL DEFAULT 'brand',
  status              product_status NOT NULL DEFAULT 'active',
  thumbnail_url       TEXT,
  image_urls          JSONB DEFAULT '[]',
  ar_glb_url          TEXT,                                -- Cloudflare R2 GLB asset
  ar_usdz_url         TEXT,                                -- Cloudflare R2 USDZ (visionOS 3)
  ar_usdz_physics_url TEXT,                                -- visionOS 3 physics-enabled USDZ
  meta_title          VARCHAR(255),
  meta_description    TEXT,
  tags                TEXT[],
  -- AI / Vector
  embedding_vector    vector(1536),                        -- OpenAI text-embedding-3-small
  ai_enriched_at      TIMESTAMPTZ,
  -- Audit
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_org       ON products(organization_id);
CREATE INDEX idx_products_brand     ON products(brand_id);
CREATE INDEX idx_products_category  ON products(category);
CREATE INDEX idx_products_status    ON products(organization_id, status) WHERE status = 'active';
CREATE INDEX idx_products_mode      ON products(inventory_mode);
CREATE INDEX idx_products_trgm_name ON products USING gin(name gin_trgm_ops);    -- fuzzy search
CREATE INDEX idx_products_tags      ON products USING gin(tags);
CREATE INDEX idx_products_notes     ON products USING gin(top_notes, heart_notes, base_notes);

-- HNSW vector index (replaces IVFFlat per v5.1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_embedding_hnsw
  ON products
  USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

COMMENT ON TABLE products IS 'Master product catalog — supports brand and bespoke modes';
COMMENT ON COLUMN products.embedding_vector IS '1536-dim vector (OpenAI text-embedding-3-small) — HNSW indexed';

-- ══════════════════════════════════════════════════════
-- PRODUCT VARIANTS (Size / Concentration)
-- ══════════════════════════════════════════════════════

CREATE TABLE product_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  sku             VARCHAR(80) NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL,                   -- "30ml", "50ml EDP", "100ml Parfum"
  size_ml         INTEGER,                                 -- volume in ml
  unit_type       VARCHAR(20) DEFAULT 'bottle',
  barcode         VARCHAR(100),
  cost_price      DECIMAL(14,2),                           -- purchase/manufacturing cost
  retail_price    DECIMAL(14,2) NOT NULL,
  wholesale_price DECIMAL(14,2),
  vat_rate        DECIMAL(5,4) NOT NULL DEFAULT 0.0500,    -- 5% UAE VAT
  weight_grams    INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_discontinued BOOLEAN NOT NULL DEFAULT FALSE,
  requires_nfc    BOOLEAN NOT NULL DEFAULT FALSE,          -- >AED500 auto-flagged
  thumbnail_url   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_sku     ON product_variants(sku);
CREATE INDEX idx_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_variants_org     ON product_variants(organization_id);

-- ══════════════════════════════════════════════════════
-- INVENTORY
-- ══════════════════════════════════════════════════════

CREATE TABLE inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  quantity_on_hand    INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  quantity_available  INTEGER GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
  quantity_incoming   INTEGER NOT NULL DEFAULT 0,
  reorder_point       INTEGER NOT NULL DEFAULT 5,
  reorder_quantity    INTEGER NOT NULL DEFAULT 20,
  bin_location        VARCHAR(50),                         -- warehouse shelf location
  last_count_at       TIMESTAMPTZ,
  last_count_by       UUID REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_variant_id, location_id)
);

CREATE INDEX idx_inventory_variant  ON inventory(product_variant_id);
CREATE INDEX idx_inventory_location ON inventory(location_id);
CREATE INDEX idx_inventory_low      ON inventory(organization_id, quantity_available)
  WHERE quantity_available <= reorder_point;

COMMENT ON TABLE inventory IS 'Single source of truth for stock levels — mutated by trigger fn_inventory_deduct_on_sale';

-- ══════════════════════════════════════════════════════
-- INVENTORY ADJUSTMENTS (audit trail)
-- ══════════════════════════════════════════════════════

CREATE TABLE inventory_adjustments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
  location_id         UUID NOT NULL REFERENCES locations(id),
  adjusted_by         UUID NOT NULL REFERENCES users(id),
  reason              inventory_adjustment_reason NOT NULL,
  qty_before          INTEGER NOT NULL,
  qty_change          INTEGER NOT NULL,                    -- positive or negative
  qty_after           INTEGER NOT NULL,
  reference_id        UUID,                                -- PO, transaction, etc.
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_adj_variant  ON inventory_adjustments(product_variant_id);
CREATE INDEX idx_inv_adj_location ON inventory_adjustments(location_id, created_at DESC);

-- ══════════════════════════════════════════════════════
-- STOCK RESERVATIONS (layaway, appointments)
-- ══════════════════════════════════════════════════════

CREATE TABLE stock_reservations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
  location_id         UUID NOT NULL REFERENCES locations(id),
  customer_id         UUID,                                -- FK to customers (circular dep avoided)
  transaction_id      UUID,                               -- FK to transactions
  quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status              stock_reservation_status NOT NULL DEFAULT 'active',
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reservations_variant  ON stock_reservations(product_variant_id);
CREATE INDEX idx_reservations_active   ON stock_reservations(status, expires_at)
  WHERE status = 'active';

COMMENT ON TABLE stock_reservations IS 'Managed by pg_cron luxe-expire-reservations every 15min (concurrency_policy: skip)';

-- ══════════════════════════════════════════════════════
-- INVENTORY SNAPSHOTS (daily pg_cron)
-- ══════════════════════════════════════════════════════

CREATE TABLE inventory_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  location_id         UUID NOT NULL REFERENCES locations(id),
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
  snapshot_date       DATE NOT NULL,
  quantity_on_hand    INTEGER NOT NULL,
  quantity_reserved   INTEGER NOT NULL,
  quantity_available  INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_variant_id, location_id, snapshot_date)
);

CREATE INDEX idx_snapshots_date ON inventory_snapshots(organization_id, snapshot_date DESC);

-- ══════════════════════════════════════════════════════
-- NFC BOTTLE REGISTRY
-- ══════════════════════════════════════════════════════

CREATE TABLE nfc_bottle_registry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
  bottle_id           VARCHAR(100) NOT NULL UNIQUE,        -- UUID embedded in chip
  batch_number        VARCHAR(50),
  hmac_key_id         VARCHAR(100) NOT NULL,               -- AWS KMS key reference
  chip_counter        INTEGER NOT NULL DEFAULT 0,          -- SUN message counter
  chip_uid            VARCHAR(50),                         -- NTAG 424 DNA UID
  status              VARCHAR(20) NOT NULL DEFAULT 'in_stock',
  sold_at             TIMESTAMPTZ,
  sold_transaction_id UUID,
  sold_staff_id       UUID REFERENCES users(id),
  fraud_flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index on bottle lookup (Section 3.2.1)
CREATE INDEX idx_nfc_registry_bottle  ON nfc_bottle_registry(bottle_id);
CREATE INDEX idx_nfc_registry_variant ON nfc_bottle_registry(product_variant_id);
CREATE INDEX idx_nfc_registry_status  ON nfc_bottle_registry(status);

COMMENT ON TABLE nfc_bottle_registry IS 'NTAG 424 DNA NFC chip registry — HMAC-SHA256 via AWS KMS, anti-replay counter';

-- ══════════════════════════════════════════════════════
-- NFC SCAN LOG
-- ══════════════════════════════════════════════════════

CREATE TABLE nfc_scan_log (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_nfc_scan_number'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  bottle_id       VARCHAR(100),
  device_id       UUID REFERENCES pos_devices(id),
  staff_id        UUID REFERENCES users(id),
  sun_message     TEXT,                                    -- raw SUN for audit
  counter_value   INTEGER,
  validation_status nfc_validation_status NOT NULL,
  fraud_signal    BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms      INTEGER,                                 -- must be <200ms (SLA)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfc_log_bottle  ON nfc_scan_log(bottle_id, created_at DESC);
CREATE INDEX idx_nfc_log_fraud   ON nfc_scan_log(organization_id, fraud_signal)
  WHERE fraud_signal = TRUE;

-- ══════════════════════════════════════════════════════
-- AR ASSETS
-- ══════════════════════════════════════════════════════

CREATE TABLE ar_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  asset_type      ar_asset_type NOT NULL,
  file_url        TEXT NOT NULL,                           -- Cloudflare R2 URL
  file_size_bytes INTEGER,
  cdn_url         TEXT,                                    -- CDN-fronted URL
  physics_enabled BOOLEAN NOT NULL DEFAULT FALSE,          -- visionOS 3 physics flag
  compression     VARCHAR(20) DEFAULT 'draco',
  metadata        JSONB DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ar_assets_product ON ar_assets(product_id, asset_type);

COMMENT ON TABLE ar_assets IS 'GLB / USDZ assets for storefront and visionOS 3 Spatial Commerce — served from Cloudflare R2';
