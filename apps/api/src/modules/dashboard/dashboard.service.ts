// LUXE POS v5.1 — DashboardService
import { Injectable, Logger, Inject } from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  async getOverview(orgId: string, locationId?: string) {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today!.slice(0, 7) + '-01';

    const [daily] = await this.sql`
      SELECT COUNT(t.id)::int AS transactions_today,
        COALESCE(SUM(t.total), 0) AS revenue_today,
        COALESCE(AVG(t.total), 0) AS avg_order_today,
        COUNT(DISTINCT t.customer_id) AS unique_customers_today
      FROM transactions t
      WHERE t.organization_id = ${orgId} AND t.status = 'completed'
        AND t.completed_at::date = ${today}::date
        AND (${locationId ?? null}::uuid IS NULL OR t.location_id = ${locationId ?? null})`;

    const [monthly] = await this.sql`
      SELECT COUNT(t.id)::int AS transactions_month,
        COALESCE(SUM(t.total), 0) AS revenue_month,
        COUNT(DISTINCT t.customer_id) AS unique_customers_month
      FROM transactions t
      WHERE t.organization_id = ${orgId} AND t.status = 'completed'
        AND t.completed_at >= ${monthStart}::date
        AND (${locationId ?? null}::uuid IS NULL OR t.location_id = ${locationId ?? null})`;

    const [inventory] = await this.sql`
      SELECT COUNT(*)::int AS total_skus,
        COUNT(*) FILTER (WHERE i.quantity_available <= i.reorder_point)::int AS low_stock_count,
        COALESCE(SUM(i.quantity_on_hand * pv.retail_price), 0) AS inventory_value
      FROM inventory i JOIN product_variants pv ON pv.id = i.product_variant_id
      WHERE i.organization_id = ${orgId}
        AND (${locationId ?? null}::uuid IS NULL OR i.location_id = ${locationId ?? null})`;

    return { daily, monthly, inventory };
  }

  async getStaffPerformance(orgId: string, period = 'daily', locationId?: string) {
    const since = period === 'monthly' ? "DATE_TRUNC('month', CURRENT_DATE)"
                : period === 'weekly'  ? "DATE_TRUNC('week', CURRENT_DATE)"
                : 'CURRENT_DATE';
    return this.sql`
      SELECT u.id, u.display_name, u.role,
        COALESCE(SUM(t.total), 0) AS total_sales,
        COUNT(t.id)::int AS transaction_count,
        COALESCE(AVG(t.total), 0) AS avg_transaction,
        COALESCE(SUM(t.total) * u.commission_rate, 0) AS commission_earned
      FROM users u
      LEFT JOIN transactions t ON t.staff_id = u.id AND t.status = 'completed'
        AND t.completed_at >= CURRENT_DATE
      WHERE u.organization_id = ${orgId} AND u.is_active = TRUE AND u.is_deleted = FALSE
        AND u.role IN ('super_admin','admin','manager','senior_sales','sales','cashier')
        AND (${locationId ?? null}::uuid IS NULL OR u.location_id = ${locationId ?? null})
      GROUP BY u.id, u.display_name, u.role, u.commission_rate
      ORDER BY total_sales DESC`;
  }

  async getCustomerInsights(orgId: string) {
    const [stats] = await this.sql`
      SELECT COUNT(*)::int AS total_customers,
        COUNT(*) FILTER (WHERE tier = 'ultra')::int AS ultra_vip,
        COUNT(*) FILTER (WHERE tier = 'platinum')::int AS platinum,
        COUNT(*) FILTER (WHERE is_vip = TRUE)::int AS vip_count,
        COUNT(*) FILTER (WHERE biometric_enrolled = TRUE)::int AS biometric_enrolled,
        COALESCE(AVG(total_lifetime_value), 0) AS avg_ltv,
        COUNT(*) FILTER (WHERE last_visit_at > now() - INTERVAL '30 days')::int AS active_30d
      FROM customers WHERE organization_id = ${orgId} AND is_deleted = FALSE`;

    const topCustomers = await this.sql`
      SELECT id, display_name, tier, total_lifetime_value, total_purchases, loyalty_points, last_visit_at
      FROM customers WHERE organization_id = ${orgId} AND is_deleted = FALSE
      ORDER BY total_lifetime_value DESC LIMIT 10`;

    return { stats, topCustomers };
  }

  async getLocationActivity(orgId: string) {
    return this.sql`
      SELECT l.id, l.name,
        COUNT(t.id) FILTER (WHERE t.status IN ('draft','pending'))::int AS open_transactions,
        COALESCE(SUM(t.total) FILTER (WHERE t.completed_at::date = CURRENT_DATE), 0) AS revenue_today,
        COUNT(DISTINCT t.staff_id) FILTER (WHERE t.created_at > now() - INTERVAL '2 hours')::int AS active_staff
      FROM locations l
      LEFT JOIN transactions t ON t.location_id = l.id AND t.organization_id = ${orgId}
      WHERE l.organization_id = ${orgId} AND l.is_active = TRUE AND l.type = 'boutique'
      GROUP BY l.id, l.name ORDER BY revenue_today DESC`;
  }
}
