-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 010_seed_core_data.sql
-- Seed: Organization, Locations, Users (demo), Chart of Accounts
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- ORGANIZATION (primary boutique group)
-- ══════════════════════════════════════════════════════

INSERT INTO organizations (
  id, name, name_ar, slug, country_code, currency, timezone, locale,
  vat_number, subscription_plan, settings
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'LUXE Parfums',
  'لوكس للعطور',
  'luxe-pos-main',
  'AE',
  'AED',
  'Asia/Dubai',
  'en-AE',
  'TRN100123456789',
  'enterprise',
  '{
    "receipt_footer": "Thank you for choosing LUXE Parfums",
    "receipt_footer_ar": "شكراً لاختيارك لوكس للعطور",
    "loyalty_points_per_aed": 0.1,
    "loyalty_points_value": 0.01,
    "default_vat_rate": 0.05,
    "nfc_price_threshold": 500,
    "receipt_logo": true,
    "arabic_receipt": true
  }'::JSONB
) ON CONFLICT (slug) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- LOCATIONS
-- ══════════════════════════════════════════════════════

INSERT INTO locations (id, organization_id, name, name_ar, type, city, emirate, country_code, phone, pos_terminal_count, has_diffuser, operating_hours) VALUES
(
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Dubai Mall Boutique',
  'بوتيك دبي مول',
  'boutique',
  'Dubai',
  'Dubai',
  'AE',
  '+97144234567',
  3,
  TRUE,
  '{"sun":{"open":"10:00","close":"23:00"},"mon":{"open":"10:00","close":"23:00"},"tue":{"open":"10:00","close":"23:00"},"wed":{"open":"10:00","close":"23:00"},"thu":{"open":"10:00","close":"23:00"},"fri":{"open":"10:00","close":"00:00"},"sat":{"open":"10:00","close":"00:00"}}'::JSONB
),
(
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  'Abu Dhabi Mall Boutique',
  'بوتيك أبوظبي مول',
  'boutique',
  'Abu Dhabi',
  'Abu Dhabi',
  'AE',
  '+97126789012',
  2,
  TRUE,
  '{"sun":{"open":"10:00","close":"22:00"},"mon":{"open":"10:00","close":"22:00"},"tue":{"open":"10:00","close":"22:00"},"wed":{"open":"10:00","close":"22:00"},"thu":{"open":"10:00","close":"22:00"},"fri":{"open":"14:00","close":"22:00"},"sat":{"open":"10:00","close":"22:00"}}'::JSONB
),
(
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000001',
  'Main Warehouse',
  'المستودع الرئيسي',
  'warehouse',
  'Dubai',
  'Dubai',
  'AE',
  '+97144999888',
  0,
  FALSE,
  '{}'::JSONB
)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════
-- SEED BRANDS
-- ══════════════════════════════════════════════════════

INSERT INTO brands (organization_id, name, name_ar, slug, country_of_origin, description) VALUES
('00000000-0000-0000-0000-000000000001', 'Amouage', 'عماقة', 'amouage', 'OM', 'Luxury Omani fragrance house — founded 1983'),
('00000000-0000-0000-0000-000000000001', 'Creed', 'كريد', 'creed', 'FR', 'Anglo-French perfume house — founded 1760'),
('00000000-0000-0000-0000-000000000001', 'Tom Ford', 'توم فورد', 'tom-ford', 'US', 'American luxury fashion and fragrance'),
('00000000-0000-0000-0000-000000000001', 'Roja Parfums', 'روجا بارفام', 'roja-parfums', 'GB', 'British ultra-luxury perfumery'),
('00000000-0000-0000-0000-000000000001', 'Maison Francis Kurkdjian', 'ميزون فرانسيس كوركدجيان', 'mfk', 'FR', 'Parisian luxury perfume house'),
('00000000-0000-0000-0000-000000000001', 'LUXE Bespoke', 'لوكس حسب الطلب', 'luxe-bespoke', 'AE', 'In-house bespoke manufacturing — UAE origin')
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- CHART OF ACCOUNTS (GCC luxury retail standard)
-- ══════════════════════════════════════════════════════

