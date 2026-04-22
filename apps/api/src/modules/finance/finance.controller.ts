// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — FinanceController
// Revenue reports, VAT, Tax-Free Export (Global Blue/Planet)
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Get, Post, Body, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsDateString, MinLength } from 'class-validator';
import { FinanceService } from './finance.service';
import type { TaxFreeClaimDto } from './finance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, OrgId } from '../../common/decorators/current-user.decorator';

class CreateTaxFreeClaimBodyDto {
  @IsUUID() transactionId!: string;
  @IsUUID() customerId!: string;
  @IsString() @MinLength(2) nationality!: string;
  @IsDateString() flightDate!: string;
  @IsString() @MinLength(3) airportCode!: string;
}

@ApiTags('Finance')
@Controller({ path: 'finance', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('revenue/daily')
  @Roles('manager', 'accountant')
  @ApiOperation({ summary: 'Daily revenue summary' })
  daily(
    @OrgId() orgId: string,
    @Query('locationId') locationId?: string,
    @Query('date') date?: string,
  ) {
    return this.finance.getDailyRevenue(orgId, locationId, date);
  }

  @Get('revenue/period')
  @Roles('manager', 'accountant')
  @ApiOperation({ summary: 'Revenue by period (day/week/month)' })
  period(
    @OrgId() orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('groupBy') groupBy?: 'day' | 'week' | 'month',
  ) {
    return this.finance.getRevenueByPeriod(orgId, from, to, groupBy);
  }

  @Get('products/top')
  @Roles('manager', 'accountant')
  @ApiOperation({ summary: 'Top selling products by revenue' })
  topProducts(
    @OrgId() orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit = 10,
  ) {
    return this.finance.getTopProducts(orgId, from, to, Number(limit));
  }

  @Get('revenue/by-category')
  @Roles('manager', 'accountant')
  @ApiOperation({ summary: 'Revenue breakdown by product category' })
  byCategory(
    @OrgId() orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.finance.getRevenueByCategory(orgId, from, to);
  }

  @Get('tax-free')
  @Roles('manager', 'accountant', 'senior_sales', 'sales')
  @ApiOperation({ summary: 'List tax-free export claims (Global Blue / Planet)' })
  taxFree(@OrgId() orgId: string, @Query('status') status?: string) {
    return this.finance.listTaxFreeClaims(orgId, status);
  }

  @Post('tax-free')
  @HttpCode(HttpStatus.CREATED)
  @Roles('manager', 'senior_sales', 'sales')
  @ApiOperation({ summary: 'Create Global Blue tax-free export claim' })
  createClaim(@Body() dto: CreateTaxFreeClaimBodyDto, @OrgId() orgId: string) {
    const claimDto: TaxFreeClaimDto = { ...dto, orgId };
    return this.finance.createTaxFreeClaim(claimDto);
  }
}
