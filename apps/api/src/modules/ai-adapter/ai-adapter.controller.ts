// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — AIAdapterController
// Proxy endpoints: /ai/recommend, /ai/chat (SSE), /ai/forecast
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, Res, Sse, MessageEvent,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';
import { AIAdapterService } from './ai-adapter.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { IsString, IsOptional } from 'class-validator';

class ChatDto {
  @IsString()
  message!: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsOptional()
  locale?: string;
}

@ApiTags('AI (Proxy)')
@Controller({ path: 'ai', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AIAdapterController {
  constructor(private readonly ai: AIAdapterService) {}

  // GET /api/v1/ai/recommend/:customerId — HNSW-backed recommendation
  @Get('recommend/:customerId')
  @ApiOperation({ summary: 'AI product recommendations (HNSW vector similarity). Returns [] if AI disabled.' })
  async recommend(
    @Param('customerId') customerId: string,
    @Query('limit') limit?: number,
    @Query('occasion') occasion?: string,
  ) {
    return this.ai.getRecommendations(customerId, { limit, occasionHint: occasion });
  }

  // POST /api/v1/ai/chat — SSE streaming chat
  @Sse('chat')
  @ApiOperation({ summary: 'AI chat SSE stream — Arabic/English NLP via Groq + Jais' })
  streamChat(
    @Body() dto: ChatDto,
    @CurrentUser() user: JwtPayload,
  ): Observable<MessageEvent> {
    const sessionId = dto.sessionId ?? `${user.sub}-${Date.now()}`;
    const locale = dto.locale ?? 'en';
    const stream = this.ai.streamChat(dto.message, sessionId, locale);
    return from(this.asyncIterableToArray(stream)).pipe(
      map((chunk) => ({ data: { text: chunk } } as MessageEvent)),
    );
  }

  // GET /api/v1/ai/forecast/:skuId
  @Get('forecast/:skuId')
  @ApiOperation({ summary: 'AI demand forecast for SKU. Returns statistical_fallback if AI disabled.' })
  async forecast(
    @Param('skuId') skuId: string,
    @Query('horizon') horizon = 30,
  ) {
    return this.ai.getForecast(skuId, Number(horizon));
  }

  // GET /api/v1/ai/status
  @Get('status')
  @ApiOperation({ summary: 'AI service status + circuit breaker state' })
  status() {
    return {
      active: this.ai.isActive,
      circuit: this.ai.circuitStatus,
    };
  }

  private async *asyncIterableToArray(iter: AsyncIterable<string>): AsyncIterable<string> {
    yield* iter;
  }
}
