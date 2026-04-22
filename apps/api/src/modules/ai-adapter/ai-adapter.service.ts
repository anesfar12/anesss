// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — AIAdapterService
// Adapter Pattern: switches between NullAIAdapter and PythonAIAdapter
// based on 'ai_service_enabled' feature flag (database-driven)
//
// Engineering Fix 1: AI NEVER BLOCKS CHECKOUT
//   Promise.race([aiCall, timeout(800ms)])
//   Circuit breaker: opens after 5 consecutive failures, resets after 60s
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

// ── Interfaces (Section 6.1) ─────────────────────────────────────────────

export interface ProductRecommendation {
  productId: string;
  name: string;
  brand: string;
  score: number;
  reason: string;
}

export interface DemandForecast {
  skuId: string;
  predictedDemand: number;
  confidence: number;
  horizon: number;
  method: string;
}

export interface FraudSignal {
  score: number;
  flagged: boolean;
  reasons: string[];
}

export interface IAIAdapter {
  getRecommendations(customerId: string, context: RecommendationContext): Promise<ProductRecommendation[]>;
  streamChat(message: string, sessionId: string, locale: string): AsyncIterable<string>;
  getForecast(skuId: string, horizon: number): Promise<DemandForecast>;
  detectFraud(transactionId: string): Promise<FraudSignal>;
}

export interface RecommendationContext {
  occasionHint?: string;
  limit?: number;
  excludeOwned?: boolean;
}

// ── NullAIAdapter — graceful empty state when AI is OFF ─────────────────

class NullAIAdapter implements IAIAdapter {
  async getRecommendations(): Promise<ProductRecommendation[]> { return []; }

  async *streamChat(): AsyncIterable<string> {
    yield 'AI assistant is currently offline.';
  }

  async getForecast(skuId: string): Promise<DemandForecast> {
    return { skuId, predictedDemand: 0, confidence: 0, horizon: 0, method: 'statistical_fallback' };
  }

  async detectFraud(): Promise<FraudSignal> {
    return { score: 0, flagged: false, reasons: [] };
  }
}

// ── PythonAIAdapter — live FastAPI microservice calls ────────────────────

class PythonAIAdapter implements IAIAdapter {
  private readonly logger = new Logger('PythonAIAdapter');

  constructor(private readonly baseUrl: string) {}

  async getRecommendations(customerId: string, ctx: RecommendationContext): Promise<ProductRecommendation[]> {
    const res = await fetch(`${this.baseUrl}/v1/recommend/${customerId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(800),      // Fix 1: 800ms max
    });
    if (!res.ok) throw new Error(`AI recommend: ${res.status}`);
    const data = await res.json() as { products: ProductRecommendation[] };
    return data.products;
  }

  async *streamChat(message: string, sessionId: string, locale: string): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId, locale }),
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok || !res.body) throw new Error(`AI chat: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  }

  async getForecast(skuId: string, horizon: number): Promise<DemandForecast> {
    const res = await fetch(`${this.baseUrl}/v1/forecast/${skuId}?horizon=${horizon}`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) throw new Error(`AI forecast: ${res.status}`);
    return res.json() as Promise<DemandForecast>;
  }

  async detectFraud(transactionId: string): Promise<FraudSignal> {
    const res = await fetch(`${this.baseUrl}/v1/fraud/${transactionId}`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) throw new Error(`AI fraud: ${res.status}`);
    return res.json() as Promise<FraudSignal>;
  }
}

// ── AIAdapterService — proxy with circuit breaker ────────────────────────

@Injectable()
export class AIAdapterService implements OnModuleInit {
  private readonly logger = new Logger(AIAdapterService.name);
  private adapter: IAIAdapter = new NullAIAdapter();

  // Circuit breaker state
  private consecutiveFailures = 0;
  private readonly FAILURE_THRESHOLD = 5;
  private circuitOpenAt: number | null = null;
  private readonly CIRCUIT_RESET_MS = 60_000;   // 60 seconds

  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.updateAdapter();
  }

