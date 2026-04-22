// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — PaymentsModule
// Gift card issuance/redemption, loyalty point redemption, cash session management
// Exported: PaymentsService is used by SalesModule for split-payment checkout
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],   // SalesModule uses PaymentsService for gift card + loyalty in checkout
})
export class PaymentsModule {}
