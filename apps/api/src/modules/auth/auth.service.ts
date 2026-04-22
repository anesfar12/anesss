// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — AuthService
// Blueprint Section 10 — all 8 security layers
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, UnauthorizedException, ForbiddenException,
  BadRequestException, NotFoundException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';
import {
  LoginDto, PinLoginDto, BiometricCheckoutDto,
  RefreshTokenDto, SetupMfaDto, VerifyMfaDto,
} from './dto/auth.dto';

export interface JwtPayload {
  sub: string;                // user UUID
  org: string;                // organization UUID
  role: string;               // user_role enum
  loc: string | null;         // location UUID
  dev: string | null;         // device UUID
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;
  private readonly REFRESH_EXPIRES_DAYS = 7;

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Layer 1: Password Login (web dashboard) ────────────────────────────

  async loginPassword(dto: LoginDto, ipAddress: string, userAgent: string): Promise<TokenPair & { user: object; requiresMfa: boolean }> {
    const [user] = await this.sql<{ id: string; organizationId: string; locationId: string; email: string; passwordHash: string; role: string; mfaEnabled: boolean; mfaType: string; isActive: boolean; isDeleted: boolean }[]>`
      SELECT id, organization_id, location_id, email, password_hash, role,
             mfa_enabled, mfa_type, is_active, is_deleted
      FROM users
      WHERE email = ${dto.email}
        AND is_deleted = FALSE
      LIMIT 1
    `;

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new ForbiddenException('Account disabled');
    if (!user.passwordHash) throw new UnauthorizedException('Password login not configured — use biometric or PIN');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // Update last login
    await this.sql`
      UPDATE users SET last_login_at = now() WHERE id = ${user.id}
    `;

    if (user.mfaEnabled && user.mfaType === 'totp') {
      // Return partial token — MFA required
      const partialToken = this.jwt.sign(
        { sub: user.id, org: user.organizationId, role: user.role, loc: user.locationId, dev: null, partial: true },
        { expiresIn: '5m' },
      );
      return {
        accessToken: partialToken,
        refreshToken: '',
        expiresIn: 300,
        tokenType: 'Bearer',
        user: { id: user.id, email: user.email, role: user.role },
        requiresMfa: true,
      };
    }

    const tokens = await this.issueTokens(user.id, user.organizationId, user.role, user.locationId, null, 'password', ipAddress, userAgent);
    return { ...tokens, user: { id: user.id, email: user.email, role: user.role }, requiresMfa: false };
  }

  // ── Layer 2: PIN Login (POS terminal quick-switch) ────────────────────

  async loginPin(dto: PinLoginDto, deviceId: string, ipAddress: string, userAgent: string): Promise<TokenPair & { user: object }> {
    // Verify device is approved first
    const [device] = await this.sql<{ id: string; locationId: string; isApproved: boolean; organizationId: string }[]>`
      SELECT id, location_id, is_approved, organization_id
      FROM pos_devices
      WHERE id = ${deviceId} AND is_active = TRUE
      LIMIT 1
    `;

    if (!device?.isApproved) {
      throw new ForbiddenException('Device not approved — contact manager (Security Layer 5)');
    }

    const [user] = await this.sql<{ id: string; organizationId: string; locationId: string; pinHash: string; role: string; isActive: boolean }[]>`
      SELECT id, organization_id, location_id, pin_hash, role, is_active
      FROM users
      WHERE id = ${dto.userId}
        AND organization_id = ${device.organizationId}
        AND is_deleted = FALSE
      LIMIT 1
    `;

    if (!user || !user.isActive) throw new UnauthorizedException('User not found or disabled');
    if (!user.pinHash) throw new BadRequestException('PIN not configured');

    const valid = await bcrypt.compare(dto.pin, user.pinHash);
    if (!valid) throw new UnauthorizedException('Invalid PIN');

    await this.sql`
      UPDATE users SET last_pin_at = now() WHERE id = ${user.id}
    `;

    const tokens = await this.issueTokens(
      user.id, user.organizationId, user.role,
      user.locationId ?? device.locationId, deviceId, 'pin', ipAddress, userAgent,
    );
    return { ...tokens, user: { id: user.id, role: user.role } };
  }

  // ── Layer 4: MFA Verify (TOTP) ────────────────────────────────────────

