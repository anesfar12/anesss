// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — PaymentsController
// Gift cards, loyalty redemption, cash session management
// Bluepring Section 14: /payments/* endpoints
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import {
  IssueGiftCardDto,
  RedeemGiftCardDto,
  RedeemLoyaltyDto,
  OpenCashSessionDto,
  CloseCashSessionDto,
} from './dto/payments.dto';

@ApiTags('Payments')
@Controller({ path: 'payments', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ── Gift Cards ──────────────────────────────────────────────────────────

  // POST /api/v1/payments/gift-cards
  @Post('gift-cards')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin', 'manager', 'senior_sales', 'sales', 'cashier')
  @ApiOperation({
    summary: 'Issue a new gift card',
    description: 'Generates a unique masked code (LUXE-XXXX-XXXX-XXXX) with bcrypt-hashed raw code for PCI compliance.',
  })
  issueGiftCard(
    @Body() dto: IssueGiftCardDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.issueGiftCard(dto, orgId, user.sub);
  }

  // GET /api/v1/payments/gift-cards/:code/balance
  @Get('gift-cards/:code/balance')
  @ApiOperation({ summary: 'Get gift card balance by masked code' })
  @ApiParam({ name: 'code', description: 'Masked gift card code e.g. LUXE-ABCD-EFGH-JKMN' })
  getGiftCardBalance(
    @Param('code') code: string,
    @OrgId() orgId: string,
  ) {
    return this.payments.getGiftCardBalance(code, orgId);
  }

  // POST /api/v1/payments/gift-cards/:code/redeem
  @Post('gift-cards/:code/redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redeem gift card against a transaction',
    description: 'Deducts amount from gift card balance and inserts a payment record. Fails if balance insufficient.',
  })
  @ApiParam({ name: 'code', description: 'Masked gift card code' })
  redeemGiftCard(
    @Param('code') code: string,
    @Body() dto: RedeemGiftCardDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Ensure code in path matches body for safety
    const redeemDto = { ...dto, code };
    return this.payments.redeemGiftCard(redeemDto, orgId, user.sub);
  }

  // ── Loyalty Points ──────────────────────────────────────────────────────

  // GET /api/v1/payments/loyalty/:customerId/balance
  @Get('loyalty/:customerId/balance')
  @ApiOperation({ summary: 'Get customer loyalty point balance and AED equivalent' })
  @ApiParam({ name: 'customerId', description: 'Customer UUID' })
  getLoyaltyBalance(
    @Param('customerId') customerId: string,
    @OrgId() orgId: string,
  ) {
    return this.payments.getLoyaltyBalance(customerId, orgId);
  }

  // GET /api/v1/payments/loyalty/:customerId/history
  @Get('loyalty/:customerId/history')
  @ApiOperation({ summary: 'Get loyalty transaction history for a customer' })
  getLoyaltyHistory(
    @Param('customerId') customerId: string,
    @OrgId() orgId: string,
    @Query('limit') limit?: number,
  ) {
    return this.payments.getLoyaltyHistory(customerId, orgId, limit);
  }

  // POST /api/v1/payments/loyalty/redeem
  @Post('loyalty/redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redeem loyalty points as payment (100 pts = AED 1.00)',
    description: 'Deducts points from customer, inserts payment record, logs loyalty_transaction.',
  })
  redeemLoyalty(
    @Body() dto: RedeemLoyaltyDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.redeemLoyaltyPoints(dto, orgId, user.sub);
  }

  // ── Cash Sessions ───────────────────────────────────────────────────────

  // GET /api/v1/payments/cash-sessions
  @Get('cash-sessions')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin', 'manager', 'accountant')
  @ApiOperation({ summary: 'List cash sessions with optional filters' })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'status', enum: ['open', 'closed'], required: false })
  listCashSessions(
    @OrgId() orgId: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: string,
  ) {
    return this.payments.listCashSessions(orgId, locationId, status);
  }

  // GET /api/v1/payments/cash-sessions/active
  @Get('cash-sessions/active')
  @ApiOperation({ summary: 'Get active cash session for a location' })
  @ApiQuery({ name: 'locationId', required: true })
  getActiveCashSession(
    @OrgId() orgId: string,
    @Query('locationId') locationId: string,
  ) {
    return this.payments.getActiveCashSession(orgId, locationId);
  }

  // POST /api/v1/payments/cash-sessions
  @Post('cash-sessions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin', 'manager', 'senior_sales', 'cashier')
  @ApiOperation({
    summary: 'Open a cash session (float management)',
    description: 'Creates a new cash session for a location. Prevents double-open on same location/device.',
  })
  openCashSession(
    @Body() dto: OpenCashSessionDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.openCashSession(dto, orgId, user.sub);
  }

  // PATCH /api/v1/payments/cash-sessions/:id/close
  @Patch('cash-sessions/:id/close')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin', 'manager', 'senior_sales', 'cashier')
  @ApiOperation({
    summary: 'Close a cash session with physical count',
    description: 'Records closing count, calculates variance vs expected. Logs warning if variance > AED 10.',
  })
  @ApiParam({ name: 'id', description: 'Cash session UUID' })
  closeCashSession(
    @Param('id') sessionId: string,
    @Body() dto: CloseCashSessionDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.closeCashSession(sessionId, dto, orgId, user.sub);
  }
}
