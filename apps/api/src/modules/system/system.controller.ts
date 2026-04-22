// LUXE POS v5.1 — SystemController
import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SystemService } from './system.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, OrgId } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/current-user.decorator';

@ApiTags('System')
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly auth: AuthService,
  ) {}

  // GET /api/v1/system/health (public — used by Docker HEALTHCHECK and Render)
  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Full system health check — DB, devices, CRDT queue' })
  health(@OrgId() orgId: string) {
    return this.system.getHealth(orgId ?? 'health');
  }

  // GET /api/v1/system/audit-log
  @Get('audit-log')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Audit log — partitioned table, manager+ only' })
  auditLog(
    @OrgId() orgId: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
  ) {
    return this.system.getAuditLog(orgId, { userId, action, from, to, limit });
  }

  // GET /api/v1/system/devices
  @Get('devices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all POS devices — approved and pending' })
  devices(@OrgId() orgId: string) {
    return this.system.listDevices(orgId);
  }

  // POST /api/v1/system/devices/:id/approve
  @Post('devices/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a new POS device for use (Security Layer 5)' })
  async approveDevice(@Param('id') deviceId: string, @OrgId() orgId: string, @Query('managerId') managerId: string) {
    await this.auth.approveDevice(deviceId, managerId);
    return { approved: true, deviceId };
  }

  // POST /api/v1/telemetry/diffuser
  @Post('/telemetry/diffuser')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'IoT webhook receiver for smart diffuser status updates' })
  diffuserWebhook(@Body() payload: Record<string, unknown>, @OrgId() orgId: string) {
    return this.system.processDiffuserWebhook(payload, orgId);
  }
}
