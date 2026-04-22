// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — FeatureFlagsService
// In-memory cache with NOTIFY hot-reload from PostgreSQL trigger
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

interface FlagRow {
  flagKey: string;
  flagType: string;
  valueBoolean: boolean | null;
  valuePercentage: number | null;
  valueJson: unknown;
  valueString: string | null;
  organizationId: string | null;
  isGlobal: boolean;
}

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);
  // Cache: orgId+key → value. 'global' for org-scoped nulls
  private cache = new Map<string, boolean | number | unknown | string>();

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
  ) {}

  async onModuleInit() {
    await this.loadAll();
    this.logger.log(`Feature flags loaded: ${this.cache.size} flags`);
  }

  // ── Hot-reload on PostgreSQL NOTIFY from fn_notify_feature_flag_change ──
  @OnEvent('db.feature.flags')
  async onFlagChanged(data: { flagKey: string; newValue: boolean; orgId: string }) {
    this.logger.log(`Flag changed via NOTIFY: ${data.flagKey} = ${data.newValue} (org: ${data.orgId})`);
    await this.loadAll();  // re-fetch all flags on any change
  }

  private async loadAll() {
    const rows = await this.sql<FlagRow[]>`
      SELECT flag_key, flag_type, value_boolean, value_percentage,
             value_json, value_string, organization_id, is_global
      FROM feature_flags
    `;

    this.cache.clear();
    for (const row of rows) {
      const cacheKey = `${row.organizationId ?? 'global'}:${row.flagKey}`;
      switch (row.flagType) {
        case 'boolean':    this.cache.set(cacheKey, row.valueBoolean ?? false); break;
        case 'percentage': this.cache.set(cacheKey, row.valuePercentage ?? 0); break;
        case 'json':       this.cache.set(cacheKey, row.valueJson); break;
        case 'string':     this.cache.set(cacheKey, row.valueString ?? ''); break;
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  isEnabled(flagKey: string, orgId?: string): boolean {
    // Check org-specific first, then global
    if (orgId) {
      const orgKey = `${orgId}:${flagKey}`;
      if (this.cache.has(orgKey)) return Boolean(this.cache.get(orgKey));
    }
    const globalKey = `global:${flagKey}`;
    if (this.cache.has(globalKey)) return Boolean(this.cache.get(globalKey));
    // Default FALSE — safe default for all AI flags
    return false;
  }

  getValue<T>(flagKey: string, orgId?: string, defaultValue?: T): T {
    if (orgId) {
      const orgKey = `${orgId}:${flagKey}`;
      if (this.cache.has(orgKey)) return this.cache.get(orgKey) as T;
    }
    const globalKey = `global:${flagKey}`;
    if (this.cache.has(globalKey)) return this.cache.get(globalKey) as T;
    return defaultValue as T;
  }

  async setFlag(orgId: string, flagKey: string, value: boolean): Promise<void> {
    await this.sql`
      INSERT INTO feature_flags (organization_id, flag_key, flag_type, value_boolean)
      VALUES (${orgId}, ${flagKey}, 'boolean', ${value})
      ON CONFLICT (organization_id, flag_key)
      DO UPDATE SET value_boolean = ${value}, updated_at = now()
    `;
    // Cache update is handled by NOTIFY → onFlagChanged
    this.cache.set(`${orgId}:${flagKey}`, value);
  }

  async listFlags(orgId: string): Promise<FlagRow[]> {
    return this.sql<FlagRow[]>`
      SELECT flag_key, flag_type, value_boolean, value_percentage,
             value_json, value_string, organization_id, is_global, description, updated_at
      FROM feature_flags
      WHERE organization_id = ${orgId} OR is_global = TRUE
      ORDER BY flag_key
    `;
  }
}
