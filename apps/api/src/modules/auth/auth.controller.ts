// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — AuthController
// POST /api/v1/auth/login | /auth/biometric/checkout | etc.
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Post, Body, UseGuards, Get, Req,
  HttpCode, HttpStatus, Headers, Ip, Patch, Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  LoginDto, PinLoginDto, BiometricCheckoutDto,
  RefreshTokenDto, VerifyMfaDto, SetupMfaDto, RegisterDeviceDto,
} from './dto/auth.dto';
import type { JwtPayload } from '../../common/types/auth.types';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── POST /api/v1/auth/login ───────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })   // 5 attempts per minute
  @ApiOperation({ summary: 'Staff password login (web dashboard)' })
  @ApiResponse({ status: 200, description: 'JWT tokens returned' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.auth.loginPassword(dto, ip, ua);
  }

  // ── POST /api/v1/auth/pin ─────────────────────────────────────────────

  @Post('pin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'POS terminal PIN login (Layer 2)' })
  async pinLogin(
    @Body() dto: PinLoginDto,
    @Headers('x-device-id') deviceId: string,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.auth.loginPin(dto, deviceId, ip, ua);
  }

  // ── POST /api/v1/auth/mfa/verify ─────────────────────────────────────

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify TOTP MFA code (Layer 4)' })
  async verifyMfa(
    @Body() dto: VerifyMfaDto,
    @Headers('authorization') auth: string,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const partialToken = auth?.replace('Bearer ', '') ?? '';
    return this.auth.verifyMfa(dto, partialToken, ip, ua);
  }

  // ── POST /api/v1/auth/mfa/setup ──────────────────────────────────────

  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate TOTP secret and QR code' })
  async setupMfa(@CurrentUser() user: JwtPayload) {
    return this.auth.setupMfa(user.sub);
  }

  // ── POST /api/v1/auth/mfa/enable ─────────────────────────────────────

  @Post('mfa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activate MFA after TOTP verification' })
  async enableMfa(@CurrentUser() user: JwtPayload, @Body() dto: SetupMfaDto) {
    return this.auth.enableMfa(user.sub, dto);
  }

  // ── POST /api/v1/auth/refresh ─────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token (7-day sliding window)' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.auth.refreshTokens(dto, ip, ua);
  }

  // ── POST /api/v1/auth/logout ──────────────────────────────────────────

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all sessions for current user' })
  async logout(@CurrentUser() user: JwtPayload) {
    await this.auth.revokeSession(user.sub);
  }

  // ── POST /api/v1/auth/biometric/checkout ─────────────────────────────

  @Post('biometric/checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'VIP biometric checkout — Amazon One palm (Layer 7). Degrades gracefully on failure.' })
  @ApiResponse({ status: 200, description: 'Customer identified via biometric' })
  @ApiResponse({ status: 404, description: 'Biometric not matched — use phone lookup' })
  async biometricCheckout(@Body() dto: BiometricCheckoutDto) {
    return this.auth.biometricCheckout(dto);
  }

  // ── POST /api/v1/auth/devices/register ───────────────────────────────

  @Post('devices/register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register new POS device — requires manager approval (Layer 5)' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.auth.registerDevice({
      ...dto,
      organizationId: user.org,
    });
  }

  // ── PATCH /api/v1/auth/devices/:id/approve ───────────────────────────

  @Patch('devices/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin', 'manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a new POS device (manager+ only)' })
  async approveDevice(
    @Param('id') deviceId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.auth.approveDevice(deviceId, user.sub);
    return { message: 'Device approved successfully' };
  }

  // ── GET /api/v1/auth/me ───────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
