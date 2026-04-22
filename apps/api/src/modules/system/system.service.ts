// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — SystemService
// Health checks, audit log, device management, telemetry (diffuser IoT)
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger, Inject } from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);
  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  async getHealth(orgId: string) {
    // DB connectivity check
    const [dbCheck] = await this.sql<{ now: Date }[]>`SELECT now()`;
    // Active devices
    const [devices] = await this.sql<{ total: number; active: number }[]>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE last_seen_at > now() - INTERVAL '5 minutes')::int AS active
      FROM pos_devices WHERE organization_id = ${orgId} AND is_approved = TRUE
    `;
    // Pending CRDT deltas
    const [crdt] = await this.sql<{ pending: number }[]>`
      SELECT COUNT(*)::int AS pending FROM crdt_delta_queue
      WHERE organization_id = ${orgId} AND status = 'crdt_pending'
    `;

    return {
      status: 'healthy',
      database: { connected: !!dbCheck, timestamp: dbCheck!.now },
      devices: devices,
      crdtPendingDeltas: crdt!.pending,
      uptime: process.uptime(),
      nodeVersion: process.version,
    };
  }

  async getAuditLog(orgId: string, filters: {
    userId?: string; action?: string; from?: string; to?: string; limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 500);
    return this.sql`
      SELECT al.id, al.action, al.resource_type, al.resource_id,
             al.old_data, al.new_data, al.ip_address, al.created_at,
             u.display_name AS user_name
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.organization_id = ${orgId}
        AND (${filters.userId ?? null}::uuid IS NULL OR al.user_id = ${filters.userId ?? null})
        AND (${filters.action ?? null}::text IS NULL OR al.action ILIKE ${'%' + (filters.action ?? '') + '%'})
        AND (${filters.from ?? null}::timestamptz IS NULL OR al.created_at >= ${filters.from ?? null}::timestamptz)
        AND (${filters.to ?? null}::timestamptz IS NULL OR al.created_at <= ${filters.to ?? null}::timestamptz)
      ORDER BY al.created_at DESC
      LIMIT ${limit}
    `;
  }

  async listDevices(orgId: string) {
    return this.sql`
      SELECT pd.id, pd.device_name, pd.device_type, pd.hardware_model,
             pd.os_version, pd.app_version, pd.is_approved, pd.is_active,
             pd.nfc_capable, pd.uwb_nfc_capable, pd.biometric_capable,
             pd.last_seen_at, pd.approved_at,
             l.name AS location_name,
             approver.display_name AS approved_by_name
      FROM pos_devices pd
      LEFT JOIN locations l ON l.id = pd.location_id
      LEFT JOIN users approver ON approver.id = pd.approved_by_id
      WHERE pd.organization_id = ${orgId}
      ORDER BY pd.is_approved ASC, pd.created_at DESC
    `;
  }

  async processDiffuserWebhook(payload: Record<string, unknown>, orgId: string) {
    // Upsert diffuser online status
    const diffuserId = payload['deviceId'] as string;
    const cartridgePct = payload['cartridgePercent'] as number;
    const alertType = cartridgePct <= 10 ? 'low_cartridge'
                    : cartridgePct === 0 ? 'empty'
                    : null;

    if (diffuserId) {
      await this.sql`
        UPDATE diffuser_devices
        SET cartridge_percent = ${cartridgePct ?? 100},
            is_online = TRUE,
            last_poll_at = now()
        WHERE id = ${diffuserId}::uuid
          AND organization_id = ${orgId}
      `;

      if (alertType) {
        await this.sql`
          INSERT INTO diffuser_events (diffuser_id, alert_type, cartridge_level, raw_payload)
          VALUES (${diffuserId}::uuid, ${alertType}::diffuser_alert_type, ${cartridgePct}, ${JSON.stringify(payload)}::jsonb)
        `;
        this.logger.warn('Diffuser alert: ' + alertType + ' | device=' + diffuserId);
      }
    }

    return { received: true, alertFired: !!alertType };
  }
}
