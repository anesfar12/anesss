# LUXE POS v5.1 — Embedding Router (text-embedding-3-small)
from __future__ import annotations
import time
from fastapi import APIRouter, HTTPException
from app.models.schemas import EmbedRequest, EmbedResponse
from app.core.config import get_settings

router = APIRouter()

@router.post("/embed", response_model=EmbedResponse, summary="Generate text embeddings (text-embedding-3-small)")
async def embed_texts(body: EmbedRequest) -> EmbedResponse:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")

    start = time.perf_counter()

    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    response = await client.embeddings.create(
        input=body.texts,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
    )

    embeddings = [e.embedding for e in response.data]
    token_count = response.usage.total_tokens if response.usage else 0
    latency_ms = (time.perf_counter() - start) * 1000

    return EmbedResponse(
        embeddings=embeddings, model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
        token_count=token_count, latency_ms=round(latency_ms, 1),
    )