  async verifyMfa(dto: VerifyMfaDto, partialToken: string, ipAddress: string, userAgent: string): Promise<TokenPair> {
    let payload: JwtPayload & { partial?: boolean };
    try {
      payload = this.jwt.verify<JwtPayload & { partial?: boolean }>(partialToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA session');
    }

    if (!payload.partial) throw new BadRequestException('Not a partial MFA token');

    const [user] = await this.sql<{ id: string; mfaSecret: string; organizationId: string; role: string; locationId: string }[]>`
      SELECT id, mfa_secret, organization_id, role, location_id
      FROM users WHERE id = ${payload.sub} LIMIT 1
    `;

    if (!user?.mfaSecret) throw new BadRequestException('MFA not configured');

    const valid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: dto.totpCode,
      window: 1,
    });

    if (!valid) throw new UnauthorizedException('Invalid TOTP code');

    return this.issueTokens(user.id, user.organizationId, user.role, user.locationId, null, 'password', ipAddress, userAgent);
  }

  // ── Layer 7: Biometric Checkout (Amazon One) ─────────────────────────

  async biometricCheckout(dto: BiometricCheckoutDto): Promise<{ customerId: string; customerName: string; tier: string }> {
    // Biometric token resolved by Amazon One — never store raw biometric (Fix 3)
    const [customer] = await this.sql<{ id: string; displayName: string; tier: string; biometricTokenRef: string }[]>`
      SELECT id, display_name, tier, biometric_token_ref
      FROM customers
      WHERE biometric_token_ref = ${dto.biometricTokenRef}
        AND biometric_enrolled = TRUE
      LIMIT 1
    `;

    if (!customer) {
      // Fix 3: Biometric must degrade gracefully
      this.logger.warn(`Biometric token not found: ${dto.biometricTokenRef} — falling through to manual lookup`);
      throw new NotFoundException('Biometric match failed — use phone number lookup');
    }

    return {
      customerId: customer.id,
      customerName: customer.displayName,
      tier: customer.tier,
    };
  }

  // ── Refresh Tokens ────────────────────────────────────────────────────

  async refreshTokens(dto: RefreshTokenDto, ipAddress: string, userAgent: string): Promise<TokenPair> {
    const tokenHash = await bcrypt.hash(dto.refreshToken, 5); // quick hash for lookup

    // Look up the session — postgres.js auto-camelCases columns
    const sessions = await this.sql<{ userId: string; organizationId: string; role: string; locationId: string | null; deviceId: string | null; refreshToken: string; refreshExpires: Date; isRevoked: boolean }[]>`
      SELECT s.user_id, u.organization_id, u.role, u.location_id, s.device_id,
             s.refresh_token, s.refresh_expires, s.is_revoked
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.refresh_expires > now()
        AND s.is_revoked = FALSE
    `;

    // Compare all non-revoked sessions
    for (const session of sessions) {
      const match = await bcrypt.compare(dto.refreshToken, session.refreshToken);
      if (match) {
        if (session.isRevoked) throw new UnauthorizedException('Token revoked');

        // Revoke old session (rotation)
        await this.sql`
          UPDATE user_sessions SET is_revoked = TRUE
          WHERE refresh_token = ${session.refreshToken}
        `;

        return this.issueTokens(
          session.userId, session.organizationId, session.role,
          session.locationId, session.deviceId, 'password', ipAddress, userAgent,
        );
      }
    }
    throw new UnauthorizedException('Invalid or expired refresh token');
  }

  async revokeSession(userId: string): Promise<void> {
    await this.sql`
      UPDATE user_sessions SET is_revoked = TRUE WHERE user_id = ${userId}
    `;
  }

  // ── MFA Setup ─────────────────────────────────────────────────────────

  async setupMfa(userId: string): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
    const secret = speakeasy.generateSecret({
      name: 'LUXE POS',
      issuer: 'LUXE Parfums',
      length: 20,
    });

    const qrCode = await qrcode.toDataURL(secret.otpauth_url ?? '');

    // Store secret (encrypted at rest by Supabase vault — stored encrypted)
    await this.sql`
      UPDATE users SET mfa_secret = ${secret.base32}, mfa_type = 'totp'
      WHERE id = ${userId}
    `;

    // Generate 8 backup codes
    const backupCodes = Array.from({ length: 8 }, () =>
      Math.random().toString(36).substring(2, 10).toUpperCase()
    );

    return { secret: secret.base32 ?? '', qrCode, backupCodes };
  }

  async enableMfa(userId: string, dto: SetupMfaDto): Promise<void> {
    const [user] = await this.sql<{ mfaSecret: string }[]>`
      SELECT mfa_secret FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (!user?.mfaSecret) throw new BadRequestException('MFA not set up');

    const valid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: dto.totpCode,
      window: 1,
    });
    if (!valid) throw new UnauthorizedException('Invalid TOTP code — MFA not enabled');

    await this.sql`
      UPDATE users SET mfa_enabled = TRUE WHERE id = ${userId}
    `;
  }

  // ── Internal: Token Issuance ──────────────────────────────────────────

  private async issueTokens(
    userId: string,
    orgId: string,
    role: string,
    locationId: string | null,
    deviceId: string | null,
    authMethod: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: userId,
      org: orgId,
      role,
      loc: locationId,
      dev: deviceId,
    };

    const accessToken = this.jwt.sign(payload);
    const refreshTokenRaw = `${userId}.${Date.now()}.${Math.random()}`;
    const refreshTokenHash = await bcrypt.hash(refreshTokenRaw, this.BCRYPT_ROUNDS);

    const refreshExpires = new Date();
    refreshExpires.setDate(refreshExpires.getDate() + this.REFRESH_EXPIRES_DAYS);

    const accessExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.sql`
      INSERT INTO user_sessions (
        user_id, device_id, refresh_token,
        access_expires, refresh_expires, ip_address, user_agent, auth_method
      ) VALUES (
        ${userId}, ${deviceId},
        ${refreshTokenHash},
        ${accessExpires.toISOString()},
        ${refreshExpires.toISOString()},
        ${ipAddress}, ${userAgent}, ${authMethod}
      )
    `;

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      expiresIn: 900,      // 15 minutes in seconds
      tokenType: 'Bearer',
    };
  }

  // ── Device Management (Layer 5) ───────────────────────────────────────

  async approveDevice(deviceId: string, managerId: string): Promise<void> {
    const [device] = await this.sql<{ isApproved: boolean }[]>`
      SELECT is_approved FROM pos_devices WHERE id = ${deviceId} LIMIT 1
    `;
    if (!device) throw new NotFoundException('Device not found');
    if (device.isApproved) throw new BadRequestException('Device already approved');

    await this.sql`
      UPDATE pos_devices SET
        is_approved = TRUE,
        approved_by_id = ${managerId},
        approved_at = now()
      WHERE id = ${deviceId}
    `;
  }

  async registerDevice(dto: {
    organizationId: string;
    locationId: string;
    deviceName: string;
    deviceType: string;
    deviceFingerprint: string;
    hardwareModel: string;
    osVersion: string;
    appVersion: string;
    nfcCapable: boolean;
    uwbNfcCapable: boolean;
    biometricCapable: boolean;
  }): Promise<{ deviceId: string; requiresApproval: boolean }> {
    const [existing] = await this.sql<{ id: string; isApproved: boolean }[]>`
      SELECT id, is_approved FROM pos_devices
      WHERE device_fingerprint = ${dto.deviceFingerprint}
      LIMIT 1
    `;

    if (existing) {
      return { deviceId: existing.id, requiresApproval: !existing.isApproved };
    }

    const [device] = await this.sql<{ id: string }[]>`
      INSERT INTO pos_devices (
        organization_id, location_id, device_name, device_type,
        device_fingerprint, hardware_model, os_version, app_version,
        nfc_capable, uwb_nfc_capable, biometric_capable,
        is_approved, last_seen_at
      ) VALUES (
        ${dto.organizationId}, ${dto.locationId}, ${dto.deviceName}, ${dto.deviceType},
        ${dto.deviceFingerprint}, ${dto.hardwareModel}, ${dto.osVersion}, ${dto.appVersion},
        ${dto.nfcCapable}, ${dto.uwbNfcCapable}, ${dto.biometricCapable},
        FALSE, now()
      )
      RETURNING id
    `;

    return { deviceId: device!.id, requiresApproval: true };
  }
}
