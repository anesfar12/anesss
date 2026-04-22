# ═══════════════════════════════════════════════════════════════════════════
# LUXE POS v5.1 — AI Service Pydantic Models (Rust-core validation)
# Section 4.2: All I/O must use BaseModel — NOT dataclasses or TypedDict
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field, field_validator


# ── Recommendation ────────────────────────────────────────────────────────

class RecommendationRequest(BaseModel):
    """Section 4.3 schema — Rust-core validates all I/O."""
    customer_id: str = Field(..., min_length=36, max_length=36, description="Customer UUID")
    scent_wardrobe: list[str] = Field(default_factory=list, description="Product IDs already owned")
    occasion: Optional[str] = Field(default=None, description="Occasion hint: evening, work, gift")
    locale: str = Field(default="en", pattern=r"^(en|ar)$", description="Language for reasoning")
    limit: int = Field(default=10, ge=1, le=50)
    is_vip: bool = Field(default=False, description="VIP uses higher HNSW ef_search=100")

    @field_validator("customer_id")
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        import re
        if not re.match(r"^[0-9a-f-]{36}$", v):
            raise ValueError("customer_id must be a valid UUID")
        return v


class ProductRecommendation(BaseModel):
    product_id: str
    name: str
    brand_name: Optional[str] = None
    category: str
    cosine_similarity: float = Field(..., ge=0.0, le=1.0)
    reason: str
    locale: str


class RecommendationResponse(BaseModel):
    products: list[ProductRecommendation]
    model_used: str
    latency_ms: float
    locale: str
    hnsw_ef_used: int


# ── Chat ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(..., min_length=1, max_length=100)
    locale: str = Field(default="en", pattern=r"^(en|ar)$")
    customer_id: Optional[str] = Field(default=None, min_length=36, max_length=36)
    context: dict = Field(default_factory=dict)


# ── Forecast ──────────────────────────────────────────────────────────────

class ForecastRequest(BaseModel):
    sku_id: str = Field(..., min_length=36, max_length=36)
    horizon_days: int = Field(default=30, ge=7, le=365)
    include_seasonality: bool = Field(default=True)


class ForecastResponse(BaseModel):
    sku_id: str
    predicted_demand: float
    confidence: float = Field(..., ge=0.0, le=1.0)
    horizon_days: int
    method: str
    lower_bound: float
    upper_bound: float
    latency_ms: float


# ── Fraud Detection ───────────────────────────────────────────────────────

class FraudRequest(BaseModel):
    transaction_id: str = Field(..., min_length=36, max_length=36)


class FraudResponse(BaseModel):
    transaction_id: str
    score: float = Field(..., ge=0.0, le=1.0)
    flagged: bool
    reasons: list[str]
    latency_ms: float


# ── Embeddings ────────────────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=100)
    model: str = Field(default="text-embedding-3-small")


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dimensions: int
    token_count: int
    latency_ms: float


# ── Health ────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    chromadb_connected: bool
    database_connected: bool
    groq_configured: bool
    uptime_seconds: float
