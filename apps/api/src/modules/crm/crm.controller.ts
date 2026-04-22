// LUXE POS v5.1 — CRMController
import { Controller, Get, Post, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CRMService } from './crm.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/types/auth.types';

@ApiTags('CRM')
@Controller({ path: 'crm', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CRMController {
  constructor(private readonly crm: CRMService) {}

  @Get('customers/due-outreach')
  @ApiOperation({ summary: 'Customers who haven't been contacted in 30+ days and have upcoming key dates' })
  dueOutreach(@OrgId() orgId: string, @Query('limit') limit?: number) {
    return this.crm.getCustomersDueOutreach(orgId, limit);
  }

  @Get('customers/vip-activity')
  @ApiOperation({ summary: 'Recent VIP customer activity feed — for staff briefing' })
  vipActivity(@OrgId() orgId: string, @Query('locationId') locationId?: string, @Query('limit') limit?: number) {
    return this.crm.getVIPActivityFeed(orgId, locationId, limit);
  }

  @Get('customers/key-dates')
  @ApiOperation({ summary: 'Customers with key dates (birthdays, anniversaries) this month' })
  keyDates(@OrgId() orgId: string) {
    return this.crm.getKeyDatesThisMonth(orgId);
  }

  @Post('outreach/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatch bulk outreach to multiple customers via selected channel' })
  bulkOutreach(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.crm.bulkOutreach(dto as Parameters<typeof this.crm.bulkOutreach>[0], orgId, user.sub);
  }

  @Get('outreach/stats')
  @ApiOperation({ summary: 'Outreach delivery statistics by channel for a period' })
  outreachStats(@OrgId() orgId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.crm.getOutreachStats(orgId, from, to);
  }
}
