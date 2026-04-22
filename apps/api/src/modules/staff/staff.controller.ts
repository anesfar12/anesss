// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — StaffController
// Full CRUD + performance KPIs + commission history + targets
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/types/auth.types';

@ApiTags('Staff')
@Controller({ path: 'staff', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  // GET /api/v1/staff
  @Get()
  @UseGuards(RolesGuard)
  @Roles('manager')
  @ApiOperation({ summary: 'List all staff with today performance summary' })
  list(@OrgId() orgId: string, @Query('locationId') locationId?: string) {
    return this.staff.listStaff(orgId, locationId);
  }

  // GET /api/v1/staff/:id
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('manager')
  @ApiOperation({ summary: 'Get staff member profile' })
  get(@Param('id') id: string, @OrgId() orgId: string) {
    return this.staff.getStaff(id, orgId);
  }

  // POST /api/v1/staff
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles('manager')
  @ApiOperation({ summary: 'Create new staff member' })
  create(@Body() dto: Record<string, unknown>, @OrgId() orgId: string) {
    return this.staff.createStaff(dto as Parameters<typeof this.staff.createStaff>[0], orgId);
  }

  // PATCH /api/v1/staff/:id
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('manager')
  @ApiOperation({ summary: 'Update staff member details' })
  update(@Param('id') id: string, @Body() dto: Record<string, unknown>, @OrgId() orgId: string) {
    return this.staff.updateStaff(id, dto as Parameters<typeof this.staff.updateStaff>[1], orgId);
  }

  // PATCH /api/v1/staff/:id/pin
  @Patch(':id/pin')
  @UseGuards(RolesGuard)
  @Roles('manager')
  @ApiOperation({ summary: 'Reset staff PIN (manager only)' })
  resetPin(@Param('id') id: string, @Body('pin') pin: string, @OrgId() orgId: string) {
    return this.staff.resetPin(id, pin, orgId);
  }

  // GET /api/v1/staff/:id/performance
  @Get(':id/performance')
  @ApiOperation({ summary: 'Get performance KPIs for period (daily/weekly/monthly)' })
  @ApiQuery({ name: 'period', enum: ['daily', 'weekly', 'monthly'], required: false })
  performance(
    @Param('id') id: string,
    @OrgId() orgId: string,
    @Query('period') period?: 'daily' | 'weekly' | 'monthly',
  ) {
    return this.staff.getPerformance(id, orgId, period);
  }

  // GET /api/v1/staff/:id/commissions
  @Get(':id/commissions')
  @ApiOperation({ summary: 'Commission payout history' })
  commissions(@Param('id') id: string, @OrgId() orgId: string, @Query('limit') limit?: number) {
    return this.staff.getCommissions(id, orgId, limit);
  }

  // PATCH /api/v1/staff/:id/target
  @Patch(':id/target')
  @UseGuards(RolesGuard)
  @Roles('manager')
  @ApiOperation({ summary: 'Set monthly sales target for staff member' })
  setTarget(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staff.setTarget(id, dto as Parameters<typeof this.staff.setTarget>[1], orgId, user.sub);
  }

  // DELETE /api/v1/staff/:id
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete staff member (super_admin/admin only). Revokes all sessions.' })
  delete(@Param('id') id: string, @OrgId() orgId: string) {
    return this.staff.deleteStaff(id, orgId);
  }
}
