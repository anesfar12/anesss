# LUXE POS v5.1 — Health Router
from __future__ import annotations
import time
from fastapi import APIRouter, Request
from app.models.schemas import HealthResponse
from app.core.config import get_settings

router = APIRouter()
_start_time = time.time()

@router.get("/health", response_model=HealthResponse, summary="AI service health check")
async def health(request: Request) -> HealthResponse:
    settings = get_settings()

    # Check ChromaDB
    chroma_ok = False
    try:
        chroma = getattr(request.app.state, "chroma", None)
        if chroma:
            chroma.heartbeat()
            chroma_ok = True
    except Exception:
        pass

    # Check database
    db_ok = False
    try:
        from app.core.database import get_pool
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        pass

    return HealthResponse(
        status="healthy" if chroma_ok and db_ok else "degraded",
        version="5.1.0",
        chromadb_connected=chroma_ok,
        database_connected=db_ok,
        groq_configured=bool(settings.groq_api_key),
        uptime_seconds=round(time.time() - _start_time, 1),
    )
