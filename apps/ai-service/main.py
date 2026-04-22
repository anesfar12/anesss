# ═══════════════════════════════════════════════════════════════════════════
# LUXE POS v5.1 — Python AI Microservice Entry Point
# FastAPI Q2-2026 | Port 8000 | INTERNAL ONLY (not public-facing)
# Blueprint Section 4.3 — lifespan, ChromaDB HNSW pre-warm
# Engineering Fix 8: PYTHON_JIT=1 only when Python 3.15 marks JIT stable
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import os
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.core.config import get_settings
from app.core.chroma import get_chroma_client, warm_hnsw_indexes
from app.core.database import init_db_pool, close_db_pool
from app.routers import recommend, chat, forecast, fraud, embed, health

# ── Structured logging ────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

log = structlog.get_logger("luxe.ai")


# ── Lifespan (FastAPI 0.120+ best practice — Section 4.3) ─────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    startup_start = time.perf_counter()

    log.info("LUXE AI Microservice starting", version="5.1.0", env=settings.environment)

    # Engineering Fix 8: warn if JIT accidentally enabled in non-3.15
    import sys
    if os.getenv("PYTHON_JIT") == "1" and sys.version_info < (3, 15):
        log.warning(
            "PYTHON_JIT=1 on Python < 3.15 — experimental JIT active. "
            "Only enable in production on Python 3.15+ (Engineering Fix 8)"
        )

    # 1. Connect to PostgreSQL 18
    await init_db_pool(settings.database_url)
    log.info("PostgreSQL 18 pool ready")

    # 2. Connect ChromaDB 0.7+ and warm HNSW indexes
    chroma = get_chroma_client(settings.chromadb_host, settings.chromadb_port)
    app.state.chroma = chroma

    await warm_hnsw_indexes(chroma, ef_search=80)
    log.info("ChromaDB HNSW indexes warmed", ef_search=80)

    # 3. Store settings reference
    app.state.settings = settings

    elapsed = time.perf_counter() - startup_start
    log.info("Startup complete", elapsed_ms=round(elapsed * 1000, 1))

    yield  # Application runs here

    # Shutdown
    log.info("Shutting down")
    await close_db_pool()
    log.info("Database pool closed")


# ── FastAPI application ────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="LUXE AI Microservice",
        description="LUXE POS v5.1 — Fragrance AI: recommendations, Arabic NLP, demand forecasting",
        version="5.1.0",
        lifespan=lifespan,
        default_response_class=ORJSONResponse,
        # Disable Swagger in production — internal service only
        docs_url=None if settings.environment == "production" else "/docs",
        redoc_url=None if settings.environment == "production" else "/redoc",
        openapi_url=None if settings.environment == "production" else "/openapi.json",
    )

    # CORS — only allow NestJS API (internal)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # ── Request timing middleware ─────────────────────────────────────────
    @app.middleware("http")
    async def add_timing(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
        response.headers["X-Response-Time-Ms"] = str(elapsed_ms)
        if elapsed_ms > 800:
            log.warning(
                "Slow AI response",
                path=request.url.path,
                elapsed_ms=elapsed_ms,
                note="Fix 1: AI must never exceed 800ms",
            )
        return response

    # ── Routers ───────────────────────────────────────────────────────────
    app.include_router(health.router,    prefix="",        tags=["Health"])
    app.include_router(recommend.router, prefix="/v1",     tags=["Recommendations"])
    app.include_router(chat.router,      prefix="/v1",     tags=["Chat"])
    app.include_router(forecast.router,  prefix="/v1",     tags=["Forecast"])
    app.include_router(fraud.router,     prefix="/v1",     tags=["Fraud"])
    app.include_router(embed.router,     prefix="/v1",     tags=["Embeddings"])

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
