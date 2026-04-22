// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — SalesModule
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'blockchain' },
      { name: 'receipts' },
      { name: 'outreach' },
    ),
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
