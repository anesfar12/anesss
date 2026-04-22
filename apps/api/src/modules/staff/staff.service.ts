// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — StaffService
// Staff CRUD, performance KPIs, commission history, targets, scheduling
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, Logger, Inject, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

export interface CreateStaffDto {
  email: string;
  firstName: string;
  lastName: string;
  firstNameAr?: string;
  lastNameAr?: string;
  phone?: string;
  role: string;
  locationId?: string;
  commissionRate?: number;
  salesTargetMonthly?: number;
  languagePreference?: string;
  pin?: string;
}

export interface UpdateStaffDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: string;
  locationId?: string;
  commissionRate?: number;
  salesTargetMonthly?: number;
  languagePreference?: string;
  isActive?: boolean;
}

export interface SetTargetDto {
  targetMonth: string;       // YYYY-MM-01
  revenueTarget: number;
  unitsTarget?: number;
  customerTarget?: number;
}

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
  ) {}

  // ── List all staff with today's performance ─────────────────────────

  async listStaff(orgId: string, locationId?: string) {
    return this.sql`
      SELECT
        u.id, u.email, u.display_name, u.first_name, u.last_name,
        u.first_name_ar, u.last_name_ar, u.phone, u.role,
        u.is_active, u.last_login_at, u.last_pin_at,
        u.commission_rate, u.sales_target_monthly,
        u.language_preference, u.biometric_enrolled,
        u.location_id,
        l.name AS location_name,
        -- Today's sales
        COALESCE(SUM(t.total) FILTER (
          WHERE t.status = 'completed'
            AND t.completed_at::date = CURRENT_DATE
        ), 0) AS sales_today,
        COUNT(t.id) FILTER (
          WHERE t.status = 'completed'
            AND t.completed_at::date = CURRENT_DATE
        )::int AS transactions_today
      FROM users u
      LEFT JOIN locations l ON l.id = u.location_id
      LEFT JOIN transactions t ON t.staff_id = u.id
        AND t.organization_id = ${orgId}
      WHERE u.organization_id = ${orgId}
        AND u.is_deleted = FALSE
        AND (${locationId ?? null}::uuid IS NULL
             OR u.location_id = ${locationId ?? null})
      GROUP BY u.id, u.email, u.display_name, u.first_name, u.last_name,
               u.first_name_ar, u.last_name_ar, u.phone, u.role,
               u.is_active, u.last_login_at, u.last_pin_at,
               u.commission_rate, u.sales_target_monthly,
               u.language_preference, u.biometric_enrolled,
               u.location_id, l.name
      ORDER BY u.role, u.display_name
    `;
  }

  // ── Get single staff member ──────────────────────────────────────────

  async getStaff(staffId: string, orgId: string) {
    const [user] = await this.sql`
      SELECT u.*, l.name AS location_name
      FROM users u
      LEFT JOIN locations l ON l.id = u.location_id
      WHERE u.id = ${staffId}
        AND u.organization_id = ${orgId}
        AND u.is_deleted = FALSE
    `;
    if (!user) throw new NotFoundException('Staff member not found');
    return user;
  }

  // ── Create staff member ──────────────────────────────────────────────

  async createStaff(dto: CreateStaffDto, orgId: string) {
    const [existing] = await this.sql<{ id: string }[]>`
      SELECT id FROM users
      WHERE organization_id = ${orgId} AND email = ${dto.email}
      LIMIT 1
    `;
    if (existing) throw new ConflictException('Staff member with this email already exists');

    let pinHash: string | null = null;
    if (dto.pin) {
      if (dto.pin.length < 4 || dto.pin.length > 6) {
        throw new BadRequestException('PIN must be 4–6 digits');
      }
      if (!/^\d+$/.test(dto.pin)) throw new BadRequestException('PIN must be numeric');
      pinHash = await bcrypt.hash(dto.pin, this.BCRYPT_ROUNDS);
    }

    const [user] = await this.sql<{ id: string; displayName: string }[]>`
      INSERT INTO users (
        organization_id, email, first_name, last_name,
        first_name_ar, last_name_ar, phone,
        role, location_id,
        commission_rate, sales_target_monthly,
        language_preference, pin_hash
      ) VALUES (
        ${orgId},
        ${dto.email},
        ${dto.firstName},
        ${dto.lastName},
        ${dto.firstNameAr ?? null},
        ${dto.lastNameAr ?? null},
        ${dto.phone ?? null},
        ${dto.role},
        ${dto.locationId ?? null},
        ${dto.commissionRate ?? 0.03},
        ${dto.salesTargetMonthly ?? null},
        ${dto.languagePreference ?? 'en'},
        ${pinHash}
      )
      RETURNING id, display_name
    `;

    this.logger.log(`Staff created: ${user!.displayName} (${dto.role}) org=${orgId}`);
    return { id: user!.id, displayName: user!.displayName, role: dto.role };
  }

  // ── Update staff member ──────────────────────────────────────────────

  async updateStaff(staffId: string, dto: UpdateStaffDto, orgId: string) {
    const [user] = await this.sql<{ id: string }[]>`
      SELECT id FROM users
      WHERE id = ${staffId} AND organization_id = ${orgId} AND is_deleted = FALSE
      LIMIT 1
    `;
    if (!user) throw new NotFoundException('Staff member not found');

    await this.sql`
      UPDATE users SET
        first_name         = COALESCE(${dto.firstName ?? null}, first_name),
        last_name          = COALESCE(${dto.lastName ?? null}, last_name),
        phone              = COALESCE(${dto.phone ?? null}, phone),
        role               = COALESCE(${dto.role ?? null}::user_role, role),
        location_id        = COALESCE(${dto.locationId ?? null}::uuid, location_id),
        commission_rate    = COALESCE(${dto.commissionRate ?? null}, commission_rate),
        sales_target_monthly = COALESCE(${dto.salesTargetMonthly ?? null}, sales_target_monthly),
        language_preference  = COALESCE(${dto.languagePreference ?? null}::language_preference, language_preference),
        is_active          = COALESCE(${dto.isActive ?? null}, is_active),
        updated_at         = now()
      WHERE id = ${staffId} AND organization_id = ${orgId}
    `;

    return this.getStaff(staffId, orgId);
  }

  // ── Reset PIN ────────────────────────────────────────────────────────

  async resetPin(staffId: string, newPin: string, orgId: string) {
    if (!/^\d{4,6}$/.test(newPin)) throw new BadRequestException('PIN must be 4–6 numeric digits');
    const pinHash = await bcrypt.hash(newPin, this.BCRYPT_ROUNDS);
    await this.sql`
      UPDATE users SET pin_hash = ${pinHash}, updated_at = now()
      WHERE id = ${staffId} AND organization_id = ${orgId} AND is_deleted = FALSE
    `;
    return { pinReset: true };
  }

  // ── Performance KPIs ─────────────────────────────────────────────────

  async getPerformance(staffId: string, orgId: string, period: 'daily' | 'weekly' | 'monthly' = 'monthly') {
    const [staff] = await this.sql<{ displayName: string; role: string; commissionRate: number; salesTargetMonthly: number }[]>`
      SELECT display_name, role, commission_rate, sales_target_monthly
      FROM users WHERE id = ${staffId} AND organization_id = ${orgId}
      LIMIT 1
    `;
    if (!staff) throw new NotFoundException('Staff member not found');

    const dateFilter = period === 'daily'   ? 'CURRENT_DATE'
                     : period === 'weekly'  ? "DATE_TRUNC('week', CURRENT_DATE)"
                     : "DATE_TRUNC('month', CURRENT_DATE)";

    const [kpis] = await this.sql`
      SELECT
        COUNT(t.id)::int                          AS transaction_count,
        COALESCE(SUM(t.total), 0)                AS total_sales,
        COALESCE(AVG(t.total), 0)                AS avg_transaction,
        COALESCE(SUM(t.loyalty_points_earned), 0)::int AS loyalty_issued,
        COUNT(DISTINCT t.customer_id)::int        AS unique_customers,
        COUNT(CASE WHEN t.type = 'refund' THEN 1 END)::int AS refunds
      FROM transactions t
      WHERE t.staff_id = ${staffId}
        AND t.organization_id = ${orgId}
        AND t.status = 'completed'
        AND t.completed_at >= ${dateFilter}::timestamptz
    `;

    const commission = Number(kpis!['totalSales'] ?? 0) * staff.commissionRate;
    const targetPct  = staff.salesTargetMonthly > 0
      ? Math.round((Number(kpis!['totalSales'] ?? 0) / staff.salesTargetMonthly) * 100)
      : null;

    return {
      staffId,
      displayName: staff.displayName,
      role: staff.role,
      period,
      ...kpis,
      commissionEarned: commission,
      salesTargetMonthly: staff.salesTargetMonthly,
      targetAchievementPct: targetPct,
    };
  }

  // ── Commission history ────────────────────────────────────────────────

  async getCommissions(staffId: string, orgId: string, limit = 12) {
    return this.sql`
      SELECT id, period, period_start, period_end,
             total_sales, commission_rate, commission_net,
             status, paid_at, created_at
      FROM staff_commissions
      WHERE user_id = ${staffId}
        AND organization_id = ${orgId}
      ORDER BY period_start DESC
      LIMIT ${limit}
    `;
  }

  // ── Set monthly target ────────────────────────────────────────────────

  async setTarget(staffId: string, dto: SetTargetDto, orgId: string, setBy: string) {
    const [existing] = await this.sql<{ id: string }[]>`
      SELECT id FROM users
      WHERE id = ${staffId} AND organization_id = ${orgId}
      LIMIT 1
    `;
    if (!existing) throw new NotFoundException('Staff member not found');

    const [target] = await this.sql<{ id: string }[]>`
      INSERT INTO staff_targets (
        organization_id, user_id, target_month,
        revenue_target, units_target, customer_target, set_by
      ) VALUES (
        ${orgId}, ${staffId}, ${dto.targetMonth}::date,
        ${dto.revenueTarget},
        ${dto.unitsTarget ?? null},
        ${dto.customerTarget ?? null},
        ${setBy}
      )
      ON CONFLICT (user_id, target_month) DO UPDATE SET
        revenue_target   = ${dto.revenueTarget},
        units_target     = ${dto.unitsTarget ?? null},
        customer_target  = ${dto.customerTarget ?? null},
        set_by           = ${setBy},
        updated_at       = now()
      RETURNING id
    `;

    // Also update the quick-access column on users
    await this.sql`
      UPDATE users SET
        sales_target_monthly = ${dto.revenueTarget},
        updated_at = now()
      WHERE id = ${staffId}
    `;

    return { targetId: target!.id, targetMonth: dto.targetMonth, revenueTarget: dto.revenueTarget };
  }

  // ── Soft-delete staff ─────────────────────────────────────────────────

  async deleteStaff(staffId: string, orgId: string) {
    await this.sql`
      UPDATE users
      SET is_deleted = TRUE, is_active = FALSE, updated_at = now()
      WHERE id = ${staffId} AND organization_id = ${orgId}
    `;
    // Trigger fn_session_cleanup_on_user_delete fires and revokes all sessions
    return { deleted: true };
  }
}
