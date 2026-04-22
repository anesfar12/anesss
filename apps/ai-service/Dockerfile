# ═══════════════════════════════════════════════════════════════════════════
# LUXE POS v5.1 — Python AI Microservice Dockerfile
# Python 3.14 | Uvicorn with io_uring backend | Non-root user
# Engineering Fix 8: PYTHON_JIT=0 by default
# ═══════════════════════════════════════════════════════════════════════════

FROM python:3.14-slim AS base

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r luxe && useradd -r -g luxe luxe

# ── Dependencies ──────────────────────────────────────────────────────────
FROM base AS deps
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── Production image ──────────────────────────────────────────────────────
FROM base AS runner

COPY --from=deps /usr/local/lib/python3.14/site-packages /usr/local/lib/python3.14/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

COPY --chown=luxe:luxe . .

USER luxe

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
# Fix 8: JIT disabled by default — enable only on Python 3.15+
ENV PYTHON_JIT=0
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--loop", "uvloop", \
     "--http", "httptools", \
     "--log-level", "info"]
