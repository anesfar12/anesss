// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — AIAdapterModule (Section 6.1)
// IAIAdapter interface, NullAIAdapter, PythonAIAdapter
// Engineering Fix 1: AI MUST NEVER BLOCK CHECKOUT
//   — every call wrapped in Promise.race([aiCall, timeout(800ms)])
//   — circuit breaker opens after 5 consecutive failures
// ═══════════════════════════════════════════════════════════════════════════

import { Module, Global } from '@nestjs/common';
import { AIAdapterService } from './ai-adapter.service';
import { AIAdapterController } from './ai-adapter.controller';

@Global()
@Module({
  controllers: [AIAdapterController],
  providers: [AIAdapterService],
  exports: [AIAdapterService],
})
export class AIAdapterModule {}
