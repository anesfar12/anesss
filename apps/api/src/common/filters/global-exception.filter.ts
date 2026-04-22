// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Global Exception Filter
// ═══════════════════════════════════════════════════════════════════════════

import {
  ExceptionFilter, Catch, ArgumentsHost, HttpException,
  HttpStatus, Logger,
} from '@nestjs/common';
import type { Response, Request } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        message = (r['message'] as string) ?? exception.message;
        code = (r['error'] as string) ?? 'HTTP_ERROR';
        details = r['details'];
      }
    } else if (exception instanceof Error) {
      // PostgreSQL constraint violations
      const pgError = exception as Error & { code?: string; constraint?: string };
      if (pgError.code === '23505') {
        status = HttpStatus.CONFLICT;
        message = 'Duplicate entry — resource already exists';
        code = 'DUPLICATE_ENTRY';
      } else if (pgError.code === 'P0001') {
        // Custom RAISE EXCEPTION from our triggers
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        message = pgError.message ?? 'Database constraint violation';
        code = pgError.message?.startsWith('LUXE-INV-') ? 'INVENTORY_ERROR' : 'DB_ERROR';
      } else {
        this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
      }
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      code,
      message,
      details,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
