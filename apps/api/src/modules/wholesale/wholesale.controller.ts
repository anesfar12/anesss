// LUXE POS v5.1 — WholesaleController
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WholesaleService } from './wholesale.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/types/auth.types';

@ApiTags('Wholesale')
@Controller({ path: 'wholesale', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager', 'senior_sales')
@ApiBearerAuth()
export class WholesaleController {
  constructor(private readonly wholesale: WholesaleService) {}

  @Get('customers')
  @ApiOperation({ summary: 'List wholesale (B2B) customers' })
  customers(@OrgId() orgId: string) {
    return this.wholesale.listWholesaleCustomers(orgId);
  }

  @Get('orders')
  @ApiOperation({ summary: 'List wholesale orders' })
  orders(@OrgId() orgId: string, @Query('customerId') cid?: string, @Query('status') status?: string, @Query('limit') limit?: number) {
    return this.wholesale.listOrders(orgId, { customerId: cid, status, limit });
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get wholesale order detail with line items' })
  getOrder(@Param('id') id: string, @OrgId() orgId: string) {
    return this.wholesale.getOrder(Number(id), orgId);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create wholesale order' })
  createOrder(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.wholesale.createOrder(dto, orgId, user.sub);
  }

  @Patch('orders/:id/approve')
  @Roles('manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve wholesale order (manager only). Credit limit enforced by trigger.' })
  approveOrder(@Param('id') id: string, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.wholesale.approveOrder(Number(id), orgId, user.sub);
  }

  @Get('price-tiers')
  @ApiOperation({ summary: 'List wholesale discount tiers' })
  priceTiers(@OrgId() orgId: string) {
    return this.wholesale.listPriceTiers(orgId);
  }
}
