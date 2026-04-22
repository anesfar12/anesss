-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 009_seed_feature_flags.sql
-- 51 Feature Flags — AI flags all FALSE by default (Section 6.2)
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- SEED FEATURE FLAGS (org-level, inserted after org seed)
-- Run after organization seed — uses org slug 'luxe-pos-main'
-- ══════════════════════════════════════════════════════

INSERT INTO feature_flags (organization_id, flag_key, flag_type, value_boolean, description)
SELECT
  o.id,
  f.flag_key,
  'boolean',
  f.value_boolean,
  f.description
FROM organizations o, (VALUES

  -- ── AI FLAGS (Section 6.2) — ALL FALSE except data collection ──────────
  ('ai_service_enabled',              FALSE, 'Master AI switch — enables PythonAIAdapter'),
  ('ai_recommendations_active',       FALSE, 'Show product recommendations in POS UI'),
  ('ai_chat_assistant_active',        FALSE, 'Enable NLP chat assistant (SSE stream)'),
  ('ai_demand_forecast_active',       FALSE, 'Enable demand forecasting in dashboard'),
  ('ai_fraud_detection_active',       FALSE, 'Enable real-time fraud scoring on transactions'),
  ('ai_arabic_nlp_active',           FALSE, 'Enable Jais-30b Arabic model (Khaleeji dialect)'),
  ('ai_data_collection_active',       TRUE,  'ON by default — silently logs all interactions for AI training'),
  ('ai_embedding_sync_active',        FALSE, 'Enable daily ChromaDB HNSW embedding sync'),
  ('ai_price_optimization_active',    FALSE, 'Enable AI-driven dynamic pricing suggestions'),
  ('ai_inventory_forecast_active',    FALSE, 'Enable AI stock replenishment forecasting'),

  -- ── HARDWARE FLAGS ───────────────────────────────────────────────────────
  ('nfc_validation_enabled',          TRUE,  'Enable NFC NTAG 424 DNA bottle validation'),
  ('nfc_uwb_mode_enabled',            TRUE,  'Enable Ultra-Wideband NFC (iPhone 17 Pro)'),
  ('softpos_enabled',                 TRUE,  'Enable Tap to Pay SoftPOS (no hardware terminal)'),
  ('biometric_checkout_enabled',      TRUE,  'Enable Amazon One palm biometric checkout'),
  ('biometric_staff_auth_enabled',    TRUE,  'Enable Face ID / biometric staff PIN replacement'),
  ('barcode_scanner_enabled',         TRUE,  'Enable barcode scanner (Zebra DS3608 + camera)'),

  -- ── SALES & CHECKOUT FLAGS ───────────────────────────────────────────────
  ('layaway_enabled',                 TRUE,  'Enable layaway / hold transactions'),
  ('exchange_enabled',                TRUE,  'Enable product exchange transactions'),
  ('split_payment_enabled',           TRUE,  'Enable split payment across methods'),
  ('gift_card_enabled',               TRUE,  'Enable gift card issuance and redemption'),
  ('loyalty_program_enabled',         TRUE,  'Enable LUXE loyalty points program'),
  ('tax_free_export_enabled',         TRUE,  'Enable Global Blue tax-free export claims'),
  ('payment_links_enabled',           TRUE,  'Enable WhatsApp/email payment link generation'),
  ('offline_checkout_enabled',        TRUE,  'Enable CRDT offline-first checkout'),

  -- ── CRM & BLACK BOOK FLAGS ───────────────────────────────────────────────
  ('black_book_enabled',              TRUE,  'Enable Digital Black Book customer profiles'),
  ('scent_wardrobe_enabled',          TRUE,  'Enable Scent Wardrobe per customer'),
  ('skin_science_enabled',            TRUE,  'Enable skin pH / type collection for longevity prediction'),
  ('outreach_enabled',                TRUE,  'Enable CRM outreach campaigns'),
  ('appointment_booking_enabled',     TRUE,  'Enable appointment booking module'),
  ('key_date_alerts_enabled',         TRUE,  'Enable proactive outreach on key dates (birthday, Eid)'),

  -- ── BLOCKCHAIN FLAGS ─────────────────────────────────────────────────────
  ('blockchain_passport_enabled',     FALSE, 'Enable Digital Passport NFT minting on Polygon'),
  ('ipfs_storage_enabled',            FALSE, 'Enable IPFS metadata storage via Pinata'),
  ('blockchain_transfer_enabled',     FALSE, 'Enable passport transfer on product resale'),

  -- ── AR / SPATIAL FLAGS ───────────────────────────────────────────────────
  ('ar_viewer_enabled',               TRUE,  'Enable 3D AR product viewer (GLB/USDZ)'),
  ('visionos_spatial_commerce',       FALSE, 'Enable visionOS 3 Spatial Commerce API'),
  ('ar_physics_enabled',              FALSE, 'Enable visionOS 3 USD physics (liquid simulation)'),
  ('ar_share_play_enabled',           FALSE, 'Enable visionOS 3 SharePlay spatial sessions'),

  -- ── MANUFACTURING / BESPOKE FLAGS ────────────────────────────────────────
  ('bespoke_mode_enabled',            FALSE, 'Enable Bespoke Manufacturing module (Phase 2)'),
  ('formula_studio_enabled',          FALSE, 'Enable Bespoke Formula Studio UI'),
  ('raw_material_tracking_enabled',   FALSE, 'Enable raw material inventory tracking'),
  ('batch_production_enabled',        FALSE, 'Enable batch provenance tracking'),

  -- ── WHOLESALE FLAGS ──────────────────────────────────────────────────────
  ('wholesale_enabled',               FALSE, 'Enable B2B wholesale customer module'),
  ('wholesale_pricing_enabled',       FALSE, 'Enable tiered wholesale pricing'),
  ('credit_terms_enabled',            FALSE, 'Enable credit term / net payment for wholesale'),

  -- ── DELIVERY & LOGISTICS FLAGS ───────────────────────────────────────────
  ('white_glove_delivery_enabled',    TRUE,  'Enable white-glove delivery module'),
  ('chauffeur_dispatch_enabled',      FALSE, 'Enable chauffeur dispatch for VIP delivery'),
  ('same_day_delivery_enabled',       TRUE,  'Enable same-day delivery option'),

  -- ── FINANCE FLAGS ────────────────────────────────────────────────────────
  ('double_entry_accounting_enabled', TRUE,  'Enable double-entry journal accounting'),
  ('vatca_integration_enabled',       FALSE, 'Enable VATCA/ZATCA e-invoicing compliance'),
  ('commission_tracking_enabled',     TRUE,  'Enable staff commission calculation'),
  ('financial_reports_enabled',       TRUE,  'Enable financial reporting in dashboard'),

  -- ── SYSTEM FLAGS ─────────────────────────────────────────────────────────
  ('diffuser_iot_enabled',            FALSE, 'Enable smart diffuser IoT webhook integration'),
  ('analytics_clickhouse_enabled',    FALSE, 'Enable ClickHouse analytics pipeline'),
  ('maintenance_mode',                FALSE, 'Put system in read-only maintenance mode')

) AS f(flag_key, value_boolean, description)
WHERE o.slug = 'luxe-pos-main'
ON CONFLICT (organization_id, flag_key) DO UPDATE SET
  value_boolean = EXCLUDED.value_boolean,
  description   = EXCLUDED.description,
  updated_at    = now();

-- Global flags (not org-scoped)
INSERT INTO feature_flags (organization_id, flag_key, flag_type, value_boolean, is_global, description)
VALUES
  (NULL, 'platform_maintenance', 'boolean', FALSE, TRUE, 'Platform-wide maintenance mode'),
  (NULL, 'new_arch_mobile',      'boolean', TRUE,  TRUE, 'React Native New Architecture enabled globally')
ON CONFLICT (organization_id, flag_key) DO NOTHING;

-- Verify count
SELECT COUNT(*) AS total_flags FROM feature_flags;
