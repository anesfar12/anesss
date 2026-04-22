# LUXE POS v5.1 — Fraud Detection Router
from __future__ import annotations
import time
from fastapi import APIRouter
from app.models.schemas import FraudRequest, FraudResponse
from app.core.database import get_pool

router = APIRouter()

@router.get("/fraud/{transaction_id}", response_model=FraudResponse, summary="Fraud signal for transaction")
async def detect_fraud(transaction_id: str) -> FraudResponse:
    start = time.perf_counter()
    pool = get_pool()
    reasons: list[str] = []
    score = 0.0

    async with pool.acquire() as conn:
        tx = await conn.fetchrow("""
            SELECT t.total, t.channel, t.customer_id,
                   COUNT(ti.id) AS item_count,
                   COUNT(ti.id) FILTER (WHERE ti.nfc_validated = FALSE AND pv.requires_nfc = TRUE) AS unvalidated_nfc
            FROM transactions t
            JOIN transaction_items ti ON ti.transaction_id = t.id
            JOIN product_variants pv ON pv.id = ti.product_variant_id
            WHERE t.id = $1::uuid
            GROUP BY t.id, t.total, t.channel, t.customer_id
        """, transaction_id)

        if tx:
            # Rule: very high value with no customer
            if tx["total"] > 10000 and not tx["customer_id"]:
                score += 0.3
                reasons.append("High-value transaction without customer profile")

            # Rule: NFC-required items not validated
            if tx["unvalidated_nfc"] and tx["unvalidated_nfc"] > 0:
                score += 0.5
                reasons.append(f"{tx['unvalidated_nfc']} item(s) require NFC validation — not scanned")

            # Rule: unusually high item count
            if tx["item_count"] and tx["item_count"] > 20:
                score += 0.2
                reasons.append("Unusual item count (>20)")

            # Check NFC fraud flags
            fraud_count = await conn.fetchval("""
                SELECT COUNT(*) FROM nfc_scan_log
                WHERE fraud_signal = TRUE
                  AND created_at > NOW() - INTERVAL '1 hour'
                  AND created_at > NOW() - INTERVAL '5 minutes'
            """)
            if fraud_count:
                score += 0.4
                reasons.append(f"Recent NFC fraud signals detected ({fraud_count})")

    score = min(1.0, score)
    latency_ms = (time.perf_counter() - start) * 1000

    return FraudResponse(
        transaction_id=transaction_id, score=round(score, 3),
        flagged=score >= 0.5, reasons=reasons, latency_ms=round(latency_ms, 1),
    )
