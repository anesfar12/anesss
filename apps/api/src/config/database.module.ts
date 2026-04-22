// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — DatabaseModule
// PostgreSQL 18 connection pool + NOTIFY channel listener
// ═══════════════════════════════════════════════════════════════════════════

import { Module, Global, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres from 'postgres';
import { EventEmitter2 } from '@nestjs/event-emitter';

export const DB_TOKEN = 'POSTGRES_SQL';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const url = config.get<string>('database.url');
        const sql = postgres(url ?? {
          host:     config.get<string>('database.host'),
          port:     config.get<number>('database.port'),
          database: config.get<string>('database.name'),
          user:     config.get<string>('database.user'),
          password: config.get<string>('database.password'),
          ssl:      config.get<boolean>('database.ssl') ? 'require' : false,
          max:      config.get<number>('database.maxConnections', 20),
          idle_timeout: config.get<number>('database.idleTimeout', 30),
          connect_timeout: config.get<number>('database.connectTimeout', 10),
          // PostgreSQL 18 async I/O (io_uring) is server-side config
          // Client-side: use prepared statements for performance
          prepare:  true,
          transform: {
            // Auto-convert snake_case columns to camelCase
            column: postgres.toCamel,
          },
          onnotice: () => {},           // suppress NOTICE messages
        } as never);
        return sql;
      },
    },
    DatabaseListenerService,
  ],
  exports: [DB_TOKEN, DatabaseListenerService],
})
export class DatabaseModule {}

/**
 * Listens on PostgreSQL NOTIFY channels emitted by triggers:
 *  - luxe_inventory_events  → inventory.deducted / inventory.restored
 *  - luxe_passport_mint     → blockchain mint queue
 *  - luxe_vip_arrival       → preferred staff notification
 *  - luxe_feature_flags     → AI adapter flag changes
 *  - luxe_embedding_sync    → AI embedding sync trigger
 *  - luxe_device_approved   → new device approved
 *  - luxe_key_dates_updated → outreach scheduling
 */
export class DatabaseListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseListenerService.name);
  private listenerSql!: ReturnType<typeof postgres>;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    const url = this.config.get<string>('database.url');
    // Separate long-lived connection for LISTEN — not pooled
    this.listenerSql = postgres(url ?? '', {
      max: 1,
      idle_timeout: 0,
      onnotice: () => {},
    });

    const channels = [
      'luxe_inventory_events',
      'luxe_passport_mint',
      'luxe_vip_arrival',
      'luxe_feature_flags',
      'luxe_embedding_sync',
      'luxe_device_approved',
      'luxe_key_dates_updated',
    ];

    for (const channel of channels) {
      await this.listenerSql.listen(channel, (payload: string) => {
        try {
          const data = JSON.parse(payload) as Record<string, unknown>;
          // Convert channel name to event: 'luxe_inventory_events' → 'db.inventory.events'
          const eventName = channel.replace('luxe_', 'db.').replaceAll('_', '.');
          this.events.emit(eventName, data);
          this.logger.debug(`NOTIFY [${channel}]: ${payload.slice(0, 100)}`);
        } catch {
          this.logger.error(`Failed to parse NOTIFY payload from ${channel}: ${payload}`);
        }
      });
      this.logger.log(`Listening on PostgreSQL channel: ${channel}`);
    }
  }

  async onModuleDestroy() {
    if (this.listenerSql) {
      await this.listenerSql.end({ timeout: 5 });
    }
  }
}
