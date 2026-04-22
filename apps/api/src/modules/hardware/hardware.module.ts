// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — HardwareModule
// NFC NTAG 424 DNA validation (Section 8.3) + SoftPOS (Tap to Pay)
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { HardwareController } from './hardware.controller';
import { HardwareService } from './hardware.service';

@Module({
  controllers: [HardwareController],
  providers: [HardwareService],
  exports: [HardwareService],
})
export class HardwareModule {}
