// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Database Configuration
// PostgreSQL 18 via postgres.js — connection pooling, NOTIFY listener
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Database Configuration
// PostgreSQL 18 via postgres.js — connection pooling
// Supabase Pro in production (~$25/mo)
// ═══════════════════════════════════════════════════════════════════════════

import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL ?? '',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  name: process.env.DB_NAME ?? 'luxepos',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  ssl: process.env.DB_SSL === 'true',
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '20', 10),
  idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT ?? '30', 10),
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT ?? '10', 10),
}));
