// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — InventoryModule + Service + Controller
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsUUID, IsNumber, IsString, IsOptional, Min, IsEnum } from 'class-validator';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

// ── DTOs ─────────────────────────────────────────────────────────────────

class AdjustStockDto {
  @IsUUID() productVariantId!: string;
  @IsUUID() locationId!: string;
  @IsNumber() qtyChange!: number;
  @IsString() reason!: string;
  @IsString() @IsOptional() notes?: string;
}

class TransferStockDto {
  @IsUUID() productVariantId!: string;
  @IsUUID() fromLocationId!: string;
  @IsUUID() toLocationId!: string;
  @IsNumber() @Min(1) quantity!: number;
  @IsString() @IsOptional() notes?: string;
}

// ── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  async listInventory(orgId: string, filters: {
    locationId?: string; variantId?: string; lowStock?: boolean; limit?: number; offset?: number;
  }) {
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    return this.sql`
      SELECT
        i.id, i.product_variant_id, i.location_id,
        i.quantity_on_hand, i.quantity_reserved, i.quantity_available,
        i.quantity_incoming, i.reorder_point, i.bin_location, i.updated_at,
        pv.sku, pv.name AS variant_name, pv.retail_price,
        p.name AS product_name, p.category,
        b.name AS brand_name,
        l.name AS location_name
      FROM inventory i
      JOIN product_variants pv ON pv.id = i.product_variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN brands b ON b.id = p.brand_id
      JOIN locations l ON l.id = i.location_id
      WHERE i.organization_id = ${orgId}
        AND (${filters.locationId ?? null}::uuid IS NULL OR i.location_id = ${filters.locationId ?? null})
        AND (${filters.variantId ?? null}::uuid IS NULL OR i.product_variant_id = ${filters.variantId ?? null})
        AND (${filters.lowStock !== true} OR i.quantity_available <= i.reorder_point)
      ORDER BY p.name, pv.name
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async getStockLevel(productVariantId: string, locationId: string, orgId: string) {
    const [row] = await this.sql`
      SELECT i.*, pv.sku, pv.name AS variant_name, pv.retail_price,
             p.name AS product_name
      FROM inventory i
      JOIN product_variants pv ON pv.id = i.product_variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE i.product_variant_id = ${productVariantId}
        AND i.location_id = ${locationId}
        AND i.organization_id = ${orgId}
    `;
    if (!row) throw new NotFoundException('Inventory record not found');
    return row;
  }

  async adjustStock(dto: AdjustStockDto & { organizationId: string; userId: string }) {
    // Fetch current qty
    const [current] = await this.sql<{ id: string; quantityOnHand: number }[]>`
      SELECT id, quantity_on_hand FROM inventory
      WHERE product_variant_id = ${dto.productVariantId}
        AND location_id = ${dto.locationId}
        AND organization_id = ${dto.organizationId}
      FOR UPDATE
    `;

    if (!current) throw new NotFoundException('Inventory record not found');

    const newQty = Math.max(0, current.quantityOnHand + dto.qtyChange);

    await this.sql.begin(async (sql) => {
      await sql`
        UPDATE inventory SET
          quantity_on_hand = ${newQty}, updated_at = now()
        WHERE id = ${current.id}
      `;
      await sql`
        INSERT INTO inventory_adjustments (
          organization_id, product_variant_id, location_id,
          adjusted_by, reason, qty_before, qty_change, qty_after, notes
        ) VALUES (
          ${dto.organizationId}, ${dto.productVariantId}, ${dto.locationId},
          ${dto.userId}, ${dto.reason}, ${current.quantityOnHand},
          ${dto.qtyChange}, ${newQty}, ${dto.notes ?? null}
        )
      `;
    });

    return { productVariantId: dto.productVariantId, locationId: dto.locationId, newQty };
  }

  async transferStock(dto: TransferStockDto & { organizationId: string; userId: string }) {
    await this.sql.begin(async (sql) => {
      // Advisory lock on both locations
      await sql`SELECT pg_advisory_xact_lock(hashtext('inv:' || ${dto.productVariantId} || ':' || ${dto.fromLocationId}))`;
      await sql`SELECT pg_advisory_xact_lock(hashtext('inv:' || ${dto.productVariantId} || ':' || ${dto.toLocationId}))`;

      // Verify source stock
      const [source] = await sql<{ quantityOnHand: number }[]>`
        SELECT quantity_on_hand FROM inventory
        WHERE product_variant_id = ${dto.productVariantId} AND location_id = ${dto.fromLocationId}
        FOR UPDATE
      `;
      if (!source || source.quantityOnHand < dto.quantity) {
        throw new Error(`Insufficient stock for transfer: have ${source?.quantityOnHand ?? 0}`);
      }

      // Deduct from source
      await sql`
        UPDATE inventory SET quantity_on_hand = quantity_on_hand - ${dto.quantity}, updated_at = now()
        WHERE product_variant_id = ${dto.productVariantId} AND location_id = ${dto.fromLocationId}
      `;
      // Add to destination (upsert)
      await sql`
        INSERT INTO inventory (organization_id, product_variant_id, location_id, quantity_on_hand)
        VALUES (${dto.organizationId}, ${dto.productVariantId}, ${dto.toLocationId}, ${dto.quantity})
        ON CONFLICT (product_variant_id, location_id) DO UPDATE
          SET quantity_on_hand = inventory.quantity_on_hand + ${dto.quantity}, updated_at = now()
      `;
    });

    return { transferred: true, quantity: dto.quantity };
  }

  async getLowStockAlerts(orgId: string, locationId?: string) {
    return this.sql`
      SELECT
        i.product_variant_id, i.location_id, i.quantity_available,
        i.reorder_point, i.reorder_quantity,
        pv.sku, pv.name AS variant_name,
        p.name AS product_name,
        l.name AS location_name
      FROM inventory i
      JOIN product_variants pv ON pv.id = i.product_variant_id
      JOIN products p ON p.id = pv.product_id
      JOIN locations l ON l.id = i.location_id
      WHERE i.organization_id = ${orgId}
        AND i.quantity_available <= i.reorder_point
        AND (${locationId ?? null}::uuid IS NULL OR i.location_id = ${locationId ?? null})
      ORDER BY i.quantity_available ASC
    `;
  }
}

// ── Controller ────────────────────────────────────────────────────────────

@ApiTags('Inventory')
@Controller({ path: 'inventory', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List inventory levels with filters' })
  async list(
    @OrgId() orgId: string,
    @Query('locationId') locationId?: string,
    @Query('variantId') variantId?: string,
    @Query('lowStock') lowStock?: boolean,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.inventory.listInventory(orgId, { locationId, variantId, lowStock, limit, offset });
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Get items at or below reorder point' })
  async lowStock(@OrgId() orgId: string, @Query('locationId') locationId?: string) {
    return this.inventory.getLowStockAlerts(orgId, locationId);
  }

  @Get(':variantId/:locationId')
  @ApiOperation({ summary: 'Get stock level for specific variant at location' })
  async getLevel(
    @Param('variantId') variantId: string,
    @Param('locationId') locationId: string,
    @OrgId() orgId: string,
  ) {
    return this.inventory.getStockLevel(variantId, locationId, orgId);
  }

  @Patch('adjust')
  @UseGuards(RolesGuard)
  @Roles('manager', 'stockroom')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manual stock adjustment (manager/stockroom only)' })
  async adjust(@Body() dto: AdjustStockDto, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.inventory.adjustStock({ ...dto, organizationId: orgId, userId: user.sub });
  }

  @Post('transfer')
  @UseGuards(RolesGuard)
  @Roles('manager', 'stockroom')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer stock between locations' })
  async transfer(@Body() dto: TransferStockDto, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.inventory.transferStock({ ...dto, organizationId: orgId, userId: user.sub });
  }
}

// ── Module ────────────────────────────────────────────────────────────────

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
