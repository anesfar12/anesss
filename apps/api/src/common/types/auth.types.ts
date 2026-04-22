// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Shared Auth Types
// Single source of truth for JwtPayload interface.
// Imported by: guards, decorators, strategies, auth.service, websocket.module
// This avoids circular dependencies between common/ layer and modules/auth/
// ═══════════════════════════════════════════════════════════════════════════

/**
 * JWT token payload structure — issued by AuthService.issueTokens()
 * Matches the NestJS JWT strategy validation return type.
 */
export interface JwtPayload {
  /** User UUID (PostgreSQL uuid) */
  sub: string;

  /** Organization UUID — used for RLS scope in every query */
  org: string;

  /** Staff role string matching user_role enum */
  role: string;

  /** Home location UUID — null for super_admin / web-only users */
  loc: string | null;

  /** Device UUID — set when logging in via POS PIN, null for web */
  dev: string | null;

  /** JWT standard: issued at (epoch seconds) */
  iat?: number;

  /** JWT standard: expires at (epoch seconds) */
  exp?: number;

  /**
   * Partial token flag — true during MFA verification flow.
   * A partial token expires in 5 minutes and can ONLY call /auth/mfa/verify.
   * Any other endpoint will reject it because partial=true.
   */
  partial?: boolean;
}

/**
 * Role hierarchy levels — used by RolesGuard for numeric comparison.
 * Higher number = more permissions.
 */
export const ROLE_LEVELS: Record<string, number> = {
  super_admin:  10,
  admin:         8,
  manager:       6,
  accountant:    5,
  senior_sales:  4,
  sales:         3,
  stockroom:     2,
  cashier:       2,
  readonly:      1,
} as const;

export type UserRole = keyof typeof ROLE_LEVELS;
