// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Custom Decorators
// ═══════════════════════════════════════════════════════════════════════════

import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { JwtPayload } from '../types/auth.types';

// ── CurrentUser — extracts JWT payload from request ─────────────────────
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);

// ── Roles — metadata for RolesGuard ─────────────────────────────────────
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

// ── Public — bypass JWT guard ────────────────────────────────────────────
export const Public = () => SetMetadata('isPublic', true);

// ── IdempotencyKey — extract X-Idempotency-Key header ───────────────────
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    return request.headers['x-idempotency-key'];
  },
);

// ── DeviceId — extract X-Device-ID header ───────────────────────────────
export const DeviceId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    return request.headers['x-device-id'];
  },
);

// ── OrgId — extract org from JWT payload ─────────────────────────────────
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user.org;
  },
);
