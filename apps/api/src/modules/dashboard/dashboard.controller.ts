// LUXE POS v5.1 — DashboardController
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, OrgId } from '../../common/decorators/current-user.decorator';

@ApiTags('Dashboard')
@Controller({ path: 'dashboard', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @Roles('manager')
  @ApiOperation({ summary: 'Dashboard overview — daily/monthly revenue, inventory, pending actions. <1s via pre-aggregated data.' })
  overview(@OrgId() orgId: string, @Query('locationId') loc?: string) {
    return this.dashboard.getOverview(orgId, loc);
  }

  @Get('staff')
  @Roles('manager')
  @ApiOperation({ summary: 'Staff performance by period (daily/weekly/monthly)' })
  staff(@OrgId() orgId: string, @Query('period') period?: string, @Query('locationId') loc?: string) {
    return this.dashboard.getStaffPerformance(orgId, period ?? 'daily', loc);
  }

  @Get('customers')
  @Roles('manager')
  @ApiOperation({ summary: 'Customer insights — tier breakdown, LTV, active customers' })
  customers(@OrgId() orgId: string) {
    return this.dashboard.getCustomerInsights(orgId);
  }

  @Get('locations')
  @Roles('manager')
  @ApiOperation({ summary: 'Real-time location activity — open transactions, revenue, active staff' })
  locations(@OrgId() orgId: string) {
    return this.dashboard.getLocationActivity(orgId);
  }
}
