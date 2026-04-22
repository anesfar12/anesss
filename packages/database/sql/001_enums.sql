-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- PostgreSQL 18 | GCC Luxury Edition 2026
-- File: 001_enums.sql — All 43 ENUMs
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";          -- pgvector HNSW
CREATE EXTENSION IF NOT EXISTS "pg_trgm";         -- trigram search for products
CREATE EXTENSION IF NOT EXISTS "btree_gin";       -- GIN on btree types
CREATE EXTENSION IF NOT EXISTS "pg_cron";         -- scheduled jobs

-- ── ENUMs (43 total) ───────────────────────────────────────────────────────

-- 1. User & Staff
CREATE TYPE user_role AS ENUM (
  'super_admin', 'admin', 'manager', 'senior_sales', 'sales',
  'stockroom', 'cashier', 'accountant', 'readonly'
);

-- 2. Auth
CREATE TYPE auth_method AS ENUM (
  'password', 'pin', 'biometric_face', 'biometric_palm', 'magic_link', 'sso'
);

CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'none');

-- 3. Transaction
CREATE TYPE transaction_status AS ENUM (
  'draft', 'pending', 'processing', 'completed', 'voided',
  'refunded', 'partially_refunded', 'disputed', 'expired'
);

CREATE TYPE transaction_type AS ENUM (
  'sale', 'refund', 'exchange', 'void', 'layaway',
  'wholesale', 'bespoke_order', 'gift_card_sale', 'gift_card_redeem'
);

CREATE TYPE transaction_channel AS ENUM (
  'in_store', 'online', 'phone', 'whatsapp', 'appointment',
  'white_glove', 'wholesale', 'mobile_pos'
);

-- 4. Payment
CREATE TYPE payment_status AS ENUM (
  'pending', 'authorized', 'captured', 'failed', 'refunded',
  'partially_refunded', 'voided', 'expired', 'disputed'
);

CREATE TYPE payment_method_type AS ENUM (
  'cash', 'card_tap', 'card_insert', 'card_online',
  'softpos', 'gift_card', 'loyalty_points', 'bank_transfer',
  'payment_link', 'cryptocurrency', 'split'
);

CREATE TYPE currency_code AS ENUM (
  'AED', 'SAR', 'KWD', 'QAR', 'BHD', 'OMR',
  'USD', 'EUR', 'GBP', 'JPY', 'CNY'
);

-- 5. Product & Inventory
CREATE TYPE inventory_mode AS ENUM ('brand', 'bespoke');

CREATE TYPE product_status AS ENUM (
  'active', 'draft', 'archived', 'discontinued', 'coming_soon'
);

CREATE TYPE product_category AS ENUM (
  'eau_de_parfum', 'eau_de_toilette', 'parfum', 'eau_de_cologne',
  'solid_perfume', 'hair_perfume', 'body_mist', 'oud', 'attar',
  'diffuser', 'candle', 'accessories', 'gift_set', 'bespoke'
);

CREATE TYPE fragrance_family AS ENUM (
  'floral', 'oriental', 'woody', 'fresh', 'fougere', 'chypre',
  'gourmand', 'aquatic', 'spicy', 'green', 'leather', 'musk',
  'oud', 'rose', 'amber', 'citrus', 'powdery', 'animalic'
);

CREATE TYPE inventory_adjustment_reason AS ENUM (
  'received', 'returned', 'damaged', 'expired', 'theft', 'correction',
  'transfer_in', 'transfer_out', 'sample', 'tester', 'display'
);

CREATE TYPE stock_reservation_status AS ENUM (
  'active', 'confirmed', 'expired', 'cancelled', 'converted'
);

-- 6. NFC & Authentication
CREATE TYPE nfc_validation_status AS ENUM (
  'valid', 'invalid_signature', 'replay_attack', 'unknown_chip',
  'counterfeit_detected', 'expired_counter', 'not_required'
);

CREATE TYPE biometric_type AS ENUM (
  'face_id', 'palm_amazon_one', 'fingerprint', 'iris', 'none'
);

-- 7. Customer
CREATE TYPE customer_tier AS ENUM (
  'standard', 'silver', 'gold', 'platinum', 'ultra', 'bespoke_member'
);

CREATE TYPE gender AS ENUM ('male', 'female', 'non_binary', 'prefer_not_to_say');

CREATE TYPE skin_type AS ENUM ('dry', 'oily', 'combination', 'normal', 'sensitive');

CREATE TYPE greeting_style AS ENUM ('formal', 'semi_formal', 'casual', 'arabic_formal');

CREATE TYPE language_preference AS ENUM (
  'en', 'ar', 'fr', 'zh', 'ru', 'hi', 'ur', 'fa', 'tr'
);

