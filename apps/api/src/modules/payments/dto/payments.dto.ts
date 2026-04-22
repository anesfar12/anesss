// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Payments DTOs
// Gift cards, loyalty redemption, cash session management
// ═══════════════════════════════════════════════════════════════════════════

import {
  IsString, IsUUID, IsNumber, IsPositive, IsOptional,
  IsEnum, Min, Max, MinLength, MaxLength, IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Gift Cards ────────────────────────────────────────────────────────────

export class IssueGiftCardDto {
  @ApiProperty({ description: 'Initial value in AED', example: 500 })
  @IsNumber()
  @IsPositive()
  initialValue!: number;

  @ApiPropertyOptional({ description: 'Customer UUID to assign the card to' })
  @IsUUID()
  @IsOptional()
  issuedTo?: string;

  @ApiPropertyOptional({ description: 'Expiry date (ISO date string)' })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Customization data: message, design, from_name' })
  @IsOptional()
  customization?: {
    message?: string;
    fromName?: string;
    design?: string;
  };
}

export class RedeemGiftCardDto {
  @ApiProperty({ description: 'Gift card code (masked)', example: 'LUXE-XXXX-XXXX-XXXX' })
  @IsString()
  @MinLength(10)
  code!: string;

  @ApiProperty({ description: 'Amount to redeem in AED', example: 250 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: 'Transaction UUID to apply the credit to' })
  @IsUUID()
  transactionId!: string;
}

// ── Loyalty ───────────────────────────────────────────────────────────────

export class RedeemLoyaltyDto {
  @ApiProperty({ description: 'Customer UUID' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ description: 'Points to redeem (100 pts = AED 1.00)' })
  @IsNumber()
  @Min(100)
  points!: number;

  @ApiProperty({ description: 'Transaction UUID to apply the discount to' })
  @IsUUID()
  transactionId!: string;
}

// ── Cash Session ──────────────────────────────────────────────────────────

export class OpenCashSessionDto {
  @ApiProperty({ description: 'Location UUID' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({ description: 'Device UUID' })
  @IsUUID()
  @IsOptional()
  deviceId?: string;

  @ApiProperty({ description: 'Opening float in AED', example: 500 })
  @IsNumber()
  @Min(0)
  openingFloat!: number;
}

export class CloseCashSessionDto {
  @ApiProperty({ description: 'Physical cash count at close', example: 1250.50 })
  @IsNumber()
  @Min(0)
  closingCount!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
