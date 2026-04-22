-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 004_customers_crm.sql
-- Customers, Digital Black Book, Scent Wardrobe, Loyalty, Gift Cards
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- CUSTOMERS
-- ══════════════════════════════════════════════════════

CREATE TABLE customers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_number       BIGINT UNIQUE DEFAULT nextval('seq_customer_number'),
  first_name            VARCHAR(100) NOT NULL,
  last_name             VARCHAR(100) NOT NULL,
  first_name_ar         VARCHAR(100),
  last_name_ar          VARCHAR(100),
  display_name          VARCHAR(200) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  email                 VARCHAR(255),
  phone                 VARCHAR(50),                       -- E.164 format: +971501234567
  phone_whatsapp        VARCHAR(50),
  gender                gender,
  date_of_birth         DATE,
  nationality           CHAR(2),                          -- ISO 3166-1 alpha-2
  tier                  customer_tier NOT NULL DEFAULT 'standard',
  language_preference   language_preference NOT NULL DEFAULT 'ar',
  greeting_style        greeting_style NOT NULL DEFAULT 'arabic_formal',
  preferred_staff_id    UUID REFERENCES users(id),        -- auto-notify on VIP arrival
  total_lifetime_value  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_purchases       INTEGER NOT NULL DEFAULT 0,
  average_order_value   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  loyalty_points        INTEGER NOT NULL DEFAULT 0,
  loyalty_points_pending INTEGER NOT NULL DEFAULT 0,
  -- Biometric
  biometric_enrolled    BOOLEAN NOT NULL DEFAULT FALSE,
  biometric_type        biometric_type NOT NULL DEFAULT 'none',
  biometric_token_ref   TEXT,                             -- Amazon One provider reference
  -- Marketing
  email_opt_in          BOOLEAN NOT NULL DEFAULT TRUE,
  sms_opt_in            BOOLEAN NOT NULL DEFAULT TRUE,
  whatsapp_opt_in       BOOLEAN NOT NULL DEFAULT TRUE,
  push_opt_in           BOOLEAN NOT NULL DEFAULT TRUE,
  -- Profile
  avatar_url            TEXT,
  notes                 TEXT,                             -- private staff notes
  -- Metadata
  acquisition_channel   VARCHAR(50),
  referred_by_id        UUID REFERENCES customers(id),
  is_vip                BOOLEAN NOT NULL DEFAULT FALSE,
  is_wholesale          BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  last_visit_at         TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email),
  UNIQUE(organization_id, phone)
);

CREATE INDEX idx_customers_org       ON customers(organization_id);
CREATE INDEX idx_customers_phone     ON customers(phone);
CREATE INDEX idx_customers_email     ON customers(email);
CREATE INDEX idx_customers_tier      ON customers(organization_id, tier);
CREATE INDEX idx_customers_vip       ON customers(organization_id, is_vip) WHERE is_vip = TRUE;
CREATE INDEX idx_customers_preferred ON customers(preferred_staff_id) WHERE preferred_staff_id IS NOT NULL;
CREATE INDEX idx_customers_trgm_name ON customers USING gin(display_name gin_trgm_ops);
CREATE INDEX idx_customers_trgm_phone ON customers USING gin(phone gin_trgm_ops);

COMMENT ON TABLE customers IS 'CRM customer master — includes biometric enrollment ref, loyalty, HNWI profile';

-- ══════════════════════════════════════════════════════
-- DIGITAL BLACK BOOK (Customer Intelligence)
-- Blueprint Section 8.2 — full field set
-- ══════════════════════════════════════════════════════

CREATE TABLE customer_black_book (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id       UUID NOT NULL REFERENCES organizations(id),

  -- Scent Profile
  preferred_families    fragrance_family[],
  avoided_notes         TEXT[],
  disliked_brands       TEXT[],

  -- Skin Science (fragrance longevity predictor)
  skin_ph               DECIMAL(3,1) CHECK (skin_ph BETWEEN 4.5 AND 7.5),
  skin_ph_source        VARCHAR(50),                      -- 'patch_test', 'self_reported', 'lab'
  skin_type             skin_type,

  -- Household Intelligence
  spouse_name           VARCHAR(200),
  spouse_scent_preferences JSONB DEFAULT '{}',
  children_names        JSONB DEFAULT '[]',               -- [{name, age, gender}]
  household_size        INTEGER,

  -- Hospitality Preferences
  preferred_beverage    VARCHAR(100),                     -- 'Arabic coffee', 'Green tea'
  greeting_style        greeting_style,
  language_preference   language_preference,
  special_requirements  TEXT,

  -- VIP Logistics
  preferred_delivery_method delivery_method,
  hotel_name            VARCHAR(255),
  yacht_name            VARCHAR(255),
  private_jet_tail      VARCHAR(20),
  villa_address         TEXT,
  preferred_delivery_time VARCHAR(100),

  -- Key Dates (proactive outreach triggers)
  key_dates             JSONB NOT NULL DEFAULT '[]',      -- [{type:'birthday', date:'MM-DD', notes:''}]

  -- Staff Preferences
  preferred_staff_id    UUID REFERENCES users(id),
  blacklisted_staff_ids UUID[],

  -- Bespoke Preferences
  bottle_engraving_preferences TEXT,
  packaging_preferences TEXT,
  bespoke_budget_range  JSONB,                            -- {min: 5000, max: 50000, currency: 'AED'}

  -- Privacy
  data_sharing_consent  BOOLEAN NOT NULL DEFAULT TRUE,
  last_profile_review   TIMESTAMPTZ,
  reviewed_by           UUID REFERENCES users(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id)
);

