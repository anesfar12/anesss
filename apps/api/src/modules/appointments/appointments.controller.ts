// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — AppointmentsController
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgId } from '../../common/decorators/current-user.decorator';

@ApiTags('Appointments')
@Controller({ path: 'appointments', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AppointmentsController {
  constructor(private readonly appts: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List appointments with filters' })
  list(
    @OrgId() orgId: string,
    @Query('staffId') staffId?: string,
    @Query('locationId') locationId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
  ) {
    return this.appts.listAppointments(orgId, { staffId, locationId, customerId, status, from, to, limit });
  }

  @Get('calendar/:locationId')
  @ApiOperation({ summary: 'Calendar view for a location — all upcoming appointments' })
  calendar(
    @Param('locationId') locationId: string,
    @OrgId() orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.appts.getCalendar(locationId, orgId, from, to);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get appointment detail' })
  get(@Param('id') id: string, @OrgId() orgId: string) {
    return this.appts.getAppointment(Number(id), orgId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Book a new appointment. Checks staff availability for conflicts.' })
  create(@Body() dto: Record<string, unknown>, @OrgId() orgId: string, @Query('staffId') staffId?: string) {
    return this.appts.createAppointment(dto as Parameters<typeof this.appts.createAppointment>[0], orgId, staffId ?? '');
  }

  @Patch(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm appointment (assign staff if not already assigned)' })
  confirm(@Param('id') id: string, @Body('staffId') staffId: string, @OrgId() orgId: string) {
    return this.appts.confirmAppointment(Number(id), staffId, orgId);
  }

  @Patch(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark appointment complete with outcome notes and linked transaction' })
  complete(@Param('id') id: string, @Body() dto: Record<string, unknown>, @OrgId() orgId: string) {
    return this.appts.completeAppointment(Number(id), dto as Parameters<typeof this.appts.completeAppointment>[1], orgId);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel appointment' })
  cancel(@Param('id') id: string, @OrgId() orgId: string) {
    return this.appts.cancelAppointment(Number(id), orgId);
  }
}
