-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 007_triggers_functions.sql
-- 38 Functions + 63 Triggers — PostgreSQL 18 (MERGE, JSON_TABLE, NOTIFY)
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════
-- UTILITY FUNCTIONS
-- ══════════════════════════════════════════════════════

-- 1. Generic updated_at trigger
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. Audit log writer
CREATE OR REPLACE FUNCTION fn_write_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_log (
    organization_id, action, resource_type, resource_id, old_data, new_data
  ) VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    TG_TABLE_NAME || '.' || TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ══════════════════════════════════════════════════════
-- APPLY updated_at TRIGGERS (on all tables that need it)
-- ══════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'organizations', 'locations', 'users', 'pos_devices',
    'products', 'product_variants', 'inventory', 'stock_reservations',
    'nfc_bottle_registry', 'customers', 'customer_black_book',
    'transactions', 'payments', 'payment_links', 'gift_cards',
    'feature_flags', 'brands', 'suppliers', 'purchase_orders',
    'digital_passports', 'bespoke_formulas', 'batch_provenance',
    'raw_materials', 'white_glove_deliveries', 'appointments',
    'outreach_queue', 'campaigns', 'wholesale_customers',
    'diffuser_devices', 'user_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_set_updated_at ON %I;
       CREATE TRIGGER trg_%I_set_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();',
      t, t, t, t
    );
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════
-- INVENTORY DEDUCTION TRIGGER (Blueprint Section 3.3)
-- PostgreSQL 18: MERGE + JSON_TABLE + structured NOTIFY
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_inventory_deduct_on_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_current_qty     INTEGER;
  v_location_id     UUID;
  v_crdt_delta_id   UUID := gen_random_uuid();
  v_notify_payload  JSONB;
BEGIN
  -- 1. Advisory lock — prevents race on concurrent checkouts
  PERFORM pg_advisory_xact_lock(hashtext('inv:' || NEW.product_variant_id::text));

  -- 2. Resolve location from transaction header
  SELECT t.location_id INTO v_location_id
  FROM transactions t WHERE t.id = NEW.transaction_id;

  -- 3. Read current quantity
  SELECT quantity_on_hand INTO v_current_qty
  FROM inventory
  WHERE product_variant_id = NEW.product_variant_id
    AND location_id = v_location_id
  FOR UPDATE;

  IF v_current_qty IS NULL THEN
    RAISE EXCEPTION 'LUXE-INV-001: No inventory row for variant % at location %',
      NEW.product_variant_id, v_location_id;
  END IF;

  IF v_current_qty < NEW.quantity THEN
    RAISE EXCEPTION 'LUXE-INV-002: Insufficient stock. Have %, need %',
      v_current_qty, NEW.quantity;
  END IF;

  -- 4. PostgreSQL 18 MERGE — atomic deduct + audit
  MERGE INTO inventory AS tgt
  USING (
    SELECT NEW.product_variant_id AS variant_id,
           v_location_id          AS loc_id,
           NEW.quantity           AS qty_sold
  ) AS src
  ON tgt.product_variant_id = src.variant_id
     AND tgt.location_id = src.loc_id
  WHEN MATCHED THEN
    UPDATE SET
      quantity_on_hand = tgt.quantity_on_hand - src.qty_sold,
      updated_at       = now();

  -- 5. Insert inventory adjustment record
  INSERT INTO inventory_adjustments (
    organization_id, product_variant_id, location_id,
    adjusted_by, reason, qty_before, qty_change, qty_after, reference_id
  )
  SELECT
    t.organization_id,
    NEW.product_variant_id,
    v_location_id,
    t.staff_id,
    'received',                                    -- 'received' maps to sold-deduction audit
    v_current_qty,
    -NEW.quantity,
    v_current_qty - NEW.quantity,
    NEW.transaction_id
  FROM transactions t WHERE t.id = NEW.transaction_id;

  -- 6. Write CRDT PN-Counter delta for offline terminal sync
  INSERT INTO crdt_delta_queue (
    id, document_type, document_id, delta_type,
    delta_payload, status, created_at
  ) VALUES (
    v_crdt_delta_id, 'inventory', NEW.product_variant_id, 'pn_counter_decrement',
    jsonb_build_object(
      'variant_id',     NEW.product_variant_id,
      'location_id',    v_location_id,
      'delta',          -NEW.quantity,
      'transaction_id', NEW.transaction_id,
      'vector_clock',   extract(epoch from now())::bigint
    ),
    'crdt_pending', now()
  );

  -- 7. PostgreSQL 18 async NOTIFY — consumed by NestJS WebSocket gateway
  v_notify_payload := jsonb_build_object(
    'event',         'inventory.deducted',
    'variant_id',    NEW.product_variant_id,
    'location_id',   v_location_id,
    'qty_sold',      NEW.quantity,
    'qty_remaining', v_current_qty - NEW.quantity,
    'tx_id',         NEW.transaction_id,
    'ts',            extract(epoch from now())::bigint
  );
  PERFORM pg_notify('luxe_inventory_events', v_notify_payload::text);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_on_transaction_item_insert ON transaction_items;
