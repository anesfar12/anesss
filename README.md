# LUXE POS — God-Tier System Blueprint v5.1
## GCC Luxury Edition 2026

> Ultra-High-End Perfume Boutique POS | Multi-Brand & Bespoke Manufacturing | High-Net-Worth Individuals (HNWIs) | GCC Region

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT LAYER                                                    │
│  apps/pos (Next.js 15 PWA + CRDT)  │  apps/dashboard           │
│  apps/storefront (SSR + AR)        │  apps/mobile (RN 0.84+)   │
│                           visionOS 3 Spatial Commerce           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS / WSS
┌──────────────────────────────▼──────────────────────────────────┐
│  EDGE: Cloudflare CDN + WAF + DDoS Shield + SSL                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  NestJS Core API (Port 3000) — Modular Monolith                 │
│  Auth │ Sales │ Inventory │ CRM │ Hardware │ Blockchain          │
│  AIAdapterModule (feature-flagged, circuit-broken)              │
└────────┬────────────────────────────────────────────────────────┘
         │ Internal HTTP (feature-flagged)
┌────────▼────────────────────────────────────────────────────────┐
│  Python AI Microservice (Port 8000)                             │
│  FastAPI 0.120+ │ ChromaDB 0.7+ HNSW │ Groq Llama 3.3          │
│  Jais-30b Arabic NLP │ Python 3.14/3.15                         │
└─────────────────────────────────────────────────────────────────┘
         │ BullMQ / Redis
┌────────▼───────────────────────────────────────────────────────┐
│  DATA LAYER                                                      │
│  PostgreSQL 18 (Supabase) + pgvector HNSW                       │
│  Cloudflare R2 (AR assets) │ ChromaDB │ Polygon blockchain       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- Node.js 22+
- Docker & Docker Compose
- Python 3.14+ (for AI service)

### 1. Clone and install
```bash
git clone https://github.com/your-org/luxe-pos.git
cd luxe-pos
cp .env.example .env.local
# Fill in your environment variables
npm install
```

### 2. Start infrastructure
```bash
docker-compose up postgres redis chromadb -d
```

### 3. Run database migrations
```bash
# Apply all SQL files in order
for f in packages/database/sql/*.sql; do
  psql $DATABASE_URL -f "$f"
done
```

### 4. Start all apps
```bash
npm run dev          # runs all apps via Turborepo
```

Apps will be available at:
- **POS Terminal**: http://localhost:3001
- **API**: http://localhost:3000 (Swagger: /api/docs)
- **Dashboard**: http://localhost:3002
- **AI Service**: http://localhost:8002 (docs: /docs)

---

## Project Structure

```
luxe-pos/
├── apps/
│   ├── api/              # NestJS Core (Port 3000)
│   ├── pos/              # Next.js 15 POS Terminal (Port 3001)
│   ├── dashboard/        # Manager BI Dashboard (Port 3002)
│   ├── storefront/       # E-commerce + AR Viewer (Port 3003)
│   ├── mobile/           # React Native 0.84+ / Expo 54
│   └── ai-service/       # Python FastAPI AI (Port 8000)
├── packages/
│   ├── database/         # PostgreSQL 18 schema + migrations
│   ├── types/            # Shared TypeScript types
│   ├── ui/               # Shared UI components
│   └── config/           # Shared configs
├── docker-compose.yml
├── turbo.json
└── .env.example
```

---

## Database Schema (v10.0 — PostgreSQL 18)

| Metric | Count |
|--------|-------|
| Tables | 148 |
| ENUMs | 43 |
| Sequences | 17 |
| Triggers | 63 |
| Functions | 38 |
| Indexes | 190+ |
| RLS Policies | 155+ |
| pg_cron Jobs | 14 |
| Feature Flags | 51 |
| Vector Index | HNSW (all vectors) |

---

## Key Features

### 🔐 8-Layer Security
1. Password + bcrypt (web dashboard)
2. PIN (4–6 digit, hashed) — POS terminal
3. JWT (15min access / 7d refresh)
4. MFA (TOTP) — super_admin + manager
5. Device approval — manager must approve new terminals
6. API Keys (scoped, IP-restricted)
7. Biometric token (Amazon One palm — provider-tokenized)
8. NFC cryptographic SUN message (HMAC-SHA256 via AWS KMS)

### 📡 CRDT Offline-First (Section 7)
- **Shopping cart items**: OR-Set — offline adds merge without conflict
- **Inventory quantity**: PN-Counter — offline sales decrement correctly
- **Customer profile fields**: LWW-Register per field
- **Loyalty points**: PN-Counter — accumulate across terminals
- **Scent Wardrobe**: OR-Set — staff additions merge cleanly
- **Sync SLA**: < 2s on reconnect (delta-state, not full sync)

### 🤖 AI Features (all OFF by default)
Enable via feature flags in database:

```sql
UPDATE feature_flags SET value_boolean = TRUE
WHERE flag_key = 'ai_service_enabled';
```

- Product recommendations (HNSW cosine similarity + Groq Llama 3.3)
- Arabic NLP consultation (Jais-30b — Khaleeji dialect)
- Demand forecasting (90-day velocity model)
- Real-time fraud detection (rule-based + NFC anomaly)
- `ai_data_collection_active = TRUE` by default — logs all interactions

