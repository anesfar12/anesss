// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — CustomersController
// /customers | /customers/:id/black-book | /customers/:id/scent-wardrobe
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

@ApiTags('Customers')
@Controller({ path: 'customers', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  // GET /api/v1/customers?q=search
  @Get()
  @ApiOperation({ summary: 'Search customers by name, phone, email' })
  async search(
    @OrgId() orgId: string,
    @Query('q') q = '',
    @Query('limit') limit?: number,
  ) {
    return this.customers.searchCustomers(orgId, q, limit);
  }

  // GET /api/v1/customers/:id
  @Get(':id')
  @ApiOperation({ summary: 'Get customer profile' })
  async get(@Param('id') id: string, @OrgId() orgId: string) {
    return this.customers.getCustomer(id, orgId);
  }

  // POST /api/v1/customers
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new customer' })
  async create(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.customers.createCustomer(dto as Parameters<typeof this.customers.createCustomer>[0], orgId, user.sub);
  }

  // GET /api/v1/customers/:id/black-book
  @Get(':id/black-book')
  @ApiOperation({ summary: 'Get Digital Black Book (Section 8.2 — all fields)' })
  async getBlackBook(@Param('id') id: string, @OrgId() orgId: string) {
    return this.customers.getBlackBook(id, orgId);
  }

  // PUT /api/v1/customers/:id/black-book
  @Put(':id/black-book')
  @ApiOperation({ summary: 'Update Digital Black Book (partial update — COALESCE on all fields)' })
  async updateBlackBook(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customers.updateBlackBook(
      id,
      dto as Parameters<typeof this.customers.updateBlackBook>[1],
      orgId,
      user.sub,
    );
  }

  // GET /api/v1/customers/:id/scent-wardrobe
  @Get(':id/scent-wardrobe')
  @ApiOperation({ summary: 'Get Scent Wardrobe (OR-Set CRDT — all non-removed entries)' })
  async getWardrobe(@Param('id') id: string, @OrgId() orgId: string) {
    return this.customers.getScentWardrobe(id, orgId);
  }

  // PUT /api/v1/customers/:id/scent-wardrobe
  @Put(':id/scent-wardrobe')
  @ApiOperation({ summary: 'Add entry to Scent Wardrobe (OR-Set CRDT — gets unique tag)' })
  async addToWardrobe(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @OrgId() orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customers.addToWardrobe(
      id,
      dto as Parameters<typeof this.customers.addToWardrobe>[1],
      orgId,
      user.sub,
    );
  }

  // DELETE /api/v1/customers/:id/scent-wardrobe/:entryId
  @Delete(':id/scent-wardrobe/:entryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove from Scent Wardrobe (soft-delete OR-Set semantics)' })
  async removeFromWardrobe(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @OrgId() orgId: string,
  ) {
    return this.customers.removeFromWardrobe(id, entryId, orgId);
  }

  // GET /api/v1/customers/:id/transactions
  @Get(':id/transactions')
  @ApiOperation({ summary: 'Customer purchase history' })
  async transactions(
    @Param('id') id: string,
    @OrgId() orgId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.customers.getTransactionHistory(id, orgId, limit, offset);
  }
}
