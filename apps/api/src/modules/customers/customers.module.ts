// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — CustomersModule
// Customer CRUD, Digital Black Book (Section 8.2), Scent Wardrobe, Biometric
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
