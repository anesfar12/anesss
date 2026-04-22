// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — HardwareController
// POST /hardware/nfc/validate | POST /hardware/softpos/initiate
// ═══════════════════════════════════════════════════════════════════════════

import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsString, IsUUID, IsNumber, IsOptional } from 'class-validator';
import { HardwareService } from './hardware.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, OrgId, DeviceId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

class NfcValidateDto {
  @IsString()
  sunMessage!: string;

  @IsString()
  bottleId!: string;
}

class SoftPosInitiateDto {
  @IsNumber()
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsUUID()
  transactionId!: string;

  @IsString()
  idempotencyKey!: string;
}

class RegisterChipDto {
  @IsUUID()
  productVariantId!: string;

  @IsString()
  bottleId!: string;

  @IsString()
  chipUid!: string;

  @IsString()
  batchNumber!: string;

  @IsString()
  hmacKeyId!: string;
}

@ApiTags('Hardware')
@Controller({ path: 'hardware', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HardwareController {
  constructor(private readonly hardware: HardwareService) {}

  // POST /api/v1/hardware/nfc/validate
  @Post('nfc/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate NFC NTAG 424 DNA bottle (Section 8.3). SLA: <200ms. Detects replay attacks + counterfeit.',
  })
  @ApiResponse({ status: 200, description: 'Validation result with fraud signal' })
  async validateNfc(
    @Body() dto: NfcValidateDto,
    @CurrentUser() user: JwtPayload,
    @OrgId() orgId: string,
    @DeviceId() deviceId: string,
  ) {
    return this.hardware.validateNfcBottle({
      sunMessage: dto.sunMessage,
      bottleId: dto.bottleId,
      deviceId: deviceId ?? 'unknown',
      staffId: user.sub,
      locationId: user.loc ?? '',
      organizationId: orgId,
    });
  }

  // POST /api/v1/hardware/softpos/initiate
  @Post('softpos/initiate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate Tap to Pay SoftPOS payment — iPad/iPhone (no hardware terminal)' })
  async initiateSoftPos(
    @Body() dto: SoftPosInitiateDto,
    @CurrentUser() user: JwtPayload,
    @OrgId() orgId: string,
    @DeviceId() deviceId: string,
  ) {
    return this.hardware.initiateSoftPos({
      organizationId: orgId,
      locationId: user.loc ?? '',
      deviceId: deviceId ?? '',
      staffId: user.sub,
      amount: dto.amount,
      currency: dto.currency ?? 'AED',
      transactionId: dto.transactionId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  // POST /api/v1/hardware/nfc/register
  @Post('nfc/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new NFC chip in the bottle registry (stockroom+)' })
  async registerChip(
    @Body() dto: RegisterChipDto,
    @OrgId() orgId: string,
  ) {
    return this.hardware.registerBottleChip({ ...dto, organizationId: orgId });
  }
}
