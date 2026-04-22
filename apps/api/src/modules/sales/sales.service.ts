// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — SalesService
// Sub-500ms checkout SLA | Idempotency | NFC | CRDT delta | Loyalty
// Engineering Fix 1: AI fraud detection wraps with timeout, never blocks
// Engineering Fix 4: Blockchain minting always async (BullMQ)
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, Logger, Inject, ConflictException,
  BadRequestException, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';
import { AIAdapterService } from '../ai-adapter/ai-adapter.service';
import { HardwareService } from '../hardware/hardware.service';
import type {
  CreateTransactionDto,
  AddItemDto,
  CompleteTransactionDto,
  VoidTransactionDto,
} from './dto/sales.dto';

export interface CheckoutResult {
  transactionId: string;
  receiptNumber: number;
  status: string;
  total: number;
  loyaltyPointsEarned: number;
  receiptUrl: string;
  checkoutMs: number;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
    @InjectQueue('blockchain') private readonly blockchainQueue: Queue,
    @InjectQueue('receipts') private readonly receiptsQueue: Queue,
    @InjectQueue('outreach') private readonly outreachQueue: Queue,
    private readonly ai: AIAdapterService,
    private readonly hardware: HardwareService,
  ) {}

  // ── 1. Create / Open a Draft Transaction ──────────────────────────────

  async createTransaction(dto: CreateTransactionDto, orgId: string, staffId: string): Promise<{ transactionId: string; receiptNumber: number }> {
    // Idempotency check
    if (dto.idempotencyKey) {
      const [existing] = await this.sql<{ responseBody: Record<string, unknown> }[]>`
        SELECT response_body FROM idempotency_keys
        WHERE key = ${dto.idempotencyKey} AND endpoint = 'transactions.create'
        LIMIT 1
      `;
      if (existing?.responseBody) {
        return existing.responseBody as { transactionId: string; receiptNumber: number };
      }
    }

    const [tx] = await this.sql<{ id: string; receiptNumber: number }[]>`
      INSERT INTO transactions (
        organization_id, location_id, device_id, type, status, channel,
        customer_id, staff_id, currency, delivery_method
      ) VALUES (
        ${orgId},
        ${dto.locationId},
        ${dto.deviceId ?? null},
        ${dto.type ?? 'sale'},
        'draft',
        ${dto.channel ?? 'in_store'},
        ${dto.customerId ?? null},
        ${staffId},
        ${dto.currency ?? 'AED'},
        ${dto.deliveryMethod ?? 'in_store_pickup'}
      )
      RETURNING id, receipt_number
    `;

    const result = { transactionId: tx!.id, receiptNumber: tx!.receiptNumber };

    if (dto.idempotencyKey) {
      await this.sql`
        INSERT INTO idempotency_keys (key, user_id, endpoint, response_status, response_body)
        VALUES (${dto.idempotencyKey}, ${staffId}, 'transactions.create', 201, ${JSON.stringify(result)})
        ON CONFLICT (key) DO NOTHING
      `;
    }

    return result;
  }

  // ── 2. Add Line Item ──────────────────────────────────────────────────

  async addItem(transactionId: string, dto: AddItemDto, orgId: string, staffId: string): Promise<{ itemId: string; nfcValidation?: object }> {
    // Verify transaction is in draft/pending state and belongs to org
    const [tx] = await this.sql<{ id: string; status: string; locationId: string; organizationId: string }[]>`
      SELECT id, status, location_id, organization_id
      FROM transactions
      WHERE id = ${transactionId} AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!tx) throw new NotFoundException('Transaction not found');
    if (!['draft', 'pending'].includes(tx.status)) {
      throw new BadRequestException(`Cannot add items to transaction in status: ${tx.status}`);
    }

    // Get variant details
    const [variant] = await this.sql<{
      id: string; productId: string; retailPrice: number; vatRate: number;
      requiresNfc: boolean; isActive: boolean;
    }[]>`
      SELECT id, product_id, retail_price, vat_rate, requires_nfc, is_active
      FROM product_variants
      WHERE id = ${dto.productVariantId} AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!variant) throw new NotFoundException('Product variant not found');
    if (!variant.isActive) throw new BadRequestException('Product variant is not active');

    // Check stock availability (advisory lock happens in trigger)
    const [stock] = await this.sql<{ quantityAvailable: number }[]>`
      SELECT quantity_available FROM inventory
      WHERE product_variant_id = ${dto.productVariantId}
        AND location_id = ${tx.locationId}
      LIMIT 1
    `;

    if (!stock || stock.quantityAvailable < dto.quantity) {
      throw new UnprocessableEntityException(
        `Insufficient stock: available=${stock?.quantityAvailable ?? 0}, requested=${dto.quantity}`
      );
    }

    // NFC validation if required (>AED 500 threshold)
    let nfcValidation: object | undefined;
    if (variant.requiresNfc && dto.nfcBottleId && dto.sunMessage) {
      nfcValidation = await this.hardware.validateNfcBottle({
        sunMessage: dto.sunMessage,
        bottleId: dto.nfcBottleId,
        deviceId: dto.deviceId ?? '',
        staffId,
        locationId: tx.locationId,
        organizationId: orgId,
      });

      if (!(nfcValidation as { valid: boolean }).valid) {
        throw new BadRequestException('NFC validation failed — bottle authentication required for items over AED 500');
      }
    }

    // Calculate line totals
    const unitPrice = dto.overridePrice ?? variant.retailPrice;
    const discountAmount = (unitPrice * (dto.discountPercent ?? 0) / 100) * dto.quantity;
    const lineSubtotal = (unitPrice * dto.quantity) - discountAmount;
    const vatAmount = lineSubtotal * variant.vatRate;
    const lineTotal = lineSubtotal + vatAmount;

    // Insert item — triggers: fn_inventory_deduct_on_sale + fn_recompute_transaction_totals
    // Note: inventory deduction happens in trigger AFTER INSERT
    const [item] = await this.sql<{ id: string }[]>`
      INSERT INTO transaction_items (
        transaction_id, product_variant_id, product_id,
        nfc_bottle_id, nfc_validated, nfc_validation_status,
        quantity, unit_price, discount_percent, discount_amount,
        vat_rate, vat_amount, line_total, cost_price,
        customization, engraving_price, item_status
      ) VALUES (
        ${transactionId},
        ${dto.productVariantId},
        ${variant.productId},
        ${dto.nfcBottleId ?? null},
        ${nfcValidation ? (nfcValidation as { valid: boolean }).valid : false},
        ${nfcValidation ? (nfcValidation as { status: string }).status : 'not_required'},
        ${dto.quantity},
        ${unitPrice},
        ${dto.discountPercent ?? 0},
        ${discountAmount},
        ${variant.vatRate},
        ${vatAmount},
        ${lineTotal},
        ${variant.retailPrice},
        ${JSON.stringify(dto.customization ?? {})},
        ${dto.engravingPrice ?? 0},
        'active'
      )
      RETURNING id
    `;

    return { itemId: item!.id, nfcValidation };
  }

  // ── 3. Complete / Checkout ─────────────────────────────────────────────

  async completeTransaction(
    transactionId: string,
    dto: CompleteTransactionDto,
    orgId: string,
    staffId: string,
  ): Promise<CheckoutResult> {
    const checkoutStart = Date.now();

    // Idempotency check
    if (dto.idempotencyKey) {
      const [existing] = await this.sql<{ responseBody: CheckoutResult }[]>`
        SELECT response_body FROM idempotency_keys
        WHERE key = ${dto.idempotencyKey} AND endpoint = 'transactions.complete'
        LIMIT 1
      `;
      if (existing?.responseBody) return existing.responseBody;
    }

    // Fetch transaction
    const [tx] = await this.sql<{
      id: string; status: string; total: number; customerId: string | null;
      organizationId: string; receiptNumber: number; locationId: string;
    }[]>`
      SELECT id, status, total, customer_id, organization_id, receipt_number, location_id
      FROM transactions
      WHERE id = ${transactionId} AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status === 'completed') {
      return { transactionId: tx.id, receiptNumber: tx.receiptNumber, status: 'completed', total: tx.total, loyaltyPointsEarned: 0, receiptUrl: '', checkoutMs: 0 };
    }
    if (!['draft', 'pending'].includes(tx.status)) {
      throw new BadRequestException(`Cannot complete transaction in status: ${tx.status}`);
    }

    // Validate payment amounts cover total
    const paymentTotal = dto.payments.reduce((sum, p) => sum + p.amount, 0);
    if (Math.abs(paymentTotal - tx.total) > 0.01) {
      throw new BadRequestException(
        `Payment total ${paymentTotal} does not match transaction total ${tx.total}`
      );
    }

    // Complete within a transaction — triggers fire (loyalty, LTV, AI log)
    await this.sql.begin(async (sql) => {
      // Mark as completed
      await sql`
        UPDATE transactions SET
          status = 'completed',
          completed_at = now(),
          updated_at = now()
        WHERE id = ${transactionId}
      `;

      // Insert payment records
      for (const payment of dto.payments) {
        await sql`
          INSERT INTO payments (
            organization_id, transaction_id, method, status, amount,
            currency, provider, provider_reference, terminal_id
          ) VALUES (
            ${orgId}, ${transactionId},
            ${payment.method}, 'captured',
            ${payment.amount}, ${payment.currency ?? 'AED'},
            ${payment.provider ?? null}, ${payment.providerReference ?? null},
            ${payment.terminalId ?? null}
          )
        `;
      }
    });

    // AI fraud detection — NEVER blocks checkout (Fix 1)
    // Fire and forget — result logged but checkout is already complete
    this.ai.detectFraud(transactionId).then((fraud) => {
      if (fraud.flagged) {
        this.logger.warn(`🚨 Fraud signal on completed TX ${transactionId}: score=${fraud.score}`);
      }
    }).catch(() => { /* circuit breaker handles */ });

    // Queue blockchain passport minting (Fix 4 — always async)
    const items = await this.sql<{ id: string }[]>`
      SELECT id FROM transaction_items
      WHERE transaction_id = ${transactionId} AND item_status = 'active'
    `;
    for (const item of items) {
      await this.blockchainQueue.add('mint-passport', {
        transactionItemId: item.id,
        organizationId: orgId,
      }, { attempts: 5, backoff: { type: 'exponential', delay: 30000 } });
    }

    // Queue receipt generation
    await this.receiptsQueue.add('generate-receipt', {
      transactionId,
      organizationId: orgId,
    });

    // Queue post-sale outreach if customer present
    if (tx.customerId) {
      await this.outreachQueue.add('post-sale-outreach', {
        customerId: tx.customerId,
        transactionId,
        organizationId: orgId,
      }, { delay: 3600000 }); // 1 hour delay
    }

    const checkoutMs = Date.now() - checkoutStart;
    if (checkoutMs > 500) {
      this.logger.warn(`Checkout exceeded 500ms SLA: ${checkoutMs}ms for TX ${transactionId}`);
    }

    const result: CheckoutResult = {
      transactionId,
      receiptNumber: tx.receiptNumber,
      status: 'completed',
      total: tx.total,
      loyaltyPointsEarned: Math.floor(tx.total / 10),
      receiptUrl: `/api/v1/sales/transactions/${transactionId}/receipt`,
      checkoutMs,
    };

    if (dto.idempotencyKey) {
      await this.sql`
        INSERT INTO idempotency_keys (key, user_id, endpoint, response_status, response_body)
        VALUES (${dto.idempotencyKey}, ${staffId}, 'transactions.complete', 200, ${JSON.stringify(result)})
        ON CONFLICT (key) DO NOTHING
      `;
    }

    return result;
  }

  // ── 4. Void Transaction ───────────────────────────────────────────────

  async voidTransaction(transactionId: string, dto: VoidTransactionDto, orgId: string, staffId: string): Promise<{ voided: boolean }> {
    const [tx] = await this.sql<{ status: string }[]>`
      SELECT status FROM transactions
      WHERE id = ${transactionId} AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status === 'voided') throw new ConflictException('Transaction already voided');
    if (tx.status === 'completed') throw new BadRequestException('Use refund for completed transactions');

    await this.sql.begin(async (sql) => {
      // Void the transaction
      await sql`
        UPDATE transactions SET
          status = 'voided',
          voided_at = now(),
          voided_by = ${staffId},
          void_reason = ${dto.reason},
          updated_at = now()
        WHERE id = ${transactionId}
      `;
      // Void all items — trigger fn_inventory_restore_on_void fires on each
      await sql`
        UPDATE transaction_items SET item_status = 'voided'
        WHERE transaction_id = ${transactionId} AND item_status = 'active'
      `;
    });

    return { voided: true };
  }

  // ── 5. List Transactions ──────────────────────────────────────────────

  async listTransactions(orgId: string, filters: {
    locationId?: string; staffId?: string; customerId?: string;
    status?: string; from?: string; to?: string; limit?: number; offset?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    return this.sql`
      SELECT
        t.id, t.receipt_number, t.type, t.status, t.channel,
        t.total, t.currency, t.loyalty_points_earned,
        t.completed_at, t.created_at,
        c.display_name AS customer_name,
        u.display_name AS staff_name,
        l.name AS location_name
      FROM transactions t
      LEFT JOIN customers c ON c.id = t.customer_id
      JOIN users u ON u.id = t.staff_id
      JOIN locations l ON l.id = t.location_id
      WHERE t.organization_id = ${orgId}
        AND (${filters.locationId ?? null}::uuid IS NULL OR t.location_id = ${filters.locationId ?? null})
        AND (${filters.staffId ?? null}::uuid IS NULL OR t.staff_id = ${filters.staffId ?? null})
        AND (${filters.customerId ?? null}::uuid IS NULL OR t.customer_id = ${filters.customerId ?? null})
        AND (${filters.status ?? null} IS NULL OR t.status = ${filters.status ?? null})
        AND (${filters.from ?? null} IS NULL OR t.created_at >= ${filters.from ?? null}::timestamptz)
        AND (${filters.to ?? null} IS NULL OR t.created_at <= ${filters.to ?? null}::timestamptz)
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  // ── 6. Get Single Transaction ──────────────────────────────────────────

  async getTransaction(transactionId: string, orgId: string) {
    const [tx] = await this.sql`
      SELECT
        t.*,
        c.display_name AS customer_name, c.phone AS customer_phone,
        u.display_name AS staff_name,
        l.name AS location_name,
        json_agg(
          json_build_object(
            'id', ti.id,
            'productVariantId', ti.product_variant_id,
            'quantity', ti.quantity,
            'unitPrice', ti.unit_price,
            'vatAmount', ti.vat_amount,
            'lineTotal', ti.line_total,
            'nfcValidated', ti.nfc_validated,
            'customization', ti.customization,
            'itemStatus', ti.item_status
          ) ORDER BY ti.created_at
        ) FILTER (WHERE ti.id IS NOT NULL) AS items,
        json_agg(
          DISTINCT json_build_object(
            'method', p.method,
            'amount', p.amount,
            'status', p.status
          )
        ) FILTER (WHERE p.id IS NOT NULL) AS payments
      FROM transactions t
      LEFT JOIN customers c ON c.id = t.customer_id
      JOIN users u ON u.id = t.staff_id
      JOIN locations l ON l.id = t.location_id
      LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
      LEFT JOIN payments p ON p.transaction_id = t.id
      WHERE t.id = ${transactionId} AND t.organization_id = ${orgId}
      GROUP BY t.id, c.display_name, c.phone, u.display_name, l.name
    `;

    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  // ── 7. Apply CRDT deltas from offline terminals ────────────────────────

  async applyCrdtDeltas(deltas: Array<{
    documentType: string; documentId: string;
    deltaType: string; deltaPayload: Record<string, unknown>; vectorClock: number;
  }>, orgId: string, deviceId: string): Promise<{ applied: number; conflicts: number }> {
    let applied = 0;
    let conflicts = 0;

    for (const delta of deltas) {
      try {
        // Engineering Fix 2: CRDT deltas applied inside pg18 transaction with advisory lock
        await this.sql.begin(async (sql) => {
          await sql`
            INSERT INTO crdt_delta_queue (
              organization_id, device_id, document_type, document_id,
              delta_type, delta_payload, vector_clock, status
            ) VALUES (
              ${orgId}, ${deviceId},
              ${delta.documentType}, ${delta.documentId},
              ${delta.deltaType}, ${JSON.stringify(delta.deltaPayload)},
              ${delta.vectorClock}, 'crdt_pending'
            )
          `;

          // Apply inventory PN-counter deltas immediately
          if (delta.documentType === 'inventory' && delta.deltaType === 'pn_counter_decrement') {
            const payload = delta.deltaPayload as { variant_id: string; location_id: string; delta: number };
            // Advisory lock per Fix 2
            await sql`SELECT pg_advisory_xact_lock(hashtext('inv:' || ${payload.variant_id}))`;
            await sql`
              UPDATE inventory SET
                quantity_on_hand = GREATEST(0, quantity_on_hand + ${payload.delta}),
                updated_at = now()
              WHERE product_variant_id = ${payload.variant_id}
                AND location_id = ${payload.location_id}
            `;
            await sql`
              UPDATE crdt_delta_queue SET status = 'crdt_applied', applied_at = now()
              WHERE document_id = ${delta.documentId} AND vector_clock = ${delta.vectorClock}
            `;
          }
        });
        applied++;
      } catch {
        conflicts++;
        await this.sql`
          UPDATE crdt_delta_queue SET status = 'crdt_conflicted'
          WHERE document_id = ${delta.documentId} AND vector_clock = ${delta.vectorClock}
        `.catch(() => {});
      }
    }

    return { applied, conflicts };
  }
}
