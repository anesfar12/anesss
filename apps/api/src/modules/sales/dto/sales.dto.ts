// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Sales DTOs
// ═══════════════════════════════════════════════════════════════════════════

import {
  IsString, IsUUID, IsOptional, IsNumber, IsArray, IsEnum,
  ValidateNested, Min, IsPositive, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentLineDto {
  @IsString()
  method!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  providerReference?: string;

  @IsString()
  @IsOptional()
  terminalId?: string;
}

export class CreateTransactionDto {
  @IsUUID()
  locationId!: string;

  @IsUUID()
  @IsOptional()
  deviceId?: string;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  channel?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  deliveryMethod?: string;

  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class AddItemDto {
  @IsUUID()
  productVariantId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @IsOptional()
  overridePrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountPercent?: number;

  @IsString()
  @IsOptional()
  nfcBottleId?: string;

  @IsString()
  @IsOptional()
  sunMessage?: string;

  @IsString()
  @IsOptional()
  deviceId?: string;

  @IsObject()
  @IsOptional()
  customization?: Record<string, unknown>;

  @IsNumber()
  @IsOptional()
  engravingPrice?: number;
}

export class CompleteTransactionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentLineDto)
  payments!: PaymentLineDto[];

  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @IsString()
  @IsOptional()
  staffNote?: string;
}

export class VoidTransactionDto {
  @IsString()
  reason!: string;
}

export class CrdtDeltaDto {
  @IsString()
  documentType!: string;

  @IsUUID()
  documentId!: string;

  @IsString()
  deltaType!: string;

  @IsObject()
  deltaPayload!: Record<string, unknown>;

  @IsNumber()
  vectorClock!: number;
}

export class ApplyCrdtDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrdtDeltaDto)
  deltas!: CrdtDeltaDto[];
}
