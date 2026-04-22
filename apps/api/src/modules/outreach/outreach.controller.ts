import { Controller, Get, Post, Body, Query, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OutreachService } from './outreach.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

@ApiTags('Outreach')
@Controller({ path: 'outreach', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OutreachController {
  constructor(private readonly outreach: OutreachService) {}

  @Get('due')
  @ApiOperation({ summary: 'List due outreach items (set by pg_cron luxe-mark-due-outreach)' })
  due(@OrgId() orgId: string, @Query('limit') limit?: number) {
    return this.outreach.listDueOutreach(orgId, limit);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Schedule outreach for a customer' })
  schedule(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.outreach.scheduleOutreach({ ...dto as any, orgId, staffId: user.sub });
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatch a single outreach item via WhatsApp/SMS/Email' })
  dispatch(@Param('id') id: string) {
    return this.outreach.dispatch(Number(id));
  }

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an outreach campaign' })
  createCampaign(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.outreach.createCampaign({ ...dto as any, orgId, createdBy: user.sub });
  }

  @Post('payment-links')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payment link for WhatsApp/email checkout' })
  createLink(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @CurrentUser() user: JwtPayload) {
    return this.outreach.createPaymentLink({ ...dto as any, orgId, staffId: user.sub });
  }
}