### 📱 Mobile — React Native 0.84+ New Architecture
All native modules use Nitro Modules (zero-latency C++ ↔ JS):
- **NitroNFC**: NTAG 424 DNA read — < 200ms SLA
- **NitroBiometrics**: Face ID / Amazon One — < 100ms / 500ms
- **NitroBarcodeScanner**: Real-time frame analysis — 60fps

### ⛓️ Blockchain (Polygon)
- Digital Passport NFT minted for every sale (async BullMQ — never blocks checkout)
- IPFS metadata via Pinata
- Engineering Fix 4: minting always async — receipt returned immediately

### 🥽 visionOS 3 Spatial Commerce
- USDZ with physics-accurate liquid simulation
- StoreKit 3 in-spatial purchase
- SharePlay Spatial Sessions for VIP + companion
- GLB delivery via Cloudflare R2 CDN

---

## Engineering Fixes (All Applied)

| Fix | Rule | Status |
|-----|------|--------|
| Fix 1 | AI never blocks checkout | ✅ `Promise.race([aiCall, timeout(800ms)])` + circuit breaker |
| Fix 2 | CRDT in pg18 transactions | ✅ Advisory lock via `pg_advisory_xact_lock` |
| Fix 3 | Biometric degrades gracefully | ✅ Falls through to phone lookup |
| Fix 4 | Blockchain always async | ✅ BullMQ queue, receipt returned immediately |
| Fix 5 | Sequence race safety | ✅ All 17 sequences use `nextval()` |
| Fix 6 | HNSW ef_search session-scoped | ✅ VIP=100, standard=40, never in postgresql.conf |
| Fix 7 | Nitro Module JS fallback | ✅ All modules fallback gracefully in Expo Go |
| Fix 8 | Python JIT opt-in | ✅ `PYTHON_JIT=0` default, warned if enabled on <3.15 |

---

## Performance SLAs

| Operation | Target | Implementation |
|-----------|--------|----------------|
| Product search (cached) | < 50ms | Redis + partial index |
| Checkout completion | < 500ms | Async inventory deduction |
| NFC bottle validation | < 200ms | HNSW + KMS verify |
| Dashboard load | < 1s | Pre-aggregated snapshots |
| Offline checkout | 0ms | IndexedDB + Yjs CRDT service worker |
| CRDT merge on reconnect | < 2s | Delta-state merge |
| WebSocket delivery | < 100ms | Socket.IO + Redis pub/sub |
| AI recommendation | < 800ms | Groq + HNSW < 5ms |
| Vector similarity (HNSW) | < 5ms | ef_search=80 at 500K+ vectors |
| Mobile NFC (iPhone 17 Pro) | < 100ms | UWB NFC + NitroNFC sync |

---

## Deployment (~$84–94/month)

| Service | Provider | Cost |
|---------|----------|------|
| PostgreSQL 18 | Supabase Pro | $25 |
| NestJS API | Render.com | $7 |
| Python AI | Render.com / Railway | $7 |
| ChromaDB + Ollama | Hetzner CX22 | $5 |
| Frontend | Vercel Pro | $20 |
| R2 Storage | Cloudflare | $0 |
| CDN + WAF | Cloudflare | $0 |
| Email | Resend | $0 |
| SMS/WhatsApp | Twilio | ~$10 |
| Redis | Upstash | $0 |
| Groq AI | Groq Cloud | ~$10–30 |
| Blockchain | Polygon | $0 |
| **TOTAL** | | **~$84–94/mo** |

---

## Build Phases (24 Weeks)

| Phase | Weeks | Status |
|-------|-------|--------|
| Phase 0 — Foundation | 1 | ✅ DB v10.0, Auth, Feature Flags |
| Phase 1 — Core Sales | 2–4 | ✅ Transactions, Inventory, NFC, Payments |
| Phase 2 — CRM & Black Book | 5–6 | ✅ Customers, Loyalty, Scent Wardrobe |
| Phase 3 — Dashboard | 7–8 | ✅ Analytics, Staff KPIs, Reports |
| Phase 4 — Supplier & Finance | 9–10 | ✅ POs, Double-entry, VAT, Tax-Free |
| Phase 5 — Wholesale | 11–12 | 🔄 Scaffolded |
| Phase 6 — Outreach & AR | 13–14 | ✅ Campaigns, Spatial Commerce |
| Phase 7 — Blockchain & NFC | 15–16 | ✅ Full crypto validation, Digital Passport |
| Phase 8 — AI Bootstrap | 17–18 | ✅ FastAPI + ChromaDB HNSW |
| Phase 9 — AI Go-Live | 19–20 | 🔄 Feature flag toggle ready |
| Phase 10 — Manufacturing | 21–22 | 🔄 Schema ready, module scaffolded |
| Phase 11 — Hardware Polish | 23–24 | ✅ Nitro Modules, CRDT stress test plan |

---

*LUXE POS v5.1.0 — God-Tier 2026 GCC Luxury Edition*
*Supersedes: v5.0, v4.0, v3.0, v2.0, v1.0*
*Classification: Confidential — Engineering Blueprint | April 2026*
