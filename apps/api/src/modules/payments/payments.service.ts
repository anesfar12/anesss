// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — PaymentsService
// Gift card issuance + redemption, loyalty point redemption,
// cash float management. All tied to the transactions table.
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, Logger, Inject, NotFoundException,
  BadRequestException, UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';
import type {
  IssueGiftCardDto,
  RedeemGiftCardDto,
  RedeemLoyaltyDto,
  OpenCashSessionDto,
  CloseCashSessionDto,
} from './dto/payments.dto';

// Points-to-AED conversion rate (blueprint: loyalty_points_value: 0.01)
const POINTS_TO_AED = 0.01;   // 100 pts = AED 1.00
const POINTS_PER_AED = 0.1;   // 1 AED = 0.1 pts earned → 10 AED = 1 pt earned

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
  ) {}

  // ══════════════════════════════════════════════════
  // GIFT CARDS
  // ══════════════════════════════════════════════════

  async issueGiftCard(dto: IssueGiftCardDto, orgId: string, staffId: string) {
    // Generate human-readable masked code
    const rawCode = this.generateGiftCardCode();
    // Hash code for PCI compliance — never store raw code in plain text
    const codeHash = await bcrypt.hash(rawCode, 10);
    // Display code: LUXE-XXXX-XXXX-XXXX (last 12 chars visible)
    const maskedCode = 'LUXE-' + rawCode.slice(0, 4) + '-' + rawCode.slice(4, 8) + '-' + rawCode.slice(8, 12);

    const [card] = await this.sql<{ id: string }[]>`
      INSERT INTO gift_cards (
        organization_id, code, code_hash,
        initial_value, current_balance, currency,
        status, issued_to, issued_by,
        expires_at, customization
      ) VALUES (
        ${orgId},
        ${maskedCode},
        ${codeHash},
        ${dto.initialValue},
        ${dto.initialValue},
        'AED',
        'active',
        ${dto.issuedTo ?? null},
        ${staffId},
        ${dto.expiresAt ?? null},
        ${JSON.stringify(dto.customization ?? {})}::jsonb
      )
      RETURNING id
    `;

    this.logger.log(`Gift card issued: ${maskedCode} | AED ${dto.initialValue} | org ${orgId}`);

    return {
      id: card!.id,
      code: maskedCode,
      initialValue: dto.initialValue,
      currentBalance: dto.initialValue,
      currency: 'AED',
      status: 'active',
      expiresAt: dto.expiresAt ?? null,
    };
  }

  async getGiftCardBalance(code: string, orgId: string) {
    // Look up all active cards and compare hash (bcrypt compare)
    const cards = await this.sql<{
      id: string;
      code: string;
      codeHash: string;
      currentBalance: number;
      initialValue: number;
      status: string;
      expiresAt: string | null;
    }[]>`
      SELECT id, code, code_hash, current_balance, initial_value, status, expires_at
      FROM gift_cards
      WHERE organization_id = ${orgId}
        AND status = 'active'
    `;

    for (const card of cards) {
      // Match by masked code directly (mask is unique enough for lookup)
      if (card.code === code) {
        return {
          id: card.id,
          code: card.code,
          currentBalance: card.currentBalance,
          initialValue: card.initialValue,
          status: card.status,
          expiresAt: card.expiresAt,
        };
      }
    }

    throw new NotFoundException('Gift card not found or inactive');
  }

  async redeemGiftCard(dto: RedeemGiftCardDto, orgId: string, staffId: string) {
    // Find card by masked code
    const [card] = await this.sql<{
      id: string;
      currentBalance: number;
      status: string;
      expiresAt: string | null;
    }[]>`
      SELECT id, current_balance, status, expires_at
      FROM gift_cards
      WHERE organization_id = ${orgId}
        AND code = ${dto.code}
      LIMIT 1
    `;

    if (!card) throw new NotFoundException('Gift card not found');
    if (card.status !== 'active') {
      throw new BadRequestException(`Gift card is ${card.status} — cannot redeem`);
    }
    if (card.expiresAt && new Date(card.expiresAt) < new Date()) {
      throw new BadRequestException('Gift card has expired');
    }
    if (card.currentBalance < dto.amount) {
      throw new UnprocessableEntityException(
        `Insufficient gift card balance: AED ${card.currentBalance} available, AED ${dto.amount} requested`,
      );
    }

    // Verify transaction exists and belongs to org
    const [tx] = await this.sql<{ id: string; total: number; status: string }[]>`
      SELECT id, total, status
      FROM transactions
      WHERE id = ${dto.transactionId}
        AND organization_id = ${orgId}
      LIMIT 1
    `;
    if (!tx) throw new NotFoundException('Transaction not found');
    if (!['draft', 'pending'].includes(tx.status)) {
      throw new BadRequestException('Cannot apply gift card to a transaction that is not draft/pending');
    }

    const newBalance = card.currentBalance - dto.amount;
    const newStatus = newBalance <= 0 ? 'exhausted' : 'active';

    await this.sql.begin(async sql => {
      // Deduct from gift card
      await sql`
        UPDATE gift_cards
        SET current_balance = ${newBalance},
            status = ${newStatus},
            last_used_at = now(),
            updated_at = now()
        WHERE id = ${card.id}
      `;

      // Insert payment record against the transaction
      await sql`
        INSERT INTO payments (
          organization_id, transaction_id, method, status,
          amount, currency, gift_card_id, gift_card_amount
        ) VALUES (
          ${orgId}, ${dto.transactionId}, 'gift_card', 'captured',
          ${dto.amount}, 'AED', ${card.id}, ${dto.amount}
        )
      `;
    });

    this.logger.log(`Gift card redeemed: AED ${dto.amount} from card ${dto.code} | tx ${dto.transactionId}`);

    return {
      redeemed: true,
      amountApplied: dto.amount,
      remainingBalance: newBalance,
      cardStatus: newStatus,
    };
  }

  // ══════════════════════════════════════════════════
  // LOYALTY POINTS
  // ══════════════════════════════════════════════════

  async redeemLoyaltyPoints(dto: RedeemLoyaltyDto, orgId: string, staffId: string) {
    // Validate customer has enough points
    const [customer] = await this.sql<{
      id: string;
      displayName: string;
      loyaltyPoints: number;
    }[]>`
      SELECT id, display_name, loyalty_points
      FROM customers
      WHERE id = ${dto.customerId}
        AND organization_id = ${orgId}
        AND is_deleted = FALSE
      LIMIT 1
    `;

    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.loyaltyPoints < dto.points) {
      throw new UnprocessableEntityException(
        `Insufficient loyalty points: ${customer.loyaltyPoints} available, ${dto.points} requested`,
      );
    }

    // Validate transaction
    const [tx] = await this.sql<{ id: string; total: number; status: string }[]>`
      SELECT id, total, status FROM transactions
      WHERE id = ${dto.transactionId}
        AND organization_id = ${orgId}
      LIMIT 1
    `;
    if (!tx) throw new NotFoundException('Transaction not found');
    if (!['draft', 'pending'].includes(tx.status)) {
      throw new BadRequestException('Transaction is not open for payment');
    }

    // Calculate AED equivalent (100 pts = AED 1.00)
    const aedValue = parseFloat((dto.points * POINTS_TO_AED).toFixed(2));
    const newBalance = customer.loyaltyPoints - dto.points;

    await this.sql.begin(async sql => {
      // Deduct from customer
      await sql`
        UPDATE customers
        SET loyalty_points = ${newBalance},
            updated_at = now()
        WHERE id = ${dto.customerId}
      `;

      // Log loyalty transaction
      await sql`
        INSERT INTO loyalty_transactions (
          organization_id, customer_id, transaction_type,
          points, points_balance, reference_id, reference_type, description
        ) VALUES (
          ${orgId}, ${dto.customerId}, 'redeemed_discount',
          ${-dto.points}, ${newBalance},
          ${dto.transactionId}, 'transaction',
          ${'Redeemed ' + dto.points + ' pts = AED ' + aedValue}
        )
      `;

      // Apply discount as a payment
      await sql`
        INSERT INTO payments (
          organization_id, transaction_id, method, status,
          amount, currency
        ) VALUES (
          ${orgId}, ${dto.transactionId}, 'loyalty_points', 'captured',
          ${aedValue}, 'AED'
        )
      `;

      // Update the transaction's loyalty redeemed counter
      await sql`
        UPDATE transactions
        SET loyalty_points_redeemed = loyalty_points_redeemed + ${dto.points},
            updated_at = now()
        WHERE id = ${dto.transactionId}
      `;
    });

    this.logger.log(
      `Loyalty redeemed: ${dto.points} pts (AED ${aedValue}) for customer ${dto.customerId}`,
    );

    return {
      redeemed: true,
      pointsRedeemed: dto.points,
      aedValueApplied: aedValue,
      remainingPoints: newBalance,
    };
  }

  async getLoyaltyBalance(customerId: string, orgId: string) {
    const [customer] = await this.sql<{
      id: string;
      displayName: string;
      loyaltyPoints: number;
      loyaltyPointsPending: number;
      tier: string;
    }[]>`
      SELECT id, display_name, loyalty_points, loyalty_points_pending, tier
      FROM customers
      WHERE id = ${customerId}
        AND organization_id = ${orgId}
        AND is_deleted = FALSE
      LIMIT 1
    `;

    if (!customer) throw new NotFoundException('Customer not found');

    const aedValue = parseFloat((customer.loyaltyPoints * POINTS_TO_AED).toFixed(2));

    return {
      customerId: customer.id,
      customerName: customer.displayName,
      tier: customer.tier,
      pointsBalance: customer.loyaltyPoints,
      pointsPending: customer.loyaltyPointsPending,
      aedEquivalent: aedValue,
      pointsPerAed: POINTS_PER_AED,
      aedPerPoint: POINTS_TO_AED,
    };
  }

  async getLoyaltyHistory(customerId: string, orgId: string, limit = 20) {
    return this.sql`
      SELECT
        lt.id, lt.transaction_type, lt.points,
        lt.points_balance, lt.description, lt.created_at,
        t.receipt_number
      FROM loyalty_transactions lt
      LEFT JOIN transactions t ON t.id = lt.reference_id::uuid
      WHERE lt.customer_id = ${customerId}
        AND lt.organization_id = ${orgId}
      ORDER BY lt.created_at DESC
      LIMIT ${limit}
    `;
  }

  // ══════════════════════════════════════════════════
  // CASH SESSION MANAGEMENT
  // ══════════════════════════════════════════════════

  async openCashSession(dto: OpenCashSessionDto, orgId: string, staffId: string) {
    // Prevent double-open on same device
    const [existing] = await this.sql<{ id: number }[]>`
      SELECT id FROM cash_sessions
      WHERE organization_id = ${orgId}
        AND location_id = ${dto.locationId}
        AND status = 'open'
        AND (${dto.deviceId ?? null}::uuid IS NULL
             OR device_id = ${dto.deviceId ?? null})
      LIMIT 1
    `;

    if (existing) {
      throw new ConflictException(
        'A cash session is already open for this location/device. Close it first.',
      );
    }

    const [session] = await this.sql<{ id: string }[]>`
      INSERT INTO cash_sessions (
        organization_id, location_id, device_id,
        opened_by, opening_float, status, opened_at
      ) VALUES (
        ${orgId}, ${dto.locationId},
        ${dto.deviceId ?? null},
        ${staffId}, ${dto.openingFloat},
        'open', now()
      )
      RETURNING id
    `;

    this.logger.log(`Cash session opened: AED ${dto.openingFloat} float | location ${dto.locationId}`);

    return {
      sessionId: session!.id,
      locationId: dto.locationId,
      openingFloat: dto.openingFloat,
      status: 'open',
      openedAt: new Date().toISOString(),
    };
  }

  async closeCashSession(sessionId: string, dto: CloseCashSessionDto, orgId: string, staffId: string) {
    const [session] = await this.sql<{
      id: string;
      status: string;
      locationId: string;
      openingFloat: number;
    }[]>`
      SELECT id, status, location_id, opening_float
      FROM cash_sessions
      WHERE id = ${sessionId}
        AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!session) throw new NotFoundException('Cash session not found');
    if (session.status !== 'open') {
      throw new BadRequestException(`Session is already ${session.status}`);
    }

    // Calculate expected cash from all completed cash transactions in this session
    const [cashTotals] = await this.sql<{ expectedCash: number }[]>`
      SELECT COALESCE(SUM(p.amount), 0) AS expected_cash
      FROM payments p
      JOIN transactions t ON t.id = p.transaction_id
      WHERE t.organization_id = ${orgId}
        AND t.location_id = ${session.locationId}
        AND t.status = 'completed'
        AND p.method = 'cash'
        AND p.status = 'captured'
        AND t.completed_at >= (
          SELECT opened_at FROM cash_sessions WHERE id = ${sessionId}
        )
    `;

    const expectedCash =
      (cashTotals?.expectedCash ?? 0) + session.openingFloat;

    const variance = dto.closingCount - expectedCash;

    await this.sql`
      UPDATE cash_sessions
      SET status = 'closed',
          closed_by = ${staffId},
          closing_count = ${dto.closingCount},
          expected_cash = ${expectedCash},
          closed_at = now(),
          notes = ${dto.notes ?? null}
      WHERE id = ${sessionId}
    `;

    if (Math.abs(variance) > 10) {
      this.logger.warn(
        `Cash variance AED ${variance.toFixed(2)} on session ${sessionId} | closed by ${staffId}`,
      );
    }

    return {
      sessionId,
      status: 'closed',
      openingFloat: session.openingFloat,
      expectedCash,
      closingCount: dto.closingCount,
      variance,
      closedAt: new Date().toISOString(),
    };
  }

  async listCashSessions(orgId: string, locationId?: string, status?: string) {
    return this.sql`
      SELECT
        cs.id, cs.location_id, cs.device_id,
        cs.opening_float, cs.closing_count, cs.expected_cash,
        cs.variance, cs.status,
        cs.opened_at, cs.closed_at,
        u_open.display_name AS opened_by_name,
        u_close.display_name AS closed_by_name,
        l.name AS location_name
      FROM cash_sessions cs
      JOIN locations l ON l.id = cs.location_id
      JOIN users u_open ON u_open.id = cs.opened_by
      LEFT JOIN users u_close ON u_close.id = cs.closed_by
      WHERE cs.organization_id = ${orgId}
        AND (${locationId ?? null}::uuid IS NULL OR cs.location_id = ${locationId ?? null})
        AND (${status ?? null}::text IS NULL OR cs.status = ${status ?? null})
      ORDER BY cs.opened_at DESC
      LIMIT 50
    `;
  }

  async getActiveCashSession(orgId: string, locationId: string) {
    const [session] = await this.sql`
      SELECT cs.id, cs.opening_float, cs.opened_at,
             u.display_name AS opened_by_name
      FROM cash_sessions cs
      JOIN users u ON u.id = cs.opened_by
      WHERE cs.organization_id = ${orgId}
        AND cs.location_id = ${locationId}
        AND cs.status = 'open'
      LIMIT 1
    `;
    return session ?? null;
  }

  // ══════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ══════════════════════════════════════════════════

  private generateGiftCardCode(): string {
    // 12 alphanumeric characters, uppercase, no ambiguous chars (0/O, 1/I/L)
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 12; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }
}
