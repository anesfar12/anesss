// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Auth DTOs
// ═══════════════════════════════════════════════════════════════════════════

import { IsEmail, IsString, MinLength, MaxLength, IsUUID, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'manager@luxepos.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class PinLoginDto {
  @ApiProperty({ description: 'Staff user UUID' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: '1234', description: '4–6 digit PIN' })
  @IsString()
  @MinLength(4)
  @MaxLength(6)
  pin!: string;
}

export class BiometricCheckoutDto {
  @ApiProperty({ description: 'Amazon One provider token reference' })
  @IsString()
  biometricTokenRef!: string;

  @ApiProperty({ description: 'Location UUID for checkout context' })
  @IsUUID()
  locationId!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class VerifyMfaDto {
  @ApiProperty({ example: '123456', description: 'TOTP 6-digit code' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  totpCode!: string;
}

export class SetupMfaDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  totpCode!: string;
}

export class RegisterDeviceDto {
  @ApiProperty()
  @IsString()
  deviceName!: string;

  @ApiProperty({ enum: ['ipad', 'iphone', 'web'] })
  @IsString()
  deviceType!: string;

  @ApiProperty()
  @IsString()
  deviceFingerprint!: string;

  @ApiProperty()
  @IsString()
  hardwareModel!: string;

  @ApiProperty()
  @IsString()
  osVersion!: string;

  @ApiProperty()
  @IsString()
  appVersion!: string;

  @ApiProperty()
  @IsUUID()
  locationId!: string;

  @ApiProperty()
  @IsBoolean()
  nfcCapable!: boolean;

  @ApiProperty()
  @IsBoolean()
  uwbNfcCapable!: boolean;

  @ApiProperty()
  @IsBoolean()
  biometricCapable!: boolean;
}
