# ═══════════════════════════════════════════════════════════════════════════
# LUXE POS v5.1 — NestJS API Dockerfile
# Node 22 LTS | Multi-stage build | Non-root user
# ═══════════════════════════════════════════════════════════════════════════

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ── Dependencies ──────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/database/package*.json ./packages/database/
COPY packages/types/package*.json ./packages/types/
RUN npm ci --workspace=@luxe-pos/api --include-workspace-root

# ── Builder ───────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=@luxe-pos/api

# ── Production image ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./package.json

USER nestjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/main"]
