// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — DeliveryService
// White-glove delivery workflow: dispatch, tracking, proof of delivery
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, Logger, Inject, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  async listDeliveries(orgId: string, filters: {
    status?: string; locationId?: string; staffId?: string; limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.sql`
      SELECT wgd.id, wgd.method, wgd.sla, wgd.status,
             wgd.destination_type, wgd.hotel_name, wgd.requested_at,
             wgd.promised_at, wgd.dispatched_at, wgd.delivered_at,
             wgd.recipient_name, wgd.recipient_phone, wgd.tracking_code,
             t.receipt_number, t.total AS order_total,
             c.display_name AS customer_name, c.phone AS customer_phone,
             u.display_name AS assigned_staff
      FROM white_glove_deliveries wgd
      JOIN transactions t ON t.id = wgd.transaction_id
      JOIN customers c ON c.id = wgd.customer_id
      LEFT JOIN users u ON u.id = wgd.staff_id
      WHERE wgd.organization_id = ${orgId}
        AND (${filters.status ?? null}::text IS NULL OR wgd.status = ${filters.status ?? null})
        AND (${filters.staffId ?? null}::uuid IS NULL OR wgd.staff_id = ${filters.staffId ?? null})
      ORDER BY wgd.requested_at DESC
      LIMIT ${limit}
    `;
  }

  async getDelivery(deliveryId: number, orgId: string) {
    const [d] = await this.sql`
      SELECT wgd.*, t.receipt_number, c.display_name AS customer_name,
             u.display_name AS staff_name
      FROM white_glove_deliveries wgd
      JOIN transactions t ON t.id = wgd.transaction_id
      JOIN customers c ON c.id = wgd.customer_id
      LEFT JOIN users u ON u.id = wgd.staff_id
      WHERE wgd.id = ${deliveryId} AND wgd.organization_id = ${orgId}
    `;
    if (!d) throw new NotFoundException('Delivery not found');
    return d;
  }

  async createDelivery(dto: Record<string, unknown>, orgId: string, staffId: string) {
    const trackingCode = 'LUXE-DLV-' + Date.now().toString(36).toUpperCase();
    const [d] = await this.sql<{ id: number }[]>`
      INSERT INTO white_glove_deliveries (
        organization_id, transaction_id, customer_id, staff_id,
        method, sla, status,
        destination_type, hotel_name, room_number, delivery_address,
        recipient_name, recipient_phone, tracking_code,
        special_instructions, gift_message, packaging_notes,
        requested_at, promised_at
      ) VALUES (
        ${orgId}, ${dto['transactionId'] as string}, ${dto['customerId'] as string}, ${staffId},
        ${dto['method'] as string ?? 'same_day'},
        ${dto['sla'] as string ?? 'same_day'},
        'pending',
        ${dto['destinationType'] as string ?? null}, ${dto['hotelName'] as string ?? null},
        ${dto['roomNumber'] as string ?? null},
        ${dto['deliveryAddress'] ? JSON.stringify(dto['deliveryAddress']) : null}::jsonb,
        ${dto['recipientName'] as string ?? null}, ${dto['recipientPhone'] as string ?? null},
        ${trackingCode},
        ${dto['specialInstructions'] as string ?? null},
        ${dto['giftMessage'] as string ?? null},
        ${dto['packagingNotes'] as string ?? null},
        now(),
        ${dto['promisedAt'] as string ?? null}::timestamptz
      )
      RETURNING id
    `;
    return { deliveryId: d!.id, trackingCode, status: 'pending' };
  }

  async dispatchDelivery(deliveryId: number, dto: Record<string, unknown>, orgId: string) {
    const [d] = await this.sql<{ id: number; status: string }[]>`
      SELECT id, status FROM white_glove_deliveries WHERE id = ${deliveryId} AND organization_id = ${orgId} LIMIT 1
    `;
    if (!d) throw new NotFoundException('Delivery not found');
    if (d.status !== 'pending' && d.status !== 'preparing') {
      throw new BadRequestException('Delivery cannot be dispatched in status: ' + d.status);
    }
    await this.sql`
      UPDATE white_glove_deliveries
      SET status = 'dispatched', dispatched_at = now(),
          courier_name = ${dto['courierName'] as string ?? null},
          courier_phone = ${dto['courierPhone'] as string ?? null},
          updated_at = now()
      WHERE id = ${deliveryId}
    `;
    return { dispatched: true };
  }

  async markDelivered(deliveryId: number, dto: Record<string, unknown>, orgId: string) {
    const proofOfDelivery = {
      photoUrl: dto['photoUrl'],
      signature: dto['signature'],
      timestamp: new Date().toISOString(),
      notes: dto['notes'],
    };
    await this.sql`
      UPDATE white_glove_deliveries
      SET status = 'delivered', delivered_at = now(),
          proof_of_delivery = ${JSON.stringify(proofOfDelivery)}::jsonb,
          updated_at = now()
      WHERE id = ${deliveryId} AND organization_id = ${orgId}
    `;
    return { delivered: true, deliveredAt: new Date().toISOString() };
  }

  async getTracking(trackingCode: string, orgId: string) {
    const [d] = await this.sql`
      SELECT wgd.id, wgd.status, wgd.method, wgd.tracking_code,
             wgd.dispatched_at, wgd.delivered_at, wgd.proof_of_delivery,
             c.display_name AS customer_name
      FROM white_glove_deliveries wgd
      JOIN customers c ON c.id = wgd.customer_id
      WHERE wgd.tracking_code = ${trackingCode} AND wgd.organization_id = ${orgId}
    `;
    if (!d) throw new NotFoundException('Tracking code not found');
    return d;
  }
}
