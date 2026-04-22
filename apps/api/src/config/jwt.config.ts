// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — JWT Configuration
// Used by: AuthModule, JwtStrategy, WebSocketGateway
// ═══════════════════════════════════════════════════════════════════════════

import { registerAs } from '@nestjs/config';

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET ?? 'luxe-dev-secret-change-in-production',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES ?? '7d',
}));
