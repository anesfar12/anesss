// LUXE POS v5.1 — SpatialModule
// visionOS 3: USDZ physics delivery, GLB for WebXR, Cloudflare R2

import { Module } from '@nestjs/common';
import { Controller, Get, Param, Query, UseGuards, Res, NotFoundException, Injectable, Logger, Inject } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgId } from '../../common/decorators/current-user.decorator';
import { DB_TOKEN } from '../../config/database.module';
import { ConfigService } from '@nestjs/config';
import type postgres from 'postgres';
import type { Response } from 'express';

@Injectable()
export class SpatialService {
  private readonly logger = new Logger(SpatialService.name);
  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
    private readonly config: ConfigService,
  ) {}

  async getProductAsset(productId: string, assetType: string) {
    const [asset] = await this.sql`
      SELECT aa.cdn_url, aa.file_url, aa.physics_enabled
      FROM ar_assets aa JOIN products p ON p.id = aa.product_id
      WHERE p.id = ${productId} AND aa.asset_type = ${assetType} AND aa.is_active = TRUE LIMIT 1` as any[];
    if (asset) return { url: asset.cdn_url || asset.file_url, physicsEnabled: asset.physics_enabled };

    const [p] = await this.sql`
      SELECT ar_glb_url, ar_usdz_url, ar_usdz_physics_url, name FROM products WHERE id = ${productId} LIMIT 1` as any[];
    if (!p) throw new NotFoundException('Product not found');
    const url = assetType === 'glb' ? p.ar_glb_url : assetType === 'usdz_physics' ? p.ar_usdz_physics_url : p.ar_usdz_url;
    if (!url) throw new NotFoundException(`No ${assetType} asset for this product`);
    return { url, physicsEnabled: assetType === 'usdz_physics', productName: p.name };
  }

  async listProductAssets(productId: string) {
    return this.sql`
      SELECT id, asset_type, cdn_url, file_size_bytes, physics_enabled, created_at
      FROM ar_assets WHERE product_id = ${productId} AND is_active = TRUE ORDER BY asset_type`;
  }

  async getProductsWithAR(orgId: string, category?: string, limit = 50) {
    return this.sql`
      SELECT p.id, p.name, p.category, p.thumbnail_url, p.ar_glb_url, p.ar_usdz_url, p.ar_usdz_physics_url, b.name AS brand_name
      FROM products p LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.organization_id = ${orgId} AND p.status = 'active'
        AND (p.ar_glb_url IS NOT NULL OR p.ar_usdz_url IS NOT NULL)
        AND (${category ?? null} IS NULL OR p.category = ${category ?? null}::product_category)
      ORDER BY p.name LIMIT ${limit}`;
  }
}

@ApiTags('Spatial')
@Controller({ path: 'spatial', version: '1' })
export class SpatialController {
  constructor(private readonly spatial: SpatialService) {}

  @Get('products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List products with AR assets (GLB/USDZ/Physics-USDZ)' })
  list(@OrgId() orgId: string, @Query('category') cat?: string, @Query('limit') lim?: number) {
    return this.spatial.getProductsWithAR(orgId, cat, lim);
  }

  @Get('products/:id/glb')
  @ApiOperation({ summary: 'GLB redirect — Cloudflare R2 CDN (model-viewer / WebXR)' })
  async glb(@Param('id') id: string, @Res() res: Response) {
    const asset = await this.spatial.getProductAsset(id, 'glb');
    res.set('Content-Type', 'model/gltf-binary');
    res.set('Cache-Control', 'public, max-age=86400');
    res.redirect(302, asset.url);
  }

  @Get('products/:id/usdz')
  @ApiOperation({ summary: 'USDZ redirect — visionOS 3 Spatial Commerce. X-LUXE-Physics-Enabled header set.' })
  async usdz(@Param('id') id: string, @Query('physics') physics: string, @Res() res: Response) {
    const type = physics === 'true' ? 'usdz_physics' : 'usdz';
    const asset = await this.spatial.getProductAsset(id, type);
    res.set('Content-Type', 'model/vnd.usdz+zip');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-LUXE-Physics-Enabled', String(asset.physicsEnabled));
    res.redirect(302, asset.url);
  }

  @Get('products/:id/assets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  assets(@Param('id') id: string) { return this.spatial.listProductAssets(id); }
}

@Module({
  controllers: [SpatialController],
  providers: [SpatialService],
  exports: [SpatialService],
})
export class SpatialModule {}
