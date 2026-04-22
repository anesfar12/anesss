// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — ManufacturingService
// Bespoke formula management, batch production, QC
// Blueprint Phase 10 — Bespoke Mode (feature-flagged: bespoke_mode_enabled)
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

@Injectable()
export class ManufacturingService {
  private readonly logger = new Logger(ManufacturingService.name);
  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  async listFormulas(orgId: string, status?: string) {
    return this.sql`
      SELECT bf.id, bf.name, bf.status, bf.concentration,
             bf.target_volume_ml, bf.created_at, bf.approved_at,
             c.display_name AS customer_name,
             p.display_name AS perfumer_name
      FROM bespoke_formulas bf
      LEFT JOIN customers c ON c.id = bf.customer_id
      LEFT JOIN users p ON p.id = bf.perfumer_id
      WHERE bf.organization_id = ${orgId}
        AND (${status ?? null}::text IS NULL OR bf.status = ${status ?? null})
      ORDER BY bf.created_at DESC
    `;
  }

  async getFormula(formulaId: number, orgId: string) {
    const [formula] = await this.sql`
      SELECT bf.*,
             json_agg(json_build_object(
               'rawMaterialId', fi.raw_material_id,
               'percentage', fi.percentage,
               'role', fi.role,
               'materialName', rm.name
             )) FILTER (WHERE fi.id IS NOT NULL) AS ingredients,
             c.display_name AS customer_name,
             p.display_name AS perfumer_name
      FROM bespoke_formulas bf
      LEFT JOIN formula_ingredients fi ON fi.formula_id = bf.id
      LEFT JOIN raw_materials rm ON rm.id = fi.raw_material_id
      LEFT JOIN customers c ON c.id = bf.customer_id
      LEFT JOIN users p ON p.id = bf.perfumer_id
      WHERE bf.id = ${formulaId} AND bf.organization_id = ${orgId}
      GROUP BY bf.id, c.display_name, p.display_name
    `;
    if (!formula) throw new NotFoundException('Formula not found');
    return formula;
  }

  async createFormula(dto: Record<string, unknown>, orgId: string) {
    const [formula] = await this.sql<{ id: number }[]>`
      INSERT INTO bespoke_formulas (
        organization_id, customer_id, name, status,
        concentration, target_volume_ml, notes, perfumer_id
      ) VALUES (
        ${orgId}, ${dto['customerId'] as string ?? null},
        ${dto['name'] as string}, 'concept',
        ${dto['concentration'] as number ?? 20},
        ${dto['targetVolumeMl'] as number ?? 50},
        ${dto['notes'] as string ?? null},
        ${dto['perfumerId'] as string ?? null}
      )
      RETURNING id
    `;
    return { formulaId: formula!.id };
  }

  async listBatches(orgId: string) {
    return this.sql`
      SELECT bp.id, bp.batch_number, bp.status, bp.planned_qty_ml,
             bp.actual_qty_ml, bp.bottles_filled, bp.created_at,
             bf.name AS formula_name
      FROM batch_provenance bp
      LEFT JOIN bespoke_formulas bf ON bf.id = bp.formula_id
      WHERE bp.organization_id = ${orgId}
      ORDER BY bp.created_at DESC
      LIMIT 50
    `;
  }

  async updateBatchStatus(batchId: number, status: string, orgId: string, userId: string) {
    await this.sql`
      UPDATE batch_provenance SET
        status = ${status}::batch_status,
        qc_approved_by = CASE WHEN ${status} = 'ready' THEN ${userId}::uuid ELSE qc_approved_by END,
        completed_at = CASE WHEN ${status} = 'ready' THEN now() ELSE completed_at END,
        updated_at = now()
      WHERE id = ${batchId} AND organization_id = ${orgId}
    `;
    return { batchId, status };
  }

  async getRawMaterials(orgId: string) {
    return this.sql`
      SELECT rm.id, rm.name, rm.inci_name, rm.unit, rm.cost_per_unit,
             rm.stock_kg, rm.reorder_kg, rm.is_restricted, rm.origin_country
      FROM raw_materials rm
      WHERE rm.organization_id = ${orgId} AND rm.is_restricted = FALSE
        OR rm.organization_id = ${orgId}
      ORDER BY rm.name
    `;
  }
}
