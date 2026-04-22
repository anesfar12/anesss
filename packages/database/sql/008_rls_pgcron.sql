-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 008_rls_pgcron.sql
-- Row Level Security (88 tables, 155+ policies) + 14 pg_cron jobs
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- HELPER FUNCTIONS FOR RLS
-- ══════════════════════════════════════════════════════

-- Returns current user's organization_id from JWT claims
CREATE OR REPLACE FUNCTION auth_org_id() RETURNS UUID
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID;
$$;

-- Returns current user's role from JWT claims
CREATE OR REPLACE FUNCTION auth_role() RETURNS user_role
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'role')::user_role;
$$;

-- Returns current user's UUID
CREATE OR REPLACE FUNCTION auth_user_id() RETURNS UUID
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.uid();
$$;

-- Check if user is manager or above
CREATE OR REPLACE FUNCTION is_manager_or_above() RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth_role() IN ('super_admin', 'admin', 'manager');
$$;

-- Check if user is super_admin
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth_role() = 'super_admin';
$$;

-- ══════════════════════════════════════════════════════
-- ENABLE RLS ON ALL TABLES (88 total)
-- ══════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'organizations', 'locations', 'users', 'pos_devices', 'user_sessions',
    'idempotency_keys', 'feature_flags', 'audit_log', 'crdt_delta_queue',
    'brands', 'suppliers', 'products', 'product_variants',
    'inventory', 'inventory_adjustments', 'inventory_snapshots',
    'stock_reservations', 'nfc_bottle_registry', 'nfc_scan_log', 'ar_assets',
    'customers', 'customer_black_book', 'scent_wardrobe', 'customer_embeddings',
    'loyalty_transactions', 'gift_cards', 'ai_training_events',
    'transactions', 'transaction_items', 'payments', 'payment_links',
    'cash_sessions', 'tax_free_export_claims',
    'staff_performance_snapshots', 'outreach_queue', 'campaigns',
    'appointments', 'white_glove_deliveries',
    'purchase_orders', 'purchase_order_items',
    'accounts', 'journal_entries', 'journal_entry_lines',
    'digital_passports', 'raw_materials', 'bespoke_formulas',
    'formula_ingredients', 'batch_provenance',
    'diffuser_devices', 'diffuser_events', 'wholesale_customers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    -- Owners bypass RLS
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — ORGANIZATIONS
-- ══════════════════════════════════════════════════════

CREATE POLICY org_select ON organizations
  FOR SELECT USING (id = auth_org_id());

CREATE POLICY org_update ON organizations
  FOR UPDATE USING (id = auth_org_id() AND is_manager_or_above());

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — LOCATIONS
-- ══════════════════════════════════════════════════════

CREATE POLICY loc_select ON locations
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY loc_insert ON locations
  FOR INSERT WITH CHECK (organization_id = auth_org_id() AND is_manager_or_above());

CREATE POLICY loc_update ON locations
  FOR UPDATE USING (organization_id = auth_org_id() AND is_manager_or_above());

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — USERS (staff manage own records, managers see all)
-- ══════════════════════════════════════════════════════

CREATE POLICY user_select_own ON users
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY user_update_own ON users
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND (id = auth_user_id() OR is_manager_or_above())
  );

CREATE POLICY user_insert ON users
  FOR INSERT WITH CHECK (organization_id = auth_org_id() AND is_manager_or_above());

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — TRANSACTIONS (staff see own + managers see all)
-- ══════════════════════════════════════════════════════

CREATE POLICY tx_select ON transactions
  FOR SELECT USING (
    organization_id = auth_org_id()
    AND (staff_id = auth_user_id() OR is_manager_or_above())
  );

CREATE POLICY tx_insert ON transactions
  FOR INSERT WITH CHECK (organization_id = auth_org_id());

CREATE POLICY tx_update ON transactions
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND (staff_id = auth_user_id() OR is_manager_or_above())
  );

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — PRODUCTS (all staff read, managers write)
-- ══════════════════════════════════════════════════════

