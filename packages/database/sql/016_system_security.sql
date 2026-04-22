-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 016_system_security.sql
-- API Keys, Webhooks, System Config, Notifications,
-- Media Files, Product Media
-- Blueprint Phase 0 (Foundation) security layer
-- ═══════════════════════════════════════════════════════════════════════════

-- ── API KEYS (Layer 6 — Blueprint Section 10) ────────────────────────────

CREATE TABLE api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  description       TEXT,
  key_prefix        CHAR(8) NOT NULL,                       -- first 8 chars for display: luxe_xxxx
  key_hash          TEXT NOT NULL UNIQUE,                   -- bcrypt hash — raw key shown only once at creation
  -- Scopes
  scopes            TEXT[] NOT NULL DEFAULT '{}',           -- ['products:read', 'orders:write']
  -- Restrictions
  allowed_ips       INET[],                                 -- NULL = all IPs allowed
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  -- Status
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID REFERENCES users(id)
);

CREATE INDEX idx_api_keys_org    ON api_keys(organization_id, is_active);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

COMMENT ON TABLE api_keys IS 'Scoped API keys for third-party integrations (Blueprint Security Layer 6). Raw key shown only at creation.';

-- ── WEBHOOKS ─────────────────────────────────────────────────────────────

CREATE TABLE webhooks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  name              VARCHAR(100) NOT NULL,
  url               TEXT NOT NULL,
  -- Secret for signature verification (HMAC-SHA256)
  secret_hash       TEXT NOT NULL,
  -- Events to subscribe to
  events            TEXT[] NOT NULL DEFAULT '{}',           -- ['transaction.completed', 'inventory.low_stock']
  -- Headers to include
  custom_headers    JSONB DEFAULT '{}',
  -- Status
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhooks_org ON webhooks(organization_id, is_active);

-- ── WEBHOOK DELIVERIES ────────────────────────────────────────────────────

CREATE TABLE webhook_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id        UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  -- Response
  response_status   INTEGER,
  response_body     TEXT,
  duration_ms       INTEGER,
  -- Status
  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|delivered|failed
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_retry_at     TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- 30-day rolling partitions for webhook deliveries (high volume)
CREATE TABLE webhook_deliveries_2026_04 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE webhook_deliveries_2026_05 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE webhook_deliveries_2026_06 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE webhook_deliveries_2026_07 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE webhook_deliveries_2026_08 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE webhook_deliveries_2026_09 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE webhook_deliveries_2026_10 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE webhook_deliveries_2026_11 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE webhook_deliveries_2026_12 PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_status  ON webhook_deliveries(status, next_retry_at)
  WHERE status = 'failed';

-- ── SYSTEM CONFIG ─────────────────────────────────────────────────────────

CREATE TABLE system_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  config_key        VARCHAR(100) NOT NULL,
  config_value      JSONB NOT NULL,
  description       TEXT,
  is_encrypted      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, config_key)
);

CREATE INDEX idx_system_config_org ON system_config(organization_id);

-- ── NOTIFICATIONS (In-app notification queue) ─────────────────────────────

CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID REFERENCES users(id),              -- NULL = broadcast to org
  -- Content
  title             TEXT NOT NULL,
  title_ar          TEXT,
  body              TEXT NOT NULL,
  body_ar           TEXT,
  notification_type VARCHAR(50) NOT NULL,                   -- 'vip_arrival'|'low_stock'|'fraud_alert'|'device_approval'
  icon              VARCHAR(50) DEFAULT 'bell',
  color             VARCHAR(7) DEFAULT '#f59e0b',
  -- Action
  action_type       VARCHAR(30),                            -- 'navigate'|'open_modal'|'dismiss'
  action_payload    JSONB,
  -- Status
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  read_at           TIMESTAMPTZ,
  -- Source
  source_type       VARCHAR(50),                            -- 'transaction'|'inventory'|'nfc'|'system'
  source_id         UUID,
  expires_at        TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user    ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_org     ON notifications(organization_id, created_at DESC)
  WHERE user_id IS NULL;  -- broadcast notifications
CREATE INDEX idx_notifications_expires ON notifications(expires_at) WHERE is_read = FALSE;

-- ── NOTIFICATION PREFERENCES ──────────────────────────────────────────────

CREATE TABLE notification_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  -- Channel preferences
  in_app_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Event preferences (override defaults)
  preferences       JSONB NOT NULL DEFAULT '{}',            -- {'vip_arrival': true, 'low_stock': false}
  -- Quiet hours
  quiet_start       TIME,                                   -- e.g. '22:00'
  quiet_end         TIME,                                   -- e.g. '08:00'
  timezone          VARCHAR(50) NOT NULL DEFAULT 'Asia/Dubai',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- ── MEDIA FILES ───────────────────────────────────────────────────────────

CREATE TABLE media_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  -- File info
  filename          TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   BIGINT NOT NULL,
  -- Storage
  storage_key       TEXT NOT NULL UNIQUE,                   -- Cloudflare R2 object key
  cdn_url           TEXT NOT NULL,                          -- public CDN URL
  thumbnail_url     TEXT,
  -- Metadata
  alt_text          TEXT,
  alt_text_ar       TEXT,
  width             INTEGER,
  height            INTEGER,
  duration_seconds  INTEGER,                                -- for video/audio
  -- Classification
  media_type        VARCHAR(20) NOT NULL DEFAULT 'image',   -- image|video|audio|document|ar_asset
  uploaded_by       UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_files_org  ON media_files(organization_id, created_at DESC);
CREATE INDEX idx_media_files_type ON media_files(organization_id, media_type);

-- ── PRODUCT MEDIA (junction table) ───────────────────────────────────────

CREATE TABLE product_media (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_file_id     UUID NOT NULL REFERENCES media_files(id),
  media_role        VARCHAR(30) NOT NULL DEFAULT 'gallery', -- thumbnail|gallery|ar_glb|ar_usdz|video_360
  display_order     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, media_file_id, media_role)
);

CREATE INDEX idx_product_media_product ON product_media(product_id, display_order);
