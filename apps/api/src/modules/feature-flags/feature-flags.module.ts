// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — FeatureFlagsModule
// Database-driven flags, hot-reload via PostgreSQL NOTIFY (Section 6.2)
// ═══════════════════════════════════════════════════════════════════════════

import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';

@Global()   // available everywhere without importing
@Module({
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