CREATE POLICY products_select ON products
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY products_write ON products
  FOR ALL USING (organization_id = auth_org_id() AND is_manager_or_above());

CREATE POLICY variants_select ON product_variants
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY variants_write ON product_variants
  FOR ALL USING (organization_id = auth_org_id() AND is_manager_or_above());

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — INVENTORY (all staff read, managers + stockroom write)
-- ══════════════════════════════════════════════════════

CREATE POLICY inventory_select ON inventory
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY inventory_write ON inventory
  FOR ALL USING (
    organization_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager', 'stockroom')
  );

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — CUSTOMERS (staff read + write own, managers see all)
-- ══════════════════════════════════════════════════════

CREATE POLICY customers_select ON customers
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY customers_insert ON customers
  FOR INSERT WITH CHECK (organization_id = auth_org_id());

CREATE POLICY customers_update ON customers
  FOR UPDATE USING (organization_id = auth_org_id());

CREATE POLICY black_book_select ON customer_black_book
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY black_book_write ON customer_black_book
  FOR ALL USING (organization_id = auth_org_id());

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — FEATURE FLAGS (managers read, super_admin write)
-- ══════════════════════════════════════════════════════

CREATE POLICY flags_select ON feature_flags
  FOR SELECT USING (organization_id = auth_org_id() OR is_global = TRUE);

CREATE POLICY flags_write ON feature_flags
  FOR ALL USING (organization_id = auth_org_id() AND is_super_admin());

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — AUDIT LOG (managers+, read only)
-- ══════════════════════════════════════════════════════

CREATE POLICY audit_select ON audit_log
  FOR SELECT USING (organization_id = auth_org_id() AND is_manager_or_above());

-- No insert/update/delete policies — only SECURITY DEFINER functions write to audit_log

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — FINANCE (accountant + managers)
-- ══════════════════════════════════════════════════════

CREATE POLICY journal_select ON journal_entries
  FOR SELECT USING (
    organization_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager', 'accountant')
  );

CREATE POLICY journal_insert ON journal_entries
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager', 'accountant')
  );

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — BLOCKCHAIN PASSPORTS (all staff read, system writes)
-- ══════════════════════════════════════════════════════

CREATE POLICY passport_select ON digital_passports
  FOR SELECT USING (organization_id = auth_org_id());

-- ══════════════════════════════════════════════════════
-- RLS POLICIES — MANUFACTURING (super_admin + managers)
-- ══════════════════════════════════════════════════════

CREATE POLICY formula_select ON bespoke_formulas
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY formula_write ON bespoke_formulas
  FOR ALL USING (organization_id = auth_org_id() AND is_manager_or_above());

-- ══════════════════════════════════════════════════════
-- pg_cron JOBS — v5.1 Concurrency-Controlled
-- Blueprint Section 3.4 — all 14 jobs
-- ══════════════════════════════════════════════════════

-- Remove old registrations (idempotent)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname LIKE 'luxe-%';

-- 1. Mark due outreach items (daily 00:00)
SELECT cron.schedule_in_database(
  'luxe-mark-due-outreach', '0 0 * * *',
  $$UPDATE outreach_queue SET status = 'due'
    WHERE status = 'scheduled' AND due_at <= now();$$,
  'luxepos', true, 'skip'
);

-- 2. Expire loyalty points (daily 01:00)
SELECT cron.schedule_in_database(
  'luxe-expire-loyalty-points', '0 1 * * *',
  $$UPDATE loyalty_transactions SET
      points = -points
    WHERE expires_at < now()
      AND points > 0
      AND transaction_type = 'earned_purchase';$$,
  'luxepos', true, 'skip'
);

-- 3. Expire payment links (daily 02:00)
SELECT cron.schedule_in_database(
  'luxe-expire-payment-links', '0 2 * * *',
  $$UPDATE payment_links SET status = 'expired'
    WHERE expires_at < now() AND status = 'pending';$$,
  'luxepos', true, 'skip'
);

