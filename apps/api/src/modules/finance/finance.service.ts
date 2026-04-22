// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — FinanceService (BUG-003 FIXED)
// All SQL uses single-quoted strings — postgres.js compatible
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

export interface TaxFreeClaimDto {
  transactionId: string;
  customerId: string;
  nationality: string;
  flightDate: string;
  airportCode: string;
  orgId: string;
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
  ) {}

  async journalSale(transactionId: string, orgId: string): Promise<void> {
    const [tx] = await this.sql<{
      id: string; total: number; subtotal: number;
      vatAmount: number; discountAmount: number; receiptNumber: number;
    }[]>`
      SELECT id, total, subtotal, vat_amount, discount_amount, receipt_number
      FROM transactions
      WHERE id = ${transactionId} AND organization_id = ${orgId}
      LIMIT 1
    `;
    if (!tx) return;

    const accounts = await this.sql<{ code: string; id: string }[]>`
      SELECT code, id FROM accounts
      WHERE organization_id = ${orgId}
        AND code IN ('1030', '4000', '2100')
    `;
    const acct = Object.fromEntries(accounts.map(a => [a.code, a.id]));

    if (!acct['1030'] || !acct['4000'] || !acct['2100']) {
      this.logger.warn(`Chart of accounts incomplete for org ${orgId}`);
      return;
    }

    await this.sql.begin(async sql => {
      const description = `Sale #${tx.receiptNumber}`;
      const netRevenue = tx.subtotal - tx.discountAmount;

      const [entry] = await sql<{ id: number }[]>`
        INSERT INTO journal_entries
          (organization_id, entry_type, reference_id, reference_type,
           description, total_debit, total_credit, currency)
        VALUES
          (${orgId}, 'sale', ${transactionId}, 'transaction',
           ${description}, ${tx.total}, ${tx.total}, 'AED')
        RETURNING id
      `;
      const entryId = entry!.id;

      await sql`
        INSERT INTO journal_entry_lines
          (journal_entry_id, account_id, debit, credit, description)
        VALUES
          (${entryId}, ${acct['1030']!}, ${tx.total},   0,             'Card/cash receivable'),
          (${entryId}, ${acct['4000']!}, 0,             ${netRevenue}, 'Retail revenue excl. VAT'),
          (${entryId}, ${acct['2100']!}, 0,             ${tx.vatAmount}, 'VAT 5% payable')
      `;
    });
  }

  async createTaxFreeClaim(dto: TaxFreeClaimDto) {
    const [tx] = await this.sql<{ id: string; vatAmount: number }[]>`
      SELECT id, vat_amount FROM transactions
      WHERE id = ${dto.transactionId}
        AND organization_id = ${dto.orgId}
        AND is_tax_free_eligible = TRUE
        AND status = 'completed'
      LIMIT 1
    `;
    if (!tx) throw new NotFoundException('Transaction not eligible for tax-free export');

    const [exists] = await this.sql<{ id: number }[]>`
      SELECT id FROM tax_free_export_claims
      WHERE transaction_id = ${dto.transactionId} LIMIT 1
    `;
    if (exists) throw new BadRequestException('Tax-free claim already exists for this transaction');

    const [claim] = await this.sql<{ id: number }[]>`
      INSERT INTO tax_free_export_claims
        (organization_id, transaction_id, customer_id,
         provider, vat_amount, status,
         nationality, flight_date, airport_code)
      VALUES
        (${dto.orgId}, ${dto.transactionId}, ${dto.customerId},
         'global_blue', ${tx.vatAmount}, 'pending',
         ${dto.nationality}, ${dto.flightDate}, ${dto.airportCode})
      RETURNING id
    `;

    await this.sql`
      UPDATE transactions SET tax_free_claim_id = ${claim!.id}
      WHERE id = ${dto.transactionId}
    `;

    return { claimId: claim!.id, vatAmount: tx.vatAmount, provider: 'global_blue' };
  }

  async listTaxFreeClaims(orgId: string, status?: string) {
    return this.sql`
      SELECT tfc.id, tfc.status, tfc.vat_amount, tfc.nationality,
             tfc.flight_date, tfc.airport_code, tfc.created_at,
             t.receipt_number, t.total AS transaction_total,
             c.display_name AS customer_name
      FROM tax_free_export_claims tfc
      JOIN transactions t ON t.id = tfc.transaction_id
      JOIN customers c    ON c.id = tfc.customer_id
      WHERE tfc.organization_id = ${orgId}
        AND (${status ?? null}::text IS NULL OR tfc.status = ${status ?? null})
      ORDER BY tfc.created_at DESC
      LIMIT 100
    `;
  }

  async getDailyRevenue(orgId: string, locationId?: string, dateStr?: string) {
    const targetDate = dateStr ?? new Date().toISOString().split('T')[0]!;
    const [result] = await this.sql`
      SELECT
        COUNT(t.id)::int                                  AS transaction_count,
        COALESCE(SUM(t.total), 0)                        AS gross_revenue,
        COALESCE(SUM(t.subtotal - t.discount_amount), 0) AS net_revenue,
        COALESCE(SUM(t.vat_amount), 0)                   AS vat_collected,
        COALESCE(SUM(t.discount_amount), 0)              AS total_discounts,
        COALESCE(AVG(t.total), 0)                        AS avg_transaction_value,
        COUNT(DISTINCT t.customer_id)                    AS unique_customers
      FROM transactions t
      WHERE t.organization_id = ${orgId}
        AND t.status = 'completed'
        AND t.completed_at::date = ${targetDate}::date
        AND (${locationId ?? null}::uuid IS NULL
             OR t.location_id = ${locationId ?? null})
    `;
    return result;
  }

  async getRevenueByPeriod(
    orgId: string,
    from: string,
    to: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    const trunc = groupBy === 'month' ? 'month'
      : groupBy === 'week' ? 'week'
      : 'day';

    return this.sql`
      SELECT
        date_trunc(${trunc}, t.completed_at) AS period,
        COUNT(t.id)::int                      AS transactions,
        COALESCE(SUM(t.total), 0)            AS revenue,
        COALESCE(SUM(t.vat_amount), 0)       AS vat_collected,
        COALESCE(AVG(t.total), 0)            AS avg_order_value,
        COUNT(DISTINCT t.customer_id)         AS unique_customers
      FROM transactions t
      WHERE t.organization_id = ${orgId}
        AND t.status = 'completed'
        AND t.completed_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      GROUP BY date_trunc(${trunc}, t.completed_at)
      ORDER BY period ASC
    `;
  }

  async getTopProducts(orgId: string, from: string, to: string, limit = 10) {
    const safeLimit = Math.min(Number(limit), 100);
    return this.sql`
      SELECT
        p.id AS product_id, p.name AS product_name,
        b.name AS brand_name, pv.sku,
        SUM(ti.quantity)::int AS units_sold,
        SUM(ti.line_total)    AS revenue,
        AVG(ti.unit_price)    AS avg_selling_price
      FROM transaction_items ti
      JOIN transactions t      ON t.id  = ti.transaction_id
      JOIN product_variants pv ON pv.id = ti.product_variant_id
      JOIN products p          ON p.id  = pv.product_id
      LEFT JOIN brands b       ON b.id  = p.brand_id
      WHERE t.organization_id = ${orgId}
        AND t.status = 'completed'
        AND ti.item_status = 'active'
        AND t.completed_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      GROUP BY p.id, p.name, b.name, pv.sku
      ORDER BY revenue DESC
      LIMIT ${safeLimit}
    `;
  }

  async getRevenueByCategory(orgId: string, from: string, to: string) {
    return this.sql`
      SELECT
        p.category,
        COUNT(DISTINCT t.id)::int AS transaction_count,
        SUM(ti.quantity)::int     AS units_sold,
        SUM(ti.line_total)        AS revenue
      FROM transaction_items ti
      JOIN transactions t      ON t.id  = ti.transaction_id
      JOIN product_variants pv ON pv.id = ti.product_variant_id
      JOIN products p          ON p.id  = pv.product_id
      WHERE t.organization_id = ${orgId}
        AND t.status = 'completed'
        AND ti.item_status = 'active'
        AND t.completed_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      GROUP BY p.category
      ORDER BY revenue DESC
    `;
  }
}