INSERT INTO accounts (organization_id, code, name, account_type) VALUES
-- Assets
('00000000-0000-0000-0000-000000000001', '1000', 'Cash and Cash Equivalents', 'asset'),
('00000000-0000-0000-0000-000000000001', '1010', 'POS Cash Float', 'asset'),
('00000000-0000-0000-0000-000000000001', '1020', 'Bank — UAE Current Account', 'asset'),
('00000000-0000-0000-0000-000000000001', '1030', 'Card Payment Receivable', 'asset'),
('00000000-0000-0000-0000-000000000001', '1040', 'Gift Card Liability Offset', 'asset'),
('00000000-0000-0000-0000-000000000001', '1100', 'Accounts Receivable — Wholesale', 'asset'),
('00000000-0000-0000-0000-000000000001', '1200', 'Inventory — Finished Goods', 'asset'),
('00000000-0000-0000-0000-000000000001', '1210', 'Inventory — Raw Materials', 'asset'),
('00000000-0000-0000-0000-000000000001', '1300', 'Prepaid Expenses', 'asset'),
-- Liabilities
('00000000-0000-0000-0000-000000000001', '2000', 'Accounts Payable — Suppliers', 'liability'),
('00000000-0000-0000-0000-000000000001', '2100', 'VAT Payable (5%)', 'liability'),
('00000000-0000-0000-0000-000000000001', '2110', 'VAT Input (Recoverable)', 'liability'),
('00000000-0000-0000-0000-000000000001', '2200', 'Gift Card Liability', 'liability'),
('00000000-0000-0000-0000-000000000001', '2210', 'Loyalty Points Liability', 'liability'),
('00000000-0000-0000-0000-000000000001', '2300', 'Staff Commission Payable', 'liability'),
('00000000-0000-0000-0000-000000000001', '2400', 'Deferred Revenue — Layaway', 'liability'),
-- Equity
('00000000-0000-0000-0000-000000000001', '3000', 'Owner Equity', 'equity'),
('00000000-0000-0000-0000-000000000001', '3100', 'Retained Earnings', 'equity'),
-- Revenue
('00000000-0000-0000-0000-000000000001', '4000', 'Retail Sales Revenue', 'revenue'),
('00000000-0000-0000-0000-000000000001', '4010', 'Wholesale Revenue', 'revenue'),
('00000000-0000-0000-0000-000000000001', '4020', 'Bespoke / Custom Revenue', 'revenue'),
('00000000-0000-0000-0000-000000000001', '4030', 'Engraving & Personalisation Revenue', 'revenue'),
('00000000-0000-0000-0000-000000000001', '4040', 'Gift Card Revenue (Breakage)', 'revenue'),
('00000000-0000-0000-0000-000000000001', '4050', 'Online Sales Revenue', 'revenue'),
('00000000-0000-0000-0000-000000000001', '4100', 'Sales Returns & Allowances', 'revenue'),
-- COGS
('00000000-0000-0000-0000-000000000001', '5000', 'Cost of Goods Sold', 'cogs'),
('00000000-0000-0000-0000-000000000001', '5010', 'Raw Material COGS — Bespoke', 'cogs'),
('00000000-0000-0000-0000-000000000001', '5020', 'Packaging & Bottling COGS', 'cogs'),
('00000000-0000-0000-0000-000000000001', '5030', 'NFC Chip COGS', 'cogs'),
-- Expenses
('00000000-0000-0000-0000-000000000001', '6000', 'Staff Salaries', 'expense'),
('00000000-0000-0000-0000-000000000001', '6010', 'Staff Commissions', 'expense'),
('00000000-0000-0000-0000-000000000001', '6020', 'Rent & Occupancy', 'expense'),
('00000000-0000-0000-0000-000000000001', '6030', 'Technology & SaaS', 'expense'),
('00000000-0000-0000-0000-000000000001', '6040', 'Marketing & Campaigns', 'expense'),
('00000000-0000-0000-0000-000000000001', '6050', 'White-Glove Delivery', 'expense'),
('00000000-0000-0000-0000-000000000001', '6060', 'Blockchain Minting Gas', 'expense'),
('00000000-0000-0000-0000-000000000001', '6070', 'AI Infrastructure', 'expense'),
('00000000-0000-0000-0000-000000000001', '6080', 'Loyalty Points Redeemed', 'expense'),
('00000000-0000-0000-0000-000000000001', '6090', 'Depreciation', 'expense')
ON CONFLICT (organization_id, code) DO NOTHING;