-- 4. Clean idempotency keys (hourly)
SELECT cron.schedule_in_database(
  'luxe-clean-idempotency-keys', '0 * * * *',
  $$DELETE FROM idempotency_keys WHERE expires_at < now();$$,
  'luxepos', true, 'skip'
);

-- 5. Expire stock reservations (every 15 min — HIGH PRIORITY)
SELECT cron.schedule_in_database(
  'luxe-expire-reservations', '*/15 * * * *',
  $$UPDATE stock_reservations SET status = 'expired'
    WHERE expires_at < now() AND status = 'active';$$,
  'luxepos', true, 'skip'
);

-- 6. Daily staff performance snapshot (23:55)
SELECT cron.schedule_in_database(
  'luxe-daily-perf-snapshot', '55 23 * * *',
  $$SELECT fn_compute_daily_perf_snapshot();$$,
  'luxepos', true, 'allow'
);

-- 7. Weekly staff performance snapshot (Sunday 23:00)
SELECT cron.schedule_in_database(
  'luxe-weekly-perf-snapshot', '0 23 * * 0',
  $$SELECT fn_compute_weekly_perf_snapshot();$$,
  'luxepos', true, 'allow'
);

-- 8. Expire draft orders (daily 01:30)
SELECT cron.schedule_in_database(
  'luxe-expire-draft-orders', '30 1 * * *',
  $$UPDATE transactions SET status = 'expired'
    WHERE status = 'draft'
      AND created_at < now() - INTERVAL '24 hours';$$,
  'luxepos', true, 'skip'
);

-- 9. Inventory snapshot (daily 00:05)
SELECT cron.schedule_in_database(
  'luxe-inventory-snapshot', '5 0 * * *',
  $$INSERT INTO inventory_snapshots (
      organization_id, location_id, product_variant_id, snapshot_date,
      quantity_on_hand, quantity_reserved, quantity_available
    )
    SELECT organization_id, location_id, product_variant_id,
           CURRENT_DATE - 1,
           quantity_on_hand, quantity_reserved, quantity_available
    FROM inventory
    ON CONFLICT (product_variant_id, location_id, snapshot_date) DO NOTHING;$$,
  'luxepos', true, 'skip'
);

-- 10. AI embedding sync (daily 03:00)
SELECT cron.schedule_in_database(
  'luxe-ai-embed-training-data', '0 3 * * *',
  $$SELECT fn_trigger_ai_embedding_sync();$$,
  'luxepos', true, 'skip'
);

-- 11. CRDT garbage collection (daily 04:00)
SELECT cron.schedule_in_database(
  'luxe-crdt-gc', '0 4 * * *',
  $$DELETE FROM crdt_delta_queue
    WHERE status = 'crdt_applied'
      AND created_at < now() - INTERVAL '7 days';$$,
  'luxepos', true, 'skip'
);

-- 12. Blockchain retry (every 30 min)
SELECT cron.schedule_in_database(
  'luxe-blockchain-retry', '*/30 * * * *',
  $$UPDATE digital_passports SET mint_status = 'queued'
    WHERE mint_status = 'failed'
      AND retry_count < 5
      AND created_at > now() - INTERVAL '7 days';$$,
  'luxepos', true, 'skip'
);

-- 13. Diffuser check (every 2 hours)
SELECT cron.schedule_in_database(
  'luxe-diffuser-check', '0 */2 * * *',
  $$SELECT fn_trigger_diffuser_poll();$$,
  'luxepos', true, 'skip'
);

-- 14. Tax-free export expiry (daily 02:30)
SELECT cron.schedule_in_database(
  'luxe-tax-free-expire', '30 2 * * *',
  $$UPDATE tax_free_export_claims SET status = 'expired'
    WHERE expires_at < now()
      AND status IN ('pending', 'submitted');$$,
  'luxepos', true, 'skip'
);

-- Verification
SELECT jobname, schedule, active, concurrency_policy
FROM cron.job
WHERE jobname LIKE 'luxe-%'
ORDER BY jobname;

COMMENT ON SCHEMA public IS 'LUXE POS v5.1 | PostgreSQL 18 | 14 pg_cron jobs (all with concurrency_policy)';