CREATE TRIGGER trg_inventory_on_transaction_item_insert
  AFTER INSERT ON transaction_items
  FOR EACH ROW
  WHEN (NEW.item_status != 'voided')
  EXECUTE FUNCTION fn_inventory_deduct_on_sale();

COMMENT ON FUNCTION fn_inventory_deduct_on_sale() IS
  'Blueprint Section 3.3 — PostgreSQL 18 MERGE + NOTIFY. Advisory lock prevents checkout race conditions.';

-- ══════════════════════════════════════════════════════
-- INVENTORY RESTORE ON VOID/REFUND
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_inventory_restore_on_void()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_location_id UUID;
  v_notify_payload JSONB;
BEGIN
  IF OLD.item_status = 'voided' OR NEW.item_status NOT IN ('voided', 'refunded') THEN
    RETURN NEW;
  END IF;

  SELECT t.location_id INTO v_location_id
  FROM transactions t WHERE t.id = NEW.transaction_id;

  PERFORM pg_advisory_xact_lock(hashtext('inv:' || NEW.product_variant_id::text));

  MERGE INTO inventory AS tgt
  USING (
    SELECT NEW.product_variant_id AS variant_id,
           v_location_id          AS loc_id,
           NEW.quantity           AS qty_return
  ) AS src
  ON tgt.product_variant_id = src.variant_id AND tgt.location_id = src.loc_id
  WHEN MATCHED THEN
    UPDATE SET
      quantity_on_hand = tgt.quantity_on_hand + src.qty_return,
      updated_at       = now();

  v_notify_payload := jsonb_build_object(
    'event',      'inventory.restored',
    'variant_id', NEW.product_variant_id,
    'location_id', v_location_id,
    'qty_restored', NEW.quantity,
    'ts',         extract(epoch from now())::bigint
  );
  PERFORM pg_notify('luxe_inventory_events', v_notify_payload::text);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_restore_on_void ON transaction_items;
CREATE TRIGGER trg_inventory_restore_on_void
  AFTER UPDATE OF item_status ON transaction_items
  FOR EACH ROW
  WHEN (NEW.item_status IN ('voided', 'refunded') AND OLD.item_status = 'active')
  EXECUTE FUNCTION fn_inventory_restore_on_void();

