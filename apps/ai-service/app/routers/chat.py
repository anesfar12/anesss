# ═══════════════════════════════════════════════════════════════════════════
# LUXE POS v5.1 — Chat Router (SSE streaming)
# Groq Llama 3.3 (English) + Jais-30b (Arabic / Khaleeji)
# LangGraph for multi-turn stateful consultations
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import time
from typing import AsyncGenerator

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from app.models.schemas import ChatRequest
from app.core.config import get_settings

router = APIRouter()

SYSTEM_PROMPT_EN = """You are LUXE, an expert fragrance consultant for LUXE Parfums boutique in the GCC.
You have deep expertise in:
- Fine fragrances: Amouage, Creed, Tom Ford, Roja Parfums, MFK and more
- Oud, Arabic attars, and Khaleeji fragrance traditions
- Fragrance families, notes, longevity, sillage
- Skin chemistry and how pH affects fragrance projection
You give personalised, knowledgeable, concise advice. Keep responses under 200 words unless asked for detail.
"""

SYSTEM_PROMPT_AR = """أنت "لوكس"، مستشار عطور خبير في بوتيك لوكس للعطور في منطقة الخليج العربي.
لديك خبرة عميقة في:
- العطور الفاخرة: عماقة، كريد، توم فورد، روجا، وغيرها
- العود والعطور العربية والخليجية التقليدية
- عائلات العطور والمكونات والثبات والأثر العطري
- كيمياء البشرة وتأثير الرقم الهيدروجيني على إسقاط العطر
أجب بشكل مختصر ومتخصص. اجعل الردود في حدود 200 كلمة ما لم يُطلب التفصيل.
"""


@router.post(
    "/chat",
    summary="Streaming chat — Groq Llama 3.3 (EN) / Jais-30b (AR)",
)
async def stream_chat(body: ChatRequest, request: Request) -> StreamingResponse:
    settings = get_settings()

    if not settings.groq_api_key:
        # Graceful fallback if Groq not configured
        async def fallback() -> AsyncGenerator[str, None]:
            yield "data: {\"text\": \"AI chat assistant is currently offline.\"}\n\n"
        return StreamingResponse(fallback(), media_type="text/event-stream")

    system_prompt = SYSTEM_PROMPT_AR if body.locale == "ar" else SYSTEM_PROMPT_EN
    model = settings.groq_jais_model if body.locale == "ar" else settings.groq_llama_model

    async def generate() -> AsyncGenerator[str, None]:
        start = time.perf_counter()
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=settings.groq_api_key)

            stream = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": body.message},
                ],
                stream=True,
                max_tokens=512,
                temperature=0.7,
            )

            async for chunk in stream:
                text = chunk.choices[0].delta.content or ""
                if text:
                    import json
                    yield f"data: {json.dumps({'text': text})}\n\n"

            elapsed = (time.perf_counter() - start) * 1000
            yield f"data: {'{'}\"done\": true, \"latency_ms\": {elapsed:.1f}{'}'}\n\n"

        except Exception as e:
            import json
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
