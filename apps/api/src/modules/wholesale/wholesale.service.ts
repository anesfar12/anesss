// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — WholesaleService
// B2B orders, pricing tiers, credit management, contracts
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, Logger, Inject, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

@Injectable()
export class WholesaleService {
  private readonly logger = new Logger(WholesaleService.name);
  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  async listWholesaleCustomers(orgId: string) {
    return this.sql`
      SELECT wc.*, c.display_name, c.email, c.phone,
             u.display_name AS account_manager_name
      FROM wholesale_customers wc
      JOIN customers c ON c.id = wc.customer_id
      LEFT JOIN users u ON u.id = wc.account_manager_id
      WHERE wc.organization_id = ${orgId}
      ORDER BY c.display_name
    `;
  }

  async listOrders(orgId: string, filters: {
    customerId?: string; status?: string; limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.sql`
      SELECT wo.id, wo.status, wo.total, wo.currency,
             wo.payment_terms, wo.due_date, wo.created_at,
             c.display_name AS customer_name,
             u.display_name AS account_manager
      FROM wholesale_orders wo
      JOIN wholesale_customers wc ON wc.id = wo.wholesale_customer_id
      JOIN customers c ON c.id = wc.customer_id
      LEFT JOIN users u ON u.id = wo.account_manager_id
      WHERE wo.organization_id = ${orgId}
        AND (${filters.customerId ?? null}::uuid IS NULL OR wc.customer_id = ${filters.customerId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR wo.status = ${filters.status ?? null})
      ORDER BY wo.created_at DESC
      LIMIT ${limit}
    `;
  }

  async getOrder(orderId: number, orgId: string) {
    const [order] = await this.sql`
      SELECT wo.*,
             c.display_name AS customer_name,
             json_agg(json_build_object(
               'variantId', woi.product_variant_id,
               'quantity', woi.quantity,
               'unitPrice', woi.unit_price,
               'lineTotal', woi.line_total
             )) FILTER (WHERE woi.id IS NOT NULL) AS items
      FROM wholesale_orders wo
      JOIN wholesale_customers wc ON wc.id = wo.wholesale_customer_id
      JOIN customers c ON c.id = wc.customer_id
      LEFT JOIN wholesale_order_items woi ON woi.wholesale_order_id = wo.id
      WHERE wo.id = ${orderId} AND wo.organization_id = ${orgId}
      GROUP BY wo.id, c.display_name
    `;
    if (!order) throw new NotFoundException('Wholesale order not found');
    return order;
  }

  async createOrder(dto: Record<string, unknown>, orgId: string, staffId: string) {
    const items = dto['items'] as Array<{ productVariantId: string; quantity: number; unitPrice: number }>;
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const vatAmount = subtotal * 0.05;
    const total = subtotal + vatAmount;

    const [order] = await this.sql<{ id: number }[]>`
      INSERT INTO wholesale_orders (
        organization_id, wholesale_customer_id, account_manager_id,
        status, currency, subtotal, vat_amount, total,
        payment_terms, purchase_order_ref, notes
      ) VALUES (
        ${orgId}, ${dto['wholesaleCustomerId'] as string}, ${staffId},
        'draft', 'AED', ${subtotal}, ${vatAmount}, ${total},
        ${dto['paymentTerms'] as number ?? 30},
        ${dto['purchaseOrderRef'] as string ?? null},
        ${dto['notes'] as string ?? null}
      )
      RETURNING id
    `;

    for (const item of items) {
      await this.sql`
        INSERT INTO wholesale_order_items (wholesale_order_id, product_variant_id, quantity, unit_price, line_total)
        VALUES (${order!.id}, ${item.productVariantId}, ${item.quantity}, ${item.unitPrice}, ${item.quantity * item.unitPrice})
      `;
    }

    return { orderId: order!.id, subtotal, vatAmount, total };
  }

  async approveOrder(orderId: number, orgId: string, managerId: string) {
    await this.sql`
      UPDATE wholesale_orders SET status = 'confirmed', approved_by = ${managerId},
             approved_at = now(), updated_at = now()
      WHERE id = ${orderId} AND organization_id = ${orgId} AND status = 'submitted'
    `;
    return { approved: true };
  }

  async listPriceTiers(orgId: string) {
    return this.sql`
      SELECT * FROM wholesale_price_tiers WHERE organization_id = ${orgId} ORDER BY min_order_value
    `;
  }
}
