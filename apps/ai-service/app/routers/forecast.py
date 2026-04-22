# LUXE POS v5.1 — Demand Forecast Router
from __future__ import annotations
import time
from fastapi import APIRouter, Query
from app.models.schemas import ForecastResponse
from app.core.database import get_pool

router = APIRouter()

@router.get("/forecast/{sku_id}", response_model=ForecastResponse, summary="Demand forecast for SKU")
async def get_forecast(sku_id: str, horizon_days: int = Query(default=30, ge=7, le=365)) -> ForecastResponse:
    start = time.perf_counter()
    pool = get_pool()

    # Fetch historical sales velocity
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                AVG(daily_qty) AS avg_daily,
                STDDEV(daily_qty) AS stddev_daily,
                COUNT(*) AS days_with_sales
            FROM (
                SELECT DATE(t.completed_at) AS sale_date, SUM(ti.quantity) AS daily_qty
                FROM transaction_items ti
                JOIN transactions t ON t.id = ti.transaction_id
                JOIN product_variants pv ON pv.id = ti.product_variant_id
                WHERE pv.id = $1::uuid AND t.status = 'completed'
                    AND t.completed_at > NOW() - INTERVAL '90 days'
                GROUP BY 1
            ) daily
        """, sku_id)

    avg_daily = float(row["avg_daily"] or 0) if row else 0.0
    stddev = float(row["stddev_daily"] or 0) if row else 0.0
    predicted = round(avg_daily * horizon_days, 1)
    confidence = min(0.95, (row["days_with_sales"] or 0) / 90.0) if row else 0.0

    latency_ms = (time.perf_counter() - start) * 1000

    return ForecastResponse(
        sku_id=sku_id, predicted_demand=predicted, confidence=round(confidence, 3),
        horizon_days=horizon_days, method="historical_velocity_90d",
        lower_bound=max(0, predicted - 1.96 * stddev * (horizon_days ** 0.5)),
        upper_bound=predicted + 1.96 * stddev * (horizon_days ** 0.5),
        latency_ms=round(latency_ms, 1),
    )