-- 8. Loyalty
CREATE TYPE loyalty_transaction_type AS ENUM (
  'earned_purchase', 'earned_referral', 'earned_birthday', 'earned_review',
  'redeemed_discount', 'redeemed_product', 'expired', 'bonus', 'adjustment'
);

CREATE TYPE gift_card_status AS ENUM (
  'active', 'exhausted', 'expired', 'voided', 'pending_activation'
);

-- 9. Delivery & Logistics
CREATE TYPE delivery_method AS ENUM (
  'in_store_pickup', 'same_day', 'next_day', 'scheduled',
  'chauffeur', 'yacht', 'private_jet', 'hotel_concierge',
  'courier', 'international_shipping', 'digital'
);

CREATE TYPE delivery_status AS ENUM (
  'pending', 'preparing', 'ready', 'dispatched', 'delivered',
  'failed', 'returned', 'cancelled'
);

CREATE TYPE white_glove_sla AS ENUM (
  '1_hour', '2_hours', '4_hours', 'same_day', 'next_day', 'scheduled'
);

-- 10. Outreach & Marketing
CREATE TYPE outreach_type AS ENUM (
  'birthday_wish', 'anniversary', 'eid_greeting', 'new_arrival',
  'restock_alert', 'vip_event', 'seasonal', 'bespoke_ready',
  'replenishment', 'loyalty_expiry', 'payment_link', 'custom'
);

CREATE TYPE outreach_channel AS ENUM (
  'sms', 'whatsapp', 'email', 'push_notification', 'call', 'handwritten_note'
);

CREATE TYPE outreach_status AS ENUM (
  'scheduled', 'due', 'sent', 'delivered', 'read', 'failed', 'cancelled'
);

CREATE TYPE campaign_status AS ENUM (
  'draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'
);

-- 11. Appointments
CREATE TYPE appointment_status AS ENUM (
  'requested', 'confirmed', 'in_progress', 'completed', 'no_show', 'cancelled'
);

CREATE TYPE appointment_type AS ENUM (
  'scent_consultation', 'bespoke_session', 'vip_preview',
  'gift_selection', 'skin_analysis', 'wardrobe_review'
);

-- 12. Wholesale & B2B
CREATE TYPE wholesale_customer_type AS ENUM (
  'hotel', 'spa', 'airline', 'corporate', 'retailer', 'distributor', 'government'
);

CREATE TYPE purchase_order_status AS ENUM (
  'draft', 'submitted', 'confirmed', 'in_transit', 'partially_received',
  'received', 'invoiced', 'paid', 'disputed', 'cancelled'
);

-- 13. Finance & Accounting
CREATE TYPE journal_entry_type AS ENUM (
  'sale', 'refund', 'purchase', 'payroll', 'overhead',
  'depreciation', 'tax', 'adjustment', 'opening_balance'
);

CREATE TYPE account_type AS ENUM (
  'asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'
);

CREATE TYPE tax_type AS ENUM ('vat', 'customs', 'excise', 'municipal', 'none');

CREATE TYPE invoice_status AS ENUM (
  'draft', 'sent', 'viewed', 'paid', 'overdue', 'disputed', 'cancelled'
);

-- 14. Blockchain & Digital Passport
CREATE TYPE passport_mint_status AS ENUM (
  'pending', 'queued', 'minting', 'minted', 'failed', 'transfer_pending', 'transferred'
);

CREATE TYPE blockchain_network AS ENUM ('polygon', 'ethereum', 'solana', 'none');

-- 15. Manufacturing & Bespoke
CREATE TYPE batch_status AS ENUM (
  'planned', 'mixing', 'maturing', 'quality_check', 'bottling', 'ready', 'rejected'
);

CREATE TYPE formula_status AS ENUM (
  'concept', 'testing', 'approved', 'production', 'retired'
);

-- 16. System
CREATE TYPE feature_flag_type AS ENUM ('boolean', 'percentage', 'json', 'string');

CREATE TYPE crdt_delta_type AS ENUM (
  'pn_counter_increment', 'pn_counter_decrement',
  'or_set_add', 'or_set_remove', 'lww_register_set'
);

CREATE TYPE crdt_delta_status AS ENUM (
  'crdt_pending', 'crdt_applied', 'crdt_conflicted', 'crdt_gc_ready'
);

-- 17. Spatial & AR
CREATE TYPE ar_asset_type AS ENUM ('glb', 'usdz', 'usdz_physics', 'thumbnail', 'video_360');

-- 18. Diffuser IoT
CREATE TYPE diffuser_alert_type AS ENUM (
  'low_cartridge', 'empty', 'offline', 'malfunction', 'scheduled_change'
);

COMMENT ON TYPE user_role IS 'LUXE POS staff roles — maps to RLS policies';
COMMENT ON TYPE inventory_mode IS 'brand=3rd-party brands, bespoke=in-house manufacturing';
COMMENT ON TYPE crdt_delta_type IS 'CRDT operation types for offline-first sync';
