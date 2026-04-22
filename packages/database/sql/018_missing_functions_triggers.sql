-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 018_missing_functions_triggers.sql
-- Missing Functions (15) + Missing Triggers (19)
-- Reaches blueprint targets: 38 functions, 63 triggers
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- MISSING FUNCTIONS (15 needed to reach 38 total)
-- ═══════════════════════════════════════════════════════════

-- 1. fn_compute_weekly_perf_snapshot (called by pg_cron luxe-weekly-perf-snapshot)

CREATE OR REPLACE FUNCTION fn_compute_weekly_perf_snapshot()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_week_start DATE := DATE_TRUNC('week', CURRENT_DATE - INTERVAL '1 day')::DATE;
  v_week_end   DATE := v_week_start + 6;
BEGIN
  INSERT INTO staff_performance_snapshots (
    organization_id, user_id, location_id, period,
    period_start, period_end,
    total_sales, transaction_count, avg_transaction,
    units_sold, commission_earned
  )
  SELECT
    t.organization_id,
    t.staff_id,
    t.location_id,
    'weekly',
    v_week_start,
    v_week_end,
    COALESCE(SUM(t.total), 0),
    COUNT(t.id),
    COALESCE(AVG(t.total), 0),
    COALESCE(SUM(ti_agg.units), 0),
    COALESCE(SUM(t.total) * u.commission_rate, 0)
  FROM transactions t
  JOIN users u ON u.id = t.staff_id
  LEFT JOIN LATERAL (
    SELECT SUM(ti.quantity) AS units
    FROM transaction_items ti
    WHERE ti.transaction_id = t.id AND ti.item_status = 'active'
  ) ti_agg ON TRUE
  WHERE t.status = 'completed'
    AND t.completed_at::date BETWEEN v_week_start AND v_week_end
  GROUP BY t.organization_id, t.staff_id, t.location_id, u.commission_rate
  ON CONFLICT (user_id, period, period_start)
  DO UPDATE SET
    total_sales       = EXCLUDED.total_sales,
    transaction_count = EXCLUDED.transaction_count,
    avg_transaction   = EXCLUDED.avg_transaction,
    units_sold        = EXCLUDED.units_sold,
    commission_earned = EXCLUDED.commission_earned;
END;
$$;

COMMENT ON FUNCTION fn_compute_weekly_perf_snapshot IS 'Called by pg_cron luxe-weekly-perf-snapshot (Sundays 23:00)';

-- 2. fn_trigger_diffuser_poll (called by pg_cron luxe-diffuser-check)

CREATE OR REPLACE FUNCTION fn_trigger_diffuser_poll()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Emit NOTIFY for each active diffuser — NestJS picks up and polls IoT API
  PERFORM pg_notify('luxe_diffuser_poll', json_build_object(
    'event', 'diffuser_poll_requested',
    'count', (SELECT COUNT(*) FROM diffuser_devices WHERE is_online = TRUE),
    'ts',    extract(epoch from now())::bigint
  )::text);
END;
$$;

COMMENT ON FUNCTION fn_trigger_diffuser_poll IS 'Called by pg_cron luxe-diffuser-check every 2 hours';

-- 3. fn_update_customer_tier (auto-upgrade tier on LTV milestones)

CREATE OR REPLACE FUNCTION fn_update_customer_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_new_tier  customer_tier;
  v_old_tier  customer_tier;
  v_ltv       DECIMAL;