CREATE INDEX idx_black_book_customer ON customer_black_book(customer_id);
CREATE INDEX idx_black_book_key_dates ON customer_black_book USING gin(key_dates);

COMMENT ON TABLE customer_black_book IS 'Digital Black Book — Blueprint Section 8.2 complete field set';

-- ══════════════════════════════════════════════════════
-- SCENT WARDROBE (OR-Set CRDT — per blueprint)
-- ══════════════════════════════════════════════════════

CREATE TABLE scent_wardrobe (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  product_id      UUID NOT NULL REFERENCES products(id),
  variant_id      UUID REFERENCES product_variants(id),
  -- OR-Set CRDT metadata
  or_set_tag      UUID NOT NULL DEFAULT gen_random_uuid(), -- unique add-tag for conflict-free removal
  -- Wardrobe metadata
  occasion        TEXT[],                                 -- ['evening', 'work', 'weekend']
  notes           TEXT,
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  is_signature    BOOLEAN NOT NULL DEFAULT FALSE,
  added_by        UUID REFERENCES users(id),
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at      TIMESTAMPTZ,
  is_removed      BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(customer_id, product_id, or_set_tag)
);

CREATE INDEX idx_wardrobe_customer ON scent_wardrobe(customer_id) WHERE is_removed = FALSE;
CREATE INDEX idx_wardrobe_product  ON scent_wardrobe(product_id);

COMMENT ON TABLE scent_wardrobe IS 'OR-Set CRDT — scent entries added offline by multiple staff merge cleanly';

-- ══════════════════════════════════════════════════════
-- CUSTOMER EMBEDDINGS (AI vector profile)
-- ══════════════════════════════════════════════════════

CREATE TABLE customer_embeddings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  preference_vector vector(1536),                         -- HNSW indexed
  model_version     VARCHAR(50) NOT NULL DEFAULT 'text-embedding-3-small',
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id)
);

-- HNSW index per Section 3.2.1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_embeddings_hnsw
  ON customer_embeddings
  USING hnsw (preference_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

COMMENT ON TABLE customer_embeddings IS 'Customer preference vectors — HNSW indexed for <5ms AI similarity search';

-- ══════════════════════════════════════════════════════
-- LOYALTY TRANSACTIONS
-- ══════════════════════════════════════════════════════

CREATE TABLE loyalty_transactions (
  id              BIGINT PRIMARY KEY DEFAULT nextval('seq_loyalty_txn'),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  transaction_type loyalty_transaction_type NOT NULL,
  points          INTEGER NOT NULL,                       -- positive = earned, negative = redeemed
  points_balance  INTEGER NOT NULL,                       -- snapshot after this transaction
  reference_id    UUID,                                   -- sale transaction / campaign
  reference_type  VARCHAR(50),
  description     TEXT,
  expires_at      TIMESTAMPTZ,                            -- loyalty points expiry
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loyalty_customer ON loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX idx_loyalty_expiry   ON loyalty_transactions(expires_at)
  WHERE expires_at IS NOT NULL AND points > 0;

COMMENT ON TABLE loyalty_transactions IS 'PN-Counter CRDT — offline earn accumulates correctly across terminals';

-- ══════════════════════════════════════════════════════
-- GIFT CARDS
-- ══════════════════════════════════════════════════════

CREATE TABLE gift_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  code            VARCHAR(30) NOT NULL UNIQUE,            -- masked display code
  code_hash       TEXT NOT NULL UNIQUE,                   -- bcrypt hash for PCI
  initial_value   DECIMAL(14,2) NOT NULL,
  current_balance DECIMAL(14,2) NOT NULL,
  currency        currency_code NOT NULL DEFAULT 'AED',
  status          gift_card_status NOT NULL DEFAULT 'pending_activation',
  issued_to       UUID REFERENCES customers(id),
  issued_by       UUID REFERENCES users(id),
  activated_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  customization   JSONB DEFAULT '{}',                     -- {message, from_name, design}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gift_cards_customer ON gift_cards(issued_to);
CREATE INDEX idx_gift_cards_status   ON gift_cards(status);
CREATE INDEX idx_gift_cards_expires  ON gift_cards(expires_at) WHERE status = 'active';

-- ══════════════════════════════════════════════════════
-- AI TRAINING EVENTS (always ON per blueprint)
-- ══════════════════════════════════════════════════════

CREATE TABLE ai_training_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_id     UUID REFERENCES customers(id),
  event_type      VARCHAR(100) NOT NULL,                  -- 'product_view', 'purchase', 'recommendation_click'
  event_data      JSONB NOT NULL DEFAULT '{}',
  event_embedding vector(1536),                           -- computed by daily pg_cron job
  session_id      UUID,
  device_type     VARCHAR(50),
  locale          language_preference DEFAULT 'en',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE ai_training_events_2026_04 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE ai_training_events_2026_05 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE ai_training_events_2026_06 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE ai_training_events_2026_07 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE ai_training_events_2026_08 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE ai_training_events_2026_09 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE ai_training_events_2026_10 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE ai_training_events_2026_11 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE ai_training_events_2026_12 PARTITION OF ai_training_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- HNSW index per Section 3.2.1 (lower ef_construction for high-write table)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_training_events_hnsw
  ON ai_training_events
  USING hnsw (event_embedding vector_cosine_ops)
  WITH (m = 8, ef_construction = 128);

CREATE INDEX idx_ai_events_customer ON ai_training_events(customer_id, created_at DESC);
CREATE INDEX idx_ai_events_type     ON ai_training_events(event_type, created_at DESC);

COMMENT ON TABLE ai_training_events IS 'ai_data_collection_active=TRUE by default — logs all interactions for AI training';
