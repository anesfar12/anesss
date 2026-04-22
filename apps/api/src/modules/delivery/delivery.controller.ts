// LUXE POS v5.1 — DeliveryController
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/types/auth.types';

@ApiTags('Delivery')
@Controller({ path: 'delivery', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  @ApiOperation({ summary: 'List white-glove deliveries with filters' })
  list(@OrgId() orgId: string, @Query('status') status?: string, @Query('staffId') staffId?: string, @Query('limit') limit?: number) {
    return this.delivery.listDeliveries(orgId, { status, staffId, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get delivery detail with tracking history' })
  get(@Param('id') id: string, @OrgId() orgId: string) {
    return this.delivery.getDelivery(Number(id), orgId);
  }

  @Get('track/:code')
  @ApiOperation({ summary: 'Get delivery by tracking code' })
  track(@Param('code') code: string, @OrgId() orgId: string) {
    return this.delivery.getTracking(code, orgId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create white-glove delivery order' })
  create(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.delivery.createDelivery(dto, orgId, user.sub);
  }

  @Patch(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark delivery as dispatched with courier info' })
  dispatch(@Param('id') id: string, @Body() dto: Record<string, unknown>, @OrgId() orgId: string) {
    return this.delivery.dispatchDelivery(Number(id), dto, orgId);
  }

  @Post(':id/pod')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit proof of delivery (photo URL + signature)' })
  pod(@Param('id') id: string, @Body() dto: Record<string, unknown>, @OrgId() orgId: string) {
    return this.delivery.markDelivered(Number(id), dto, orgId);
  }
}