BEGIN
  v_old_tier := NEW.tier;
  v_ltv      := NEW.total_lifetime_value;

  -- Tier thresholds (AED LTV)
  v_new_tier := CASE
    WHEN v_ltv >= 500000  THEN 'ultra'
    WHEN v_ltv >= 100000  THEN 'platinum'
    WHEN v_ltv >= 30000   THEN 'gold'
    WHEN v_ltv >= 5000    THEN 'silver'
    ELSE 'standard'
  END;

  -- Only upgrade, never auto-downgrade (downgrade is manual)
  IF v_new_tier::text > v_old_tier::text THEN
    NEW.tier := v_new_tier;

    -- Log tier change
    INSERT INTO customer_tier_history (
      customer_id, organization_id,
      previous_tier, new_tier,
      reason, ltv_at_change
    ) VALUES (
      NEW.id, NEW.organization_id,
      v_old_tier, v_new_tier,
      'ltv_milestone', v_ltv
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_tier_upgrade ON customers;
CREATE TRIGGER trg_customer_tier_upgrade
  BEFORE UPDATE OF total_lifetime_value ON customers
  FOR EACH ROW
  WHEN (NEW.total_lifetime_value > OLD.total_lifetime_value)
  EXECUTE FUNCTION fn_update_customer_tier();

-- 4. fn_validate_loyalty_redemption (check balance before redeem)

CREATE OR REPLACE FUNCTION fn_validate_loyalty_redemption()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF NEW.transaction_type = 'redeemed_discount' AND NEW.points < 0 THEN
    SELECT loyalty_points INTO v_balance
    FROM customers WHERE id = NEW.customer_id;

    IF v_balance + NEW.points < 0 THEN
      RAISE EXCEPTION 'LUXE-LOYALTY-001: Insufficient loyalty points. Balance: %, Requested: %',
        v_balance, ABS(NEW.points);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_validate_redemption ON loyalty_transactions;
CREATE TRIGGER trg_loyalty_validate_redemption
  BEFORE INSERT ON loyalty_transactions
  FOR EACH ROW
  WHEN (NEW.transaction_type = 'redeemed_discount')
  EXECUTE FUNCTION fn_validate_loyalty_redemption();

-- 5. fn_gift_card_balance_check (prevent overdraft)

CREATE OR REPLACE FUNCTION fn_gift_card_balance_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.transaction_type = 'redeem' AND NEW.amount > 0 THEN
    IF (NEW.balance_before - NEW.amount) < 0 THEN
      RAISE EXCEPTION 'LUXE-GIFTCARD-001: Insufficient gift card balance. Balance: %, Requested: %',
        NEW.balance_before, NEW.amount;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gift_card_balance_check ON gift_card_transactions;
CREATE TRIGGER trg_gift_card_balance_check
  BEFORE INSERT ON gift_card_transactions
  FOR EACH ROW
  WHEN (NEW.transaction_type = 'redeem')
  EXECUTE FUNCTION fn_gift_card_balance_check();

-- 6. fn_compute_transaction_commission (auto-calc staff commission on sale complete)

CREATE OR REPLACE FUNCTION fn_compute_transaction_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_commission_rate DECIMAL;
  v_commission      DECIMAL;
BEGIN
  SELECT commission_rate INTO v_commission_rate
  FROM users WHERE id = NEW.staff_id;

  IF v_commission_rate IS NOT NULL AND v_commission_rate > 0 THEN
    v_commission := ROUND(NEW.total * v_commission_rate, 2);

    -- Log to staff_performance_snapshots for current day
    INSERT INTO staff_commissions (
      organization_id, user_id, location_id, period,
      period_start, period_end,
      total_sales, commission_rate, commission_gross, commission_net, status
    ) VALUES (
      NEW.organization_id, NEW.staff_id, NEW.location_id, 'monthly',
      DATE_TRUNC('month', CURRENT_DATE)::DATE,
      (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE,
      NEW.total, v_commission_rate, v_commission, v_commission, 'pending'
    )
    ON CONFLICT (user_id, period, period_start) DO UPDATE SET
      total_sales      = staff_commissions.total_sales + NEW.total,
      commission_gross = staff_commissions.commission_gross + v_commission,
      commission_net   = staff_commissions.commission_net + v_commission;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_on_sale ON transactions;
CREATE TRIGGER trg_commission_on_sale
  AFTER UPDATE OF status ON transactions
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
  EXECUTE FUNCTION fn_compute_transaction_commission();

-- 7. fn_nfc_fraud_alert (NOTIFY on fraud detected)

CREATE OR REPLACE FUNCTION fn_nfc_fraud_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.fraud_flagged = TRUE AND OLD.fraud_flagged = FALSE THEN
    PERFORM pg_notify('luxe_nfc_fraud', json_build_object(
      'event',       'nfc.fraud_detected',
      'bottle_id',   NEW.bottle_id,
      'variant_id',  NEW.product_variant_id,
      'ts',          extract(epoch from now())::bigint
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfc_fraud_alert ON nfc_bottle_registry;
CREATE TRIGGER trg_nfc_fraud_alert
  AFTER UPDATE OF fraud_flagged ON nfc_bottle_registry
  FOR EACH ROW
  WHEN (NEW.fraud_flagged = TRUE)
  EXECUTE FUNCTION fn_nfc_fraud_alert();

-- 8. fn_validate_payment_total (ensure payments sum = transaction total on complete)

CREATE OR REPLACE FUNCTION fn_validate_payment_total()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paid_total DECIMAL;
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM payments
    WHERE transaction_id = NEW.id AND status = 'captured';

    IF ABS(v_paid_total - NEW.total) > 0.01 THEN
      RAISE EXCEPTION 'LUXE-PAY-001: Payment total %.2f does not match transaction total %.2f',
        v_paid_total, NEW.total;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_completion ON transactions;
CREATE TRIGGER trg_validate_payment_completion
  BEFORE UPDATE OF status ON transactions
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
  EXECUTE FUNCTION fn_validate_payment_total();

-- 9. fn_stock_count_finalize (apply count results to inventory)

CREATE OR REPLACE FUNCTION fn_stock_count_finalize()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    -- Apply each counted variance to inventory
    FOR v_item IN
      SELECT sci.product_variant_id, sci.counted_quantity, sci.system_quantity
      FROM stock_count_items sci
      WHERE sci.session_id = NEW.id
        AND sci.counted_quantity IS NOT NULL
        AND sci.counted_quantity != sci.system_quantity
    LOOP
      PERFORM pg_advisory_xact_lock(hashtext('inv:' || v_item.product_variant_id::text));

      UPDATE inventory SET
        quantity_on_hand = v_item.counted_quantity,
        last_count_at    = now(),
        last_count_by    = NEW.completed_by,
        updated_at       = now()
      WHERE product_variant_id = v_item.product_variant_id
        AND location_id = NEW.location_id;

      -- Audit trail
      INSERT INTO inventory_adjustments (
        organization_id, product_variant_id, location_id,
        adjusted_by, reason, qty_before, qty_change, qty_after, reference_id
      ) VALUES (
        NEW.organization_id, v_item.product_variant_id, NEW.location_id,
        NEW.completed_by, 'correction',
        v_item.system_quantity,
        v_item.counted_quantity - v_item.system_quantity,
        v_item.counted_quantity,
        NEW.id
      );
    END LOOP;

    -- Update session summary
    UPDATE stock_count_sessions SET
      items_counted = (SELECT COUNT(*) FROM stock_count_items WHERE session_id = NEW.id AND counted_quantity IS NOT NULL),
      items_variance = (SELECT COUNT(*) FROM stock_count_items WHERE session_id = NEW.id AND variance != 0)
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_count_finalize ON stock_count_sessions;
CREATE TRIGGER trg_stock_count_finalize
  AFTER UPDATE OF status ON stock_count_sessions
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status = 'in_progress')
  EXECUTE FUNCTION fn_stock_count_finalize();

-- 10. fn_delivery_status_notify (NOTIFY on delivery status change)

CREATE OR REPLACE FUNCTION fn_delivery_status_notify()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    -- Log delivery event
    INSERT INTO delivery_events (delivery_id, event_type, description, occurred_at)
    VALUES (NEW.id, NEW.status, 'Status changed to ' || NEW.status, now());

    -- Notify WebSocket gateway
    PERFORM pg_notify('luxe_delivery_events', json_build_object(
      'delivery_id',   NEW.id,
      'transaction_id', NEW.transaction_id,
      'customer_id',   NEW.customer_id,
      'new_status',    NEW.status,
      'ts',            extract(epoch from now())::bigint
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_status_notify ON white_glove_deliveries;
CREATE TRIGGER trg_delivery_status_notify
  AFTER UPDATE OF status ON white_glove_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION fn_delivery_status_notify();

-- 11. fn_session_cleanup_on_user_delete (revoke sessions when user is soft-deleted)

CREATE OR REPLACE FUNCTION fn_session_cleanup_on_user_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE THEN
    UPDATE user_sessions SET is_revoked = TRUE
    WHERE user_id = NEW.id AND is_revoked = FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_revoke_on_delete ON users;
CREATE TRIGGER trg_session_revoke_on_delete
  AFTER UPDATE OF is_deleted ON users
  FOR EACH ROW
  WHEN (NEW.is_deleted = TRUE)
  EXECUTE FUNCTION fn_session_cleanup_on_user_delete();

-- 12. fn_product_view_log (log to product_views analytics on transaction item insert)

CREATE OR REPLACE FUNCTION fn_ai_log_product_view()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_customer_id UUID;
BEGIN
  SELECT organization_id, customer_id INTO v_org_id, v_customer_id
  FROM transactions WHERE id = NEW.transaction_id;

  INSERT INTO product_views (organization_id, product_id, customer_id, source)
  VALUES (v_org_id, NEW.product_id, v_customer_id, 'pos');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_view_log ON transaction_items;
CREATE TRIGGER trg_product_view_log
  AFTER INSERT ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_ai_log_product_view();

-- 13. fn_refresh_product_embedding (flag product for re-embedding on update)

CREATE OR REPLACE FUNCTION fn_refresh_product_embedding()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Clear embedding so daily pg_cron job re-embeds it
  IF NEW.name != OLD.name OR NEW.description IS DISTINCT FROM OLD.description THEN
    NEW.embedding_vector := NULL;
    NEW.ai_enriched_at   := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_updated_embedding ON products;
CREATE TRIGGER trg_product_updated_embedding
  BEFORE UPDATE OF name, description ON products
  FOR EACH ROW
  EXECUTE FUNCTION fn_refresh_product_embedding();

-- 14. fn_blockchain_auto_retry (re-queue failed mints)

CREATE OR REPLACE FUNCTION fn_blockchain_auto_retry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.mint_status = 'failed' AND OLD.mint_status != 'failed' THEN
    -- Insert into blockchain_jobs for tracking
    INSERT INTO blockchain_jobs (
      organization_id, passport_id, job_type, status, payload
    ) VALUES (
      NEW.organization_id, NEW.id, 'mint_passport', 'queued',
      json_build_object('transaction_item_id', NEW.transaction_item_id)::jsonb
    );

    -- Notify BullMQ worker
    PERFORM pg_notify('luxe_blockchain_retry', json_build_object(
      'passport_id', NEW.id,
      'retry_count', NEW.retry_count,
      'ts',          extract(epoch from now())::bigint
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blockchain_retry_on_failure ON digital_passports;
CREATE TRIGGER trg_blockchain_retry_on_failure
  AFTER UPDATE OF mint_status ON digital_passports
  FOR EACH ROW
  WHEN (NEW.mint_status = 'failed' AND NEW.retry_count < 5)
  EXECUTE FUNCTION fn_blockchain_auto_retry();

-- 15. fn_wholesale_credit_check (enforce credit limit on B2B orders)

CREATE OR REPLACE FUNCTION fn_wholesale_credit_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_credit_limit    DECIMAL;
  v_outstanding     DECIMAL;
BEGIN
  IF NEW.status IN ('submitted', 'confirmed') THEN
    SELECT wc.credit_limit INTO v_credit_limit
    FROM wholesale_customers wc
    WHERE wc.id = NEW.wholesale_customer_id;

    IF v_credit_limit IS NOT NULL AND v_credit_limit > 0 THEN
      SELECT COALESCE(SUM(wo.balance_due), 0) INTO v_outstanding
      FROM wholesale_orders wo
      WHERE wo.wholesale_customer_id = NEW.wholesale_customer_id
        AND wo.status NOT IN ('cancelled', 'paid')
        AND wo.id != NEW.id;

      IF v_outstanding + NEW.total > v_credit_limit THEN
        RAISE EXCEPTION 'LUXE-CREDIT-001: Order total %.2f would exceed credit limit %.2f (outstanding: %.2f)',
          NEW.total, v_credit_limit, v_outstanding;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wholesale_credit_check ON wholesale_orders;
CREATE TRIGGER trg_wholesale_credit_check
  BEFORE INSERT OR UPDATE OF status, total ON wholesale_orders
  FOR EACH ROW
  WHEN (NEW.status IN ('submitted', 'confirmed'))
  EXECUTE FUNCTION fn_wholesale_credit_check();

-- ── Additional missing triggers ───────────────────────────────────────────

-- trg_loyalty_balance_update: sync customers.loyalty_points after any loyalty_transaction
CREATE OR REPLACE FUNCTION fn_sync_loyalty_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE customers
  SET loyalty_points = loyalty_points + NEW.points,
      updated_at     = now()
  WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_balance_update ON loyalty_transactions;
CREATE TRIGGER trg_loyalty_balance_update
  AFTER INSERT ON loyalty_transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_loyalty_balance();

-- trg_invoice_totals: auto-compute invoice totals from items
CREATE OR REPLACE FUNCTION fn_recompute_invoice_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_totals RECORD;
BEGIN
  SELECT
    COALESCE(SUM(ii.quantity * ii.unit_price - ii.discount_amount), 0) AS subtotal,
    COALESCE(SUM(ii.vat_amount), 0)                                     AS vat,
    COALESCE(SUM(ii.line_total), 0)                                      AS total
  INTO v_totals
  FROM invoice_items ii
  WHERE ii.invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  UPDATE invoices SET
    subtotal   = v_totals.subtotal,
    vat_amount = v_totals.vat,
    total      = v_totals.total,
    updated_at = now()
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_totals ON invoice_items;
CREATE TRIGGER trg_invoice_totals
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_recompute_invoice_totals();

-- trg_wholesale_order_totals: auto-compute from items
CREATE OR REPLACE FUNCTION fn_recompute_wholesale_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE wholesale_orders SET
    subtotal = (
      SELECT COALESCE(SUM(woi.line_total), 0)
      FROM wholesale_order_items woi
      WHERE woi.wholesale_order_id = COALESCE(NEW.wholesale_order_id, OLD.wholesale_order_id)
    ),
    updated_at = now()
  WHERE id = COALESCE(NEW.wholesale_order_id, OLD.wholesale_order_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_wholesale_totals ON wholesale_order_items;
CREATE TRIGGER trg_wholesale_totals
  AFTER INSERT OR UPDATE OR DELETE ON wholesale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_recompute_wholesale_totals();

-- trg_crdt_gc_mark_applied: mark crdt_delta_queue entries applied via advisory lock
CREATE OR REPLACE FUNCTION fn_crdt_mark_applied()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- When inventory is updated, mark matching pending CRDT deltas as applied
  UPDATE crdt_delta_queue
  SET status     = 'crdt_applied',
      applied_at = now()
  WHERE document_type = 'inventory'
    AND document_id   = NEW.product_variant_id::text::uuid
    AND status        = 'crdt_pending';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crdt_gc_mark_applied ON inventory;
CREATE TRIGGER trg_crdt_gc_mark_applied
  AFTER UPDATE OF quantity_on_hand ON inventory
  FOR EACH ROW
  EXECUTE FUNCTION fn_crdt_mark_applied();

-- ── Add updated_at triggers for new tables ────────────────────────────────

DO $$
DECLARE
  t TEXT;
  new_tables TEXT[] := ARRAY[
    'invoices', 'credit_notes', 'staff_commissions', 'staff_schedules',
    'staff_targets', 'transfer_orders', 'price_lists',
    'product_bundles', 'customer_addresses', 'customer_notes',
    'wishlists', 'bespoke_orders', 'bespoke_order_items',
    'email_templates', 'sms_templates', 'webhooks',
    'wholesale_orders', 'wholesale_contracts',
    'nfc_chip_keys', 'packaging_materials', 'expenses',
    'notification_preferences', 'media_files', 'api_keys'
  ];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
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
