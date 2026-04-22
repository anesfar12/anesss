# ═══════════════════════════════════════════════════════════════════════════
# LUXE POS v5.1 — AI Service Core: Config, Database, ChromaDB
# Pydantic v2 Rust-core settings — Section 4.2
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

from functools import lru_cache
from typing import Any

import asyncpg
import chromadb
from chromadb.config import Settings as ChromaSettings
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# ── Pydantic v2 Settings (Rust-core validation) ────────────────────────────

class AppSettings(BaseSettings):
    """All env vars — Pydantic v2 Rust-core validates every field."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    environment: str = Field(default="development")

    # Database
    database_url: str = Field(default="postgresql://postgres:postgres@localhost:5432/luxepos")

    # ChromaDB 0.7+ (HNSW)
    chromadb_host: str = Field(default="localhost")
    chromadb_port: int = Field(default=8001)

    # Groq — Llama 3.3 + Jais-30b
    groq_api_key: str = Field(default="")
    groq_llama_model: str = Field(default="llama-3.3-70b-versatile")
    groq_jais_model: str = Field(default="jais-30b-chat")    # Arabic NLP

    # OpenAI — text-embedding-3-small
    openai_api_key: str = Field(default="")
    embedding_model: str = Field(default="text-embedding-3-small")
    embedding_dimensions: int = Field(default=1536)

    # HNSW parameters (Section 3.2)
    hnsw_ef_search_standard: int = Field(default=40)
    hnsw_ef_search_vip: int = Field(default=100)    # higher recall for VIP recommendations

    # JWT (matches NestJS secret for internal auth verification)
    jwt_secret: str = Field(default="luxe-dev-secret-change-in-production")

    # CORS
    allowed_origins: list[str] = Field(
        default=["http://localhost:3000", "http://api:3000"]
    )

    # Engineering Fix 8: JIT disabled until Python 3.15
    enable_jit: bool = Field(default=False)


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    return AppSettings()


# ── PostgreSQL 18 async pool ───────────────────────────────────────────────

_pool: asyncpg.Pool | None = None


async def init_db_pool(database_url: str) -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=database_url,
        min_size=2,
        max_size=10,
        command_timeout=30,
        statement_cache_size=100,
    )


async def close_db_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool


# ── ChromaDB 0.7+ HNSW client ─────────────────────────────────────────────

def get_chroma_client(host: str, port: int) -> chromadb.HttpClient:
    """Connect to ChromaDB 0.7+ server with HNSW indexes."""
    return chromadb.HttpClient(
        host=host,
        port=port,
        settings=ChromaSettings(
            anonymized_telemetry=False,
            allow_reset=False,
        ),
    )


# Collections used by LUXE AI
CHROMA_COLLECTIONS = {
    "fragrance_catalog": {
        "description": "Product embeddings — 1536-dim text-embedding-3-small",
        "hnsw_space": "cosine",
        "hnsw_construction_ef": 200,
        "hnsw_M": 16,
    },
    "customer_preferences": {
        "description": "Customer preference vectors",
        "hnsw_space": "cosine",
        "hnsw_construction_ef": 200,
        "hnsw_M": 16,
    },
    "training_events": {
        "description": "AI training event embeddings (high-write)",
        "hnsw_space": "cosine",
        "hnsw_construction_ef": 128,   # lower for insert speed
        "hnsw_M": 8,
    },
}


async def warm_hnsw_indexes(client: chromadb.HttpClient, ef_search: int = 80) -> None:
    """
    Pre-warm HNSW graphs into memory for sub-5ms queries.
    Called at startup — one-time cost (HNSW doesn't need training like IVFFlat).
    """
    for name, config in CHROMA_COLLECTIONS.items():
        try:
            collection = client.get_or_create_collection(
                name=name,
                metadata={
                    "hnsw:space": config["hnsw_space"],
                    "hnsw:construction_ef": config["hnsw_construction_ef"],
                    "hnsw:M": config["hnsw_M"],
                    "hnsw:search_ef": ef_search,
                },
            )
            # Peek to load the index into memory
            collection.peek(limit=1)
        except Exception as e:
            # Non-fatal — collections may not exist yet on first boot
            pass