  @OnEvent('db.feature.flags')
  onFlagChanged() {
    this.updateAdapter();
  }

  private updateAdapter() {
    const enabled = this.flags.isEnabled('ai_service_enabled');
    if (enabled) {
      const url = this.config.get<string>('app.aiServiceUrl', 'http://localhost:8000');
      this.adapter = new PythonAIAdapter(url);
      this.logger.log('AI adapter: PythonAIAdapter ACTIVE');
    } else {
      this.adapter = new NullAIAdapter();
      this.logger.log('AI adapter: NullAIAdapter (ai_service_enabled = false)');
    }
    // Reset circuit on flag change
    this.consecutiveFailures = 0;
    this.circuitOpenAt = null;
  }

  // ── Fix 1: Timeout wrapper + circuit breaker ────────────────────────────

  private isCircuitOpen(): boolean {
    if (this.circuitOpenAt === null) return false;
    if (Date.now() - this.circuitOpenAt > this.CIRCUIT_RESET_MS) {
      this.circuitOpenAt = null;
      this.consecutiveFailures = 0;
      this.logger.log('Circuit breaker reset — probing AI service');
      return false;
    }
    return true;
  }

  private async withCircuitBreaker<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (this.isCircuitOpen()) return fallback;

    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      return result;
    } catch (err) {
      this.consecutiveFailures++;
      this.logger.warn(`AI call failed (${this.consecutiveFailures}/${this.FAILURE_THRESHOLD}): ${String(err)}`);
      if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
        this.circuitOpenAt = Date.now();
        this.logger.error('Circuit breaker OPEN — AI service unreachable. All AI calls returning fallback.');
      }
      return fallback;
    }
  }

  // ── Public methods (used by Sales, CRM, Dashboard modules) ──────────────

  async getRecommendations(customerId: string, ctx: RecommendationContext = {}): Promise<ProductRecommendation[]> {
    if (!this.flags.isEnabled('ai_recommendations_active')) return [];
    return this.withCircuitBreaker(
      () => this.adapter.getRecommendations(customerId, ctx),
      [],
    );
  }

  async *streamChat(message: string, sessionId: string, locale = 'en'): AsyncIterable<string> {
    if (!this.flags.isEnabled('ai_chat_assistant_active')) {
      yield 'AI chat assistant is currently disabled.';
      return;
    }
    if (this.isCircuitOpen()) {
      yield 'AI assistant temporarily unavailable.';
      return;
    }
    try {
      yield* this.adapter.streamChat(message, sessionId, locale);
    } catch {
      yield 'AI assistant temporarily unavailable.';
    }
  }

  async getForecast(skuId: string, horizon = 30): Promise<DemandForecast> {
    if (!this.flags.isEnabled('ai_demand_forecast_active')) {
      return { skuId, predictedDemand: 0, confidence: 0, horizon, method: 'statistical_fallback' };
    }
    return this.withCircuitBreaker(
      () => this.adapter.getForecast(skuId, horizon),
      { skuId, predictedDemand: 0, confidence: 0, horizon, method: 'statistical_fallback' },
    );
  }

  async detectFraud(transactionId: string): Promise<FraudSignal> {
    if (!this.flags.isEnabled('ai_fraud_detection_active')) {
      return { score: 0, flagged: false, reasons: [] };
    }
    return this.withCircuitBreaker(
      () => this.adapter.detectFraud(transactionId),
      { score: 0, flagged: false, reasons: [] },
    );
  }

  get isActive(): boolean {
    return this.flags.isEnabled('ai_service_enabled') && !this.isCircuitOpen();
  }

  get circuitStatus(): 'closed' | 'open' | 'half-open' {
    if (this.circuitOpenAt === null) return 'closed';
    if (Date.now() - this.circuitOpenAt > this.CIRCUIT_RESET_MS) return 'half-open';
    return 'open';
  }
}
