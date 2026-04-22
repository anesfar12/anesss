// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Logging Interceptor
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string; url: string; ip: string;
      headers: Record<string, string>;
    }>();
    const { method, url, ip } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(`${method} ${url} ${ip} +${ms}ms`);
      }),
    );
  }
}

// TransformInterceptor lives in transform.interceptor.ts (separate file)
// Import from: import { TransformInterceptor } from './transform.interceptor';
