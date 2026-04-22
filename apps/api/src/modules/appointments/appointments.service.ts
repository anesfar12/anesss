// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — AppointmentsService
// Scent consultations, bespoke sessions, VIP previews
// Integrates with outreach (reminders) and transactions (conversion)
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, Logger, Inject, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

export interface CreateAppointmentDto {
  customerId: string;
  staffId?: string;
  locationId: string;
  type: string;
  scheduledAt: string;
  durationMinutes?: number;
  notes?: string;
  customerRequests?: string;
}

export interface UpdateAppointmentDto {
  staffId?: string;
  scheduledAt?: string;
  durationMinutes?: number;
  status?: string;
  staffPreparation?: string;
  outcomeNotes?: string;
  relatedTransactionId?: string;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
  ) {}

  // ── List appointments ────────────────────────────────────────────────

  async listAppointments(orgId: string, filters: {
    staffId?: string;
    locationId?: string;
    customerId?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.sql`
      SELECT
        a.id, a.type, a.status, a.scheduled_at, a.duration_minutes,
        a.notes, a.customer_requests, a.outcome_notes,
        c.id AS customer_id, c.display_name AS customer_name,
        c.phone AS customer_phone, c.language_preference,
        u.id AS staff_id, u.display_name AS staff_name,
        l.id AS location_id, l.name AS location_name,
        t.receipt_number AS related_receipt
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN users u ON u.id = a.staff_id
      LEFT JOIN locations l ON l.id = a.location_id
      LEFT JOIN transactions t ON t.id = a.related_transaction_id
      WHERE a.organization_id = ${orgId}
        AND (${filters.staffId ?? null}::uuid IS NULL OR a.staff_id = ${filters.staffId ?? null})
        AND (${filters.locationId ?? null}::uuid IS NULL OR a.location_id = ${filters.locationId ?? null})
        AND (${filters.customerId ?? null}::uuid IS NULL OR a.customer_id = ${filters.customerId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR a.status = ${filters.status ?? null})
        AND (${filters.from ?? null}::timestamptz IS NULL OR a.scheduled_at >= ${filters.from ?? null}::timestamptz)
        AND (${filters.to ?? null}::timestamptz IS NULL OR a.scheduled_at <= ${filters.to ?? null}::timestamptz)
      ORDER BY a.scheduled_at DESC
      LIMIT ${limit}
    `;
  }

  // ── Get single appointment ───────────────────────────────────────────

  async getAppointment(appointmentId: number, orgId: string) {
    const [appt] = await this.sql`
      SELECT a.*, c.display_name AS customer_name, c.phone AS customer_phone,
             u.display_name AS staff_name, l.name AS location_name
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN users u ON u.id = a.staff_id
      LEFT JOIN locations l ON l.id = a.location_id
      WHERE a.id = ${appointmentId} AND a.organization_id = ${orgId}
    `;
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  // ── Book appointment ─────────────────────────────────────────────────

  async createAppointment(dto: CreateAppointmentDto, orgId: string, createdBy: string) {
    // Validate customer exists
    const [customer] = await this.sql<{ id: string }[]>`
      SELECT id FROM customers WHERE id = ${dto.customerId} AND organization_id = ${orgId} LIMIT 1
    `;
    if (!customer) throw new NotFoundException('Customer not found');

    // Check staff availability if provided
    if (dto.staffId) {
      const scheduledAt = new Date(dto.scheduledAt);
      const durationMins = dto.durationMinutes ?? 60;
      const endAt = new Date(scheduledAt.getTime() + durationMins * 60000);

      const [conflict] = await this.sql<{ id: number }[]>`
        SELECT id FROM appointments
        WHERE staff_id = ${dto.staffId}
          AND organization_id = ${orgId}
          AND status IN ('confirmed', 'in_progress')
          AND scheduled_at < ${endAt.toISOString()}::timestamptz
          AND (scheduled_at + (duration_minutes || ' minutes')::interval) > ${dto.scheduledAt}::timestamptz
        LIMIT 1
      `;
      if (conflict) throw new BadRequestException('Staff member has a conflicting appointment at this time');
    }

    const [appt] = await this.sql<{ id: number }[]>`
      INSERT INTO appointments (
        organization_id, location_id, customer_id, staff_id,
        type, status, scheduled_at, duration_minutes,
        notes, customer_requests
      ) VALUES (
        ${orgId}, ${dto.locationId}, ${dto.customerId},
        ${dto.staffId ?? null}, ${dto.type}, 'requested',
        ${dto.scheduledAt}::timestamptz,
        ${dto.durationMinutes ?? 60},
        ${dto.notes ?? null},
        ${dto.customerRequests ?? null}
      )
      RETURNING id
    `;

    this.logger.log(`Appointment booked: #${appt!.id} | ${dto.type} | customer ${dto.customerId}`);
    return { appointmentId: appt!.id, status: 'requested' };
  }

  // ── Confirm appointment ──────────────────────────────────────────────

  async confirmAppointment(appointmentId: number, staffId: string | null, orgId: string) {
    await this.sql`
      UPDATE appointments
      SET status = 'confirmed',
          staff_id = COALESCE(${staffId ?? null}::uuid, staff_id),
          updated_at = now()
      WHERE id = ${appointmentId} AND organization_id = ${orgId}
        AND status = 'requested'
    `;
    return { confirmed: true };
  }

  // ── Complete appointment ─────────────────────────────────────────────

  async completeAppointment(appointmentId: number, dto: UpdateAppointmentDto, orgId: string) {
    await this.sql`
      UPDATE appointments
      SET status = 'completed',
          outcome_notes = ${dto.outcomeNotes ?? null},
          staff_preparation = ${dto.staffPreparation ?? null},
          related_transaction_id = ${dto.relatedTransactionId ?? null}::uuid,
          updated_at = now()
      WHERE id = ${appointmentId} AND organization_id = ${orgId}
        AND status IN ('confirmed', 'in_progress')
    `;
    return { completed: true };
  }

  // ── Cancel appointment ───────────────────────────────────────────────

  async cancelAppointment(appointmentId: number, orgId: string) {
    await this.sql`
      UPDATE appointments
      SET status = 'cancelled', updated_at = now()
      WHERE id = ${appointmentId} AND organization_id = ${orgId}
        AND status IN ('requested', 'confirmed')
    `;
    return { cancelled: true };
  }

  // ── Calendar view (upcoming per location) ───────────────────────────

  async getCalendar(locationId: string, orgId: string, from: string, to: string) {
    return this.sql`
      SELECT
        a.id, a.type, a.status, a.scheduled_at, a.duration_minutes,
        c.display_name AS customer_name, c.language_preference,
        u.display_name AS staff_name
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN users u ON u.id = a.staff_id
      WHERE a.organization_id = ${orgId}
        AND a.location_id = ${locationId}
        AND a.scheduled_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND a.status NOT IN ('cancelled', 'no_show')
      ORDER BY a.scheduled_at ASC
    `;
  }
}
