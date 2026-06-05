# GlobalReach V2.0 — Production Dockerfile
# S082/G04: Node 20 → 22 upgrade path documented
# S089/UPGRADE: Node 22 → 24 LTS (Krypton) — EOL bypass
#   Node 20 Active LTS ends 2026-04-30, Maintenance ends 2027-04
#   Node 24 LTS (v24.11.0+) supported until 2028-04-30
#   Breaking changes handled: V8 13.6, OpenSSL 3.5, npm 11

FROM node:24-alpine AS builder

WORKDIR /app

COPY api/package*.json ./

RUN npm install --omit=dev && npm cache clean --force

FROM node:24-alpine AS production

RUN apk add --no-cache \
    curl \
    tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && apk del tzdata

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY api/ ./api
COPY src/ ./src

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

WORKDIR /app/api

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 CMD curl -f http://localhost:3000/api/v1/health || exit 1

CMD ["node", "server.js"]