-- ══════════════════════════════════════════════════════
-- TRANSACTION TOTALS COMPUTATION
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_recompute_transaction_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_totals RECORD;
BEGIN
  SELECT
    COALESCE(SUM(unit_price * quantity - discount_amount), 0) AS subtotal,
    COALESCE(SUM(vat_amount), 0)                              AS vat_total,
    COALESCE(SUM(line_total), 0)                              AS grand_total,
    COALESCE(SUM(unit_price * quantity - discount_amount - vat_amount), 0) AS net
  INTO v_totals
  FROM transaction_items
  WHERE transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id)
    AND item_status = 'active';

  UPDATE transactions SET
    subtotal   = v_totals.subtotal,
    vat_amount = v_totals.vat_total,
    total      = v_totals.grand_total,
    updated_at = now()
  WHERE id = COALESCE(NEW.transaction_id, OLD.transaction_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_transaction_totals_on_item ON transaction_items;
CREATE TRIGGER trg_transaction_totals_on_item
  AFTER INSERT OR UPDATE OR DELETE ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_recompute_transaction_totals();

-- ══════════════════════════════════════════════════════
-- CUSTOMER LIFETIME VALUE UPDATE
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_update_customer_ltv()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.customer_id IS NOT NULL THEN
    UPDATE customers SET
      total_lifetime_value = total_lifetime_value + NEW.total,
      total_purchases      = total_purchases + 1,
      average_order_value  = (total_lifetime_value + NEW.total) / (total_purchases + 1),
      last_visit_at        = now(),
      updated_at           = now()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_ltv_on_transaction ON transactions;
CREATE TRIGGER trg_customer_ltv_on_transaction
  AFTER UPDATE OF status ON transactions
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
  EXECUTE FUNCTION fn_update_customer_ltv();

-- ══════════════════════════════════════════════════════
-- LOYALTY POINTS EARN ON SALE
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_earn_loyalty_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_points_earned INTEGER;
BEGIN
  IF NEW.status = 'completed' AND NEW.customer_id IS NOT NULL THEN
    -- 1 point per AED 10 spent
    v_points_earned := FLOOR(NEW.total / 10)::INTEGER;

    IF v_points_earned > 0 THEN
      INSERT INTO loyalty_transactions (
        organization_id, customer_id, transaction_type,
        points, points_balance, reference_id, reference_type, description
      ) SELECT
        NEW.organization_id,
        NEW.customer_id,
        'earned_purchase',
        v_points_earned,
        c.loyalty_points + v_points_earned,
        NEW.id,
        'transaction',
        'Points earned on sale #' || NEW.receipt_number
      FROM customers c WHERE c.id = NEW.customer_id;

      UPDATE customers SET
        loyalty_points = loyalty_points + v_points_earned,
        updated_at     = now()
      WHERE id = NEW.customer_id;

      UPDATE transactions SET
        loyalty_points_earned = v_points_earned,
        updated_at = now()
      WHERE id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_earn_on_complete ON transactions;
CREATE TRIGGER trg_loyalty_earn_on_complete
  AFTER UPDATE OF status ON transactions
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
  EXECUTE FUNCTION fn_earn_loyalty_points();

-- ══════════════════════════════════════════════════════
-- NFC BOTTLE STATUS UPDATE ON SALE
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_update_nfc_bottle_on_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.nfc_bottle_id IS NOT NULL THEN
    UPDATE nfc_bottle_registry SET
      status      = 'sold',
      sold_at     = now(),
      sold_transaction_id = NEW.transaction_id,
      sold_staff_id = (SELECT staff_id FROM transactions WHERE id = NEW.transaction_id),
      updated_at  = now()
    WHERE bottle_id = NEW.nfc_bottle_id
      AND status = 'in_stock';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfc_bottle_sold ON transaction_items;
CREATE TRIGGER trg_nfc_bottle_sold
  AFTER INSERT ON transaction_items
  FOR EACH ROW
  WHEN (NEW.nfc_bottle_id IS NOT NULL AND NEW.item_status = 'active')
  EXECUTE FUNCTION fn_update_nfc_bottle_on_sale();

-- ══════════════════════════════════════════════════════
-- AUTO-FLAG VARIANTS FOR NFC (>AED 500 threshold)
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_flag_variant_for_nfc()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.retail_price >= 500.00 THEN
    NEW.requires_nfc := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_variant_nfc_flag ON product_variants;
CREATE TRIGGER trg_variant_nfc_flag
  BEFORE INSERT OR UPDATE OF retail_price ON product_variants
  FOR EACH ROW
  EXECUTE FUNCTION fn_flag_variant_for_nfc();

-- ══════════════════════════════════════════════════════
-- AUTO-FLAG PRODUCT FOR NFC (when any variant >500)
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_flag_product_for_nfc()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products SET is_nfc_tagged = TRUE
  WHERE id = NEW.product_id AND NOT is_nfc_tagged;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_nfc_flag ON product_variants;
CREATE TRIGGER trg_product_nfc_flag
  AFTER INSERT OR UPDATE OF requires_nfc ON product_variants
  FOR EACH ROW
  WHEN (NEW.requires_nfc = TRUE)
  EXECUTE FUNCTION fn_flag_product_for_nfc();

-- ══════════════════════════════════════════════════════
-- DIGITAL PASSPORT QUEUE ON SALE
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_queue_passport_mint()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  SELECT customer_id INTO v_customer_id FROM transactions WHERE id = NEW.transaction_id;

  INSERT INTO digital_passports (
    organization_id, transaction_item_id, product_variant_id,
    customer_id, mint_status
  )
  SELECT t.organization_id, NEW.id, NEW.product_variant_id, v_customer_id, 'queued'
  FROM transactions t WHERE t.id = NEW.transaction_id;

  -- Notify NestJS BullMQ queue
  PERFORM pg_notify('luxe_passport_mint', json_build_object(
    'item_id', NEW.id,
    'variant_id', NEW.product_variant_id,
    'customer_id', v_customer_id
  )::text);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_passport_on_sale ON transaction_items;
CREATE TRIGGER trg_queue_passport_on_sale
  AFTER INSERT ON transaction_items
  FOR EACH ROW
  WHEN (NEW.item_status = 'active')
  EXECUTE FUNCTION fn_queue_passport_mint();

-- ══════════════════════════════════════════════════════
-- STAFF NOTIFICATION ON VIP ARRIVAL (preferred_staff_id)
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_notify_preferred_staff_on_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_preferred_staff UUID;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT preferred_staff_id INTO v_preferred_staff
    FROM customers WHERE id = NEW.customer_id;

    IF v_preferred_staff IS NOT NULL AND v_preferred_staff != NEW.staff_id THEN
      PERFORM pg_notify('luxe_vip_arrival', json_build_object(
        'customer_id',    NEW.customer_id,
        'preferred_staff', v_preferred_staff,
        'location_id',    NEW.location_id,
        'tx_id',          NEW.id,
        'ts',             extract(epoch from now())::bigint
      )::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vip_staff_notify ON transactions;
CREATE TRIGGER trg_vip_staff_notify
  AFTER INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_preferred_staff_on_transaction();

-- ══════════════════════════════════════════════════════
-- AI TRAINING EVENT LOG (on every customer interaction)
-- ai_data_collection_active = TRUE by default
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_log_ai_training_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Only log if global ai_data_collection_active flag is ON
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags
    WHERE flag_key = 'ai_data_collection_active'
      AND value_boolean = TRUE
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO ai_training_events (
    organization_id, customer_id, event_type, event_data, created_at
  ) VALUES (
    NEW.organization_id,
    NEW.customer_id,
    'transaction_completed',
    jsonb_build_object(
      'transaction_id', NEW.id,
      'total',          NEW.total,
      'items_count',    (SELECT COUNT(*) FROM transaction_items WHERE transaction_id = NEW.id)
    ),
    now()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_log_on_transaction ON transactions;
CREATE TRIGGER trg_ai_log_on_transaction
  AFTER UPDATE OF status ON transactions
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
  EXECUTE FUNCTION fn_log_ai_training_event();

-- ══════════════════════════════════════════════════════
-- OUTREACH TRIGGER — SCHEDULE ON KEY DATES UPDATE
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_schedule_key_date_outreach()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_date_entry JSONB;
BEGIN
  IF NEW.key_dates IS DISTINCT FROM OLD.key_dates THEN
    -- Use PostgreSQL 18 JSON_TABLE for efficient JSONB array iteration
    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(NEW.key_dates) LOOP
      -- Logic delegated to application layer (NestJS OutreachModule)
      -- This trigger fires a NOTIFY for the scheduler to pick up
      PERFORM pg_notify('luxe_key_dates_updated', json_build_object(
        'customer_id', NEW.customer_id,
        'key_date',    v_date_entry,
        'ts',          extract(epoch from now())::bigint
      )::text);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_key_date_outreach ON customer_black_book;
CREATE TRIGGER trg_key_date_outreach
  AFTER UPDATE OF key_dates ON customer_black_book
  FOR EACH ROW
  EXECUTE FUNCTION fn_schedule_key_date_outreach();

-- ══════════════════════════════════════════════════════
-- FEATURE FLAG — AI ADAPTER NOTIFY
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_notify_feature_flag_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('luxe_feature_flags', json_build_object(
    'flag_key',  NEW.flag_key,
    'new_value', NEW.value_boolean,
    'org_id',    NEW.organization_id
  )::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_flag_notify ON feature_flags;
CREATE TRIGGER trg_feature_flag_notify
  AFTER UPDATE ON feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_feature_flag_change();

-- ══════════════════════════════════════════════════════
-- DEVICE APPROVAL NOTIFY
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_notify_device_approval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_approved = TRUE AND OLD.is_approved = FALSE THEN
    PERFORM pg_notify('luxe_device_approved', json_build_object(
      'device_id',    NEW.id,
      'location_id',  NEW.location_id,
      'approved_by',  NEW.approved_by_id,
      'device_name',  NEW.device_name
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_approval_notify ON pos_devices;
CREATE TRIGGER trg_device_approval_notify
  AFTER UPDATE OF is_approved ON pos_devices
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_device_approval();

-- ══════════════════════════════════════════════════════
-- FUNCTIONS REFERENCED BY pg_cron JOBS
-- ══════════════════════════════════════════════════════

-- fn_trigger_ai_embedding_sync — called by luxe-ai-embed-training-data
CREATE OR REPLACE FUNCTION fn_trigger_ai_embedding_sync()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM pg_notify('luxe_embedding_sync', json_build_object(
    'event', 'embedding_sync_requested',
    'ts',    extract(epoch from now())::bigint
  )::text);
END;
$$;

-- fn_compute_daily_perf_snapshot — called by luxe-daily-perf-snapshot
CREATE OR REPLACE FUNCTION fn_compute_daily_perf_snapshot()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_date DATE := CURRENT_DATE - 1;
BEGIN
  INSERT INTO staff_performance_snapshots (
    organization_id, user_id, location_id, period, period_start, period_end,
    total_sales, transaction_count, avg_transaction, units_sold,
    commission_earned
  )
  SELECT
    t.organization_id,
    t.staff_id,
    t.location_id,
    'daily',
    v_date,
    v_date,
    COALESCE(SUM(t.total), 0),
    COUNT(t.id),
    COALESCE(AVG(t.total), 0),
    COALESCE((SELECT SUM(ti.quantity) FROM transaction_items ti WHERE ti.transaction_id = ANY(ARRAY_AGG(t.id))), 0),
    COALESCE(SUM(t.total) * u.commission_rate, 0)
  FROM transactions t
  JOIN users u ON u.id = t.staff_id
  WHERE t.status = 'completed'
    AND t.completed_at::date = v_date
  GROUP BY t.organization_id, t.staff_id, t.location_id, u.commission_rate
  ON CONFLICT (user_id, period, period_start) DO UPDATE SET
    total_sales       = EXCLUDED.total_sales,
    transaction_count = EXCLUDED.transaction_count,
    avg_transaction   = EXCLUDED.avg_transaction,
    commission_earned = EXCLUDED.commission_earned;
END;
$$;
