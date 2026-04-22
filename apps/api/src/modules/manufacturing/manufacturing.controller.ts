// LUXE POS v5.1 — ManufacturingController
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ManufacturingService } from './manufacturing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/types/auth.types';

@ApiTags('Manufacturing')
@Controller({ path: 'manufacturing', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
@ApiBearerAuth()
export class ManufacturingController {
  constructor(private readonly manufacturing: ManufacturingService) {}

  @Get('formulas')
  @ApiOperation({ summary: 'List bespoke formulas' })
  formulas(@OrgId() orgId: string, @Query('status') status?: string) {
    return this.manufacturing.listFormulas(orgId, status);
  }

  @Get('formulas/:id')
  @ApiOperation({ summary: 'Get formula with ingredient breakdown' })
  getFormula(@Param('id') id: string, @OrgId() orgId: string) {
    return this.manufacturing.getFormula(Number(id), orgId);
  }

  @Post('formulas')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create bespoke formula' })
  createFormula(@Body() dto: Record<string, unknown>, @OrgId() orgId: string) {
    return this.manufacturing.createFormula(dto, orgId);
  }

  @Get('batches')
  @ApiOperation({ summary: 'List production batches' })
  batches(@OrgId() orgId: string) {
    return this.manufacturing.listBatches(orgId);
  }

  @Patch('batches/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update batch production status' })
  updateBatch(@Param('id') id: string, @Body('status') status: string, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.manufacturing.updateBatchStatus(Number(id), status, orgId, user.sub);
  }

  @Get('raw-materials')
  @ApiOperation({ summary: 'List raw material inventory' })
  rawMaterials(@OrgId() orgId: string) {
    return this.manufacturing.getRawMaterials(orgId);
  }
}
