// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — NestJS Core API Entry Point
// Port 3000 | Engineering Fixes 1–8 applied at bootstrap
// ═══════════════════════════════════════════════════════════════════════════

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    bufferLogs: true,
  });

  // ── Security ────────────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(compression());

  // ── CORS ─────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: [
      process.env.POS_APP_URL ?? 'http://localhost:3001',
      process.env.DASHBOARD_URL ?? 'http://localhost:3002',
      process.env.STOREFRONT_URL ?? 'http://localhost:3003',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Idempotency-Key', 'X-Device-ID'],
  });

  // ── Global prefix + versioning ──────────────────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ── Global pipes (class-validator) ─────────────────────────────────────
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // ── Global filters + interceptors ───────────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ── WebSocket adapter (Socket.IO + Redis adapter) ───────────────────────
  app.useWebSocketAdapter(new IoAdapter(app));

  // ── Swagger (disabled in production) ────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('LUXE POS API v5.1')
      .setDescription('God-Tier Luxury POS — GCC Edition 2026')
      .setVersion('5.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addApiKey({ type: 'apiKey', name: 'X-Device-ID', in: 'header' }, 'device-id')
      .addServer('http://localhost:3000', 'Local Development')
      .addServer('https://api.luxepos.com', 'Production')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  console.log(`🏺 LUXE POS API v5.1 running on port ${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
