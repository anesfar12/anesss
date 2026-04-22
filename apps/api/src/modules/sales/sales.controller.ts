// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — SalesController
// GET/POST /transactions | PATCH /transactions/:id/complete | CRDT sync
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus, Headers,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, OrgId, DeviceId, IdempotencyKey } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import {
  CreateTransactionDto, AddItemDto, CompleteTransactionDto,
  VoidTransactionDto, ApplyCrdtDto,
} from './dto/sales.dto';

@ApiTags('Sales')
@Controller({ path: 'transactions', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // GET /api/v1/transactions
  @Get()
  @ApiOperation({ summary: 'List transactions with filters' })
  async list(
    @OrgId() orgId: string,
    @Query('locationId') locationId?: string,
    @Query('staffId') staffId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.sales.listTransactions(orgId, { locationId, staffId, customerId, status, from, to, limit, offset });
  }

  // GET /api/v1/transactions/:id
  @Get(':id')
  @ApiOperation({ summary: 'Get transaction detail with items and payments' })
  async get(@Param('id') id: string, @OrgId() orgId: string) {
    return this.sales.getTransaction(id, orgId);
  }

  // POST /api/v1/transactions
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a draft transaction (start of checkout)' })
  async create(
    @Body() dto: CreateTransactionDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
    @IdempotencyKey() ikey?: string,
  ) {
    return this.sales.createTransaction({ ...dto, idempotencyKey: ikey }, orgId, user.sub);
  }

  // POST /api/v1/transactions/:id/items
  @Post(':id/items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add line item to transaction. NFC validated inline for >AED 500 bottles.' })
  async addItem(
    @Param('id') transactionId: string,
    @Body() dto: AddItemDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sales.addItem(transactionId, dto, orgId, user.sub);
  }

  // PATCH /api/v1/transactions/:id/complete
  @Patch(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete checkout. <500ms SLA. Passport minting is async (Fix 4).' })
  async complete(
    @Param('id') transactionId: string,
    @Body() dto: CompleteTransactionDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
    @IdempotencyKey() ikey?: string,
  ) {
    return this.sales.completeTransaction(transactionId, { ...dto, idempotencyKey: ikey }, orgId, user.sub);
  }

  // PATCH /api/v1/transactions/:id/void
  @Patch(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void a draft/pending transaction. Restores inventory via trigger.' })
  async void(
    @Param('id') transactionId: string,
    @Body() dto: VoidTransactionDto,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sales.voidTransaction(transactionId, dto, orgId, user.sub);
  }

  // POST /api/v1/transactions/crdt/sync
  @Post('crdt/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply CRDT deltas from offline POS terminals. Fix 2: applied in pg18 transaction with advisory lock.' })
  async syncCrdt(
    @Body() dto: ApplyCrdtDto,
    @OrgId() orgId: string,
    @DeviceId() deviceId: string,
  ) {
    return this.sales.applyCrdtDeltas(dto.deltas, orgId, deviceId ?? 'unknown');
  }
}
