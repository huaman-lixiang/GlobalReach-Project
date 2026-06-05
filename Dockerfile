# GlobalReach V2.0 — Production Dockerfile
# S082/G04: Node 20 → 22 upgrade: change both `node:20-alpine` to `node:22-alpine`
# See ci-cd.yml header for full upgrade checklist

FROM node:20-alpine AS builder

WORKDIR /app

COPY api/package*.json ./

RUN npm install --omit=dev && npm cache clean --force

FROM node:20-alpine AS production

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
