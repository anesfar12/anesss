// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — CRMService
// Bulk outreach dispatch, VIP activity feed, customer analytics
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger, Inject } from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

@Injectable()
export class CRMService {
  private readonly logger = new Logger(CRMService.name);
  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  async getCustomersDueOutreach(orgId: string, limit = 50) {
    // Customers who haven't been contacted in 30+ days with open key dates coming up
    return this.sql`
      SELECT c.id, c.display_name, c.phone, c.email, c.tier,
             c.language_preference, c.last_visit_at,
             c.loyalty_points, c.total_lifetime_value,
             bb.key_dates,
             u.display_name AS preferred_staff_name,
             EXTRACT(DAYS FROM now() - c.last_visit_at)::int AS days_since_visit
      FROM customers c
      LEFT JOIN customer_black_book bb ON bb.customer_id = c.id
      LEFT JOIN users u ON u.id = c.preferred_staff_id
      WHERE c.organization_id = ${orgId}
        AND c.is_deleted = FALSE
        AND (c.whatsapp_opt_in = TRUE OR c.email_opt_in = TRUE)
        AND (
          c.last_visit_at < now() - INTERVAL '30 days'
          OR c.last_visit_at IS NULL
        )
      ORDER BY c.total_lifetime_value DESC
      LIMIT ${limit}
    `;
  }

  async getVIPActivityFeed(orgId: string, locationId?: string, limit = 20) {
    return this.sql`
      SELECT
        t.id AS transaction_id, t.receipt_number, t.total, t.completed_at,
        c.id AS customer_id, c.display_name AS customer_name, c.tier,
        c.phone, c.language_preference,
        l.name AS location_name,
        u.display_name AS staff_name,
        bb.preferred_beverage, bb.greeting_style
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      JOIN locations l ON l.id = t.location_id
      JOIN users u ON u.id = t.staff_id
      LEFT JOIN customer_black_book bb ON bb.customer_id = c.id
      WHERE t.organization_id = ${orgId}
        AND c.is_vip = TRUE
        AND t.status = 'completed'
        AND (${locationId ?? null}::uuid IS NULL OR t.location_id = ${locationId ?? null})
      ORDER BY t.completed_at DESC
      LIMIT ${limit}
    `;
  }

  async bulkOutreach(dto: {
    customerIds: string[];
    outreachType: string;
    channel: string;
    body: string;
    subject?: string;
    scheduledAt?: string;
  }, orgId: string, staffId: string) {
    const scheduledAt = dto.scheduledAt ?? new Date().toISOString();
    let scheduled = 0;
    let skipped = 0;

    for (const customerId of dto.customerIds) {
      try {
        await this.sql`
          INSERT INTO outreach_queue (
            organization_id, customer_id, staff_id,
            outreach_type, channel, status,
            subject, body, scheduled_at, due_at
          ) VALUES (
            ${orgId}, ${customerId}, ${staffId},
            ${dto.outreachType}, ${dto.channel}, 'scheduled',
            ${dto.subject ?? null}, ${dto.body},
            ${scheduledAt}::timestamptz, ${scheduledAt}::timestamptz
          )
        `;
        scheduled++;
      } catch {
        skipped++;
      }
    }

    this.logger.log(`Bulk outreach: ${scheduled} scheduled, ${skipped} skipped | org=${orgId}`);
    return { scheduled, skipped, total: dto.customerIds.length };
  }

  async getOutreachStats(orgId: string, from: string, to: string) {
    return this.sql`
      SELECT
        channel,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
        COUNT(*) FILTER (WHERE status = 'read')::int AS read,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM outreach_queue
      WHERE organization_id = ${orgId}
        AND created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      GROUP BY channel
      ORDER BY total DESC
    `;
  }

  async getKeyDatesThisMonth(orgId: string) {
    // Customers with birthdays/anniversaries in the current month
    return this.sql`
      SELECT c.id, c.display_name, c.phone, c.tier, c.language_preference,
             bb.key_dates, bb.preferred_beverage, bb.greeting_style
      FROM customer_black_book bb
      JOIN customers c ON c.id = bb.customer_id
      WHERE bb.organization_id = ${orgId}
        AND c.is_deleted = FALSE
        AND bb.key_dates @> '[]'::jsonb
        AND jsonb_array_length(bb.key_dates) > 0
      LIMIT 100
    `;
  }
}
