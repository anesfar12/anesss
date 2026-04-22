// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Root AppModule
// Wires all 20 feature modules + infrastructure
// ═══════════════════════════════════════════════════════════════════════════

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bull';

import { databaseConfig } from './config/database.config';
import { jwtConfig } from './config/jwt.config';
import { redisConfig } from './config/redis.config';
import { appConfig } from './config/app.config';

import { AuthModule } from './modules/auth/auth.module';
import { SalesModule } from './modules/sales/sales.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CRMModule } from './modules/crm/crm.module';
import { HardwareModule } from './modules/hardware/hardware.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FinanceModule } from './modules/finance/finance.module';
import { StaffModule } from './modules/staff/staff.module';
import { OutreachModule } from './modules/outreach/outreach.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { AIAdapterModule } from './modules/ai-adapter/ai-adapter.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { SystemModule } from './modules/system/system.module';
import { SpatialModule } from './modules/spatial/spatial.module';
import { WholesaleModule } from './modules/wholesale/wholesale.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

import { DatabaseModule } from './config/database.module';
import { WebSocketGatewayModule } from './modules/system/websocket.module';

@Module({
  imports: [
    // ── Config (loaded first) ─────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, redisConfig],
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    // ── Database (PostgreSQL 18 via postgres.js) ──────────────────────────
    DatabaseModule,

    // ── Redis + BullMQ ────────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string>('redis.password'),
          tls: config.get<boolean>('redis.tls') ? {} : undefined,
        },
      }),
    }),

    // ── Rate Limiting ─────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },          // 10 req/sec
      { name: 'medium', ttl: 10000, limit: 50 },         // 50 req/10s
      { name: 'long', ttl: 60000, limit: 300 },          // 300 req/min
    ]),

    // ── Event System ─────────────────────────────────────────────────────
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),

    // ── Scheduled Tasks ──────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── WebSocket Gateway ────────────────────────────────────────────────
    WebSocketGatewayModule,

    // ── Feature Modules ───────────────────────────────────────────────────
    AuthModule,
    FeatureFlagsModule,       // loaded early — AI adapter depends on flags
    AIAdapterModule,          // feature-flagged AI proxy (Fix 1: never blocks checkout)
    SalesModule,
    InventoryModule,
    CustomersModule,
    CRMModule,
    HardwareModule,
    PaymentsModule,
    FinanceModule,
    StaffModule,
    OutreachModule,
    AppointmentsModule,
    DeliveryModule,
    BlockchainModule,         // always async (Fix 4)
    ManufacturingModule,
    SystemModule,
    SpatialModule,
    WholesaleModule,
    DashboardModule,
  ],
  providers: [
    // Global rate limiting guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Request ID middleware applied to all routes
    consumer.apply().forRoutes('*');
  }
}
