// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Redis Configuration
// Used by: BullModule (BullMQ queues), cache layer
// Upstash Redis in production (~$0/free tier)
// ═══════════════════════════════════════════════════════════════════════════

import { registerAs } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD ?? undefined,
  tls: process.env.REDIS_TLS === 'true',
  url: process.env.REDIS_URL ?? undefined,
}));
