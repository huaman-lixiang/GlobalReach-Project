#!/usr/bin/env bash
# ==============================================================================
# GlobalReach V2.0 — Remote Backup Strategy (M-D06)
# Docker-aware 全量备份脚本
#
# Usage:
#   ./scripts/backup.sh                          # 默认备份到 ./backups/
#   ./scripts/backup.sh /custom/backup/dir        # 指定备份目录
#   BACKUP_DIR=/data/backups ./scripts/backup.sh  # 环境变量指定
#
# 备份内容: PostgreSQL | Redis | Grafana | Nginx配置 | docker-compose
# 输出格式: globalreach_backup_YYYYMMDD_HHMMSS.tar.gz (GPG可选加密)
# ==============================================================================

set -euo pipefail

# ======================== 可配置参数 ========================
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${1:-${PROJECT_ROOT}/backups}}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
LOG_DIR="${PROJECT_ROOT}/logs"
ENCRYPT="${ENCRYPT:-false}"                    # 是否GPG加密
GPG_RECIPIENT="${GPG_RECIPIENT:-}"              # GPG收件人邮箱
TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
DATE_TAG="$(date '+%Y%m%d')"

# 容器名（与 docker-compose.prod.yml 一致）
POSTGRES_CONTAINER="globalreach-postgres"
REDIS_CONTAINER="globalreach-redis"
GRAFANA_CONTAINER="globalreach-grafana"
NGINX_CONTAINER="globalreach-nginx-prod"

# 数据库凭据（从 .env 或默认值）
DB_USER="${DB_USER:-globalreach_user}"
DB_NAME="${DB_NAME:-globalreach_prod}"

# ======================== 颜色输出 ========================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log_info()  { echo -e "${CYAN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ======================== 初始化目录 ========================
mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/backup_${DATE_TAG}.log"
exec > >(tee -a "${LOG_FILE}") 2>&1

log_info "============================================="
log_info "GlobalReach V2.0 远程备份策略 M-D06"
log_info "时间戳: ${TIMESTAMP}"
log_info "备份目标: ${BACKUP_DIR}"
log_info "保留天数: ${RETENTION_DAYS}"
log_info "============================================="

# ======================== 健康检查 ========================
log_info "[步骤 1/7] 服务健康检查..."

check_postgres() {
    log_info "  检查 PostgreSQL 连接..."
    if docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
        log_ok "  PostgreSQL 连接正常"
        return 0
    else
        log_err "  PostgreSQL 连接失败! 容器可能未运行"
        return 1
    fi
}

check_redis() {
    log_info "  检查 Redis 连接..."
    if docker exec "${REDIS_CONTAINER}" redis-cli ping 2>/dev/null | grep -q PONG; then
        log_ok "  Redis 连接正常"
        return 0
    else
        log_err "  Redis 连接失败! 容器可能未运行"
        return 1
    fi
}

if ! check_postgres || ! check_redis; then
    log_err "健康检查未通过，终止备份!"
    exit 1
fi

# ======================== 创建临时工作目录 ========================
WORK_DIR=$(mktemp -d)
trap 'rm -rf "${WORK_DIR}"' EXIT
log_info "[步骤 2/7] 创建临时工作目录: ${WORK_DIR}"

# ======================== PostgreSQL 备份 ========================
log_info "[步骤 3/7] PostgreSQL 数据库备份 (pg_dump SQL格式)..."
PG_DUMP_DIR="${WORK_DIR}/postgresql"
mkdir -p "${PG_DUMP_DIR}"

# 导出全部数据库（SQL格式，带创建语句）
docker exec "${POSTGRES_CONTAINER}" pg_dump \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --no-owner \
    --no-privileges \
    --format=custom \
    --file="/tmp/globalreach_dump_${TIMESTAMP}.dump" 2>/dev/null

docker cp "${POSTGRES_CONTAINER}:/tmp/globalreach_dump_${TIMESTAMP}.dump" \
    "${PG_DUMP_DIR}/globalreach_prod.dump"

# 同时导出SQL文本格式（便于人工审查）
docker exec "${POSTGRES_CONTAINER}" pg_dump \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --no-owner \
    --no-privileges \
    --inserts \
    --column-inserts \
    2>/dev/null > "${PG_DUMP_DIR}/globalreach_prod.sql"

# 列出所有表（用于验证）
docker exec "${POSTGRES_CONTAINER}" psql \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -c "\dt" 2>/dev/null > "${PG_DUMP_DIR}/table_list.txt"

PG_SIZE=$(du -sh "${PG_DUMP_DIR}" 2>/dev/null | cut -f1)
log_ok "  PostgreSQL 备份完成 (${PG_SIZE})"
log_info "  表清单:"
cat "${PG_DUMP_DIR}/table_list.txt" 2>/dev/null | head -20

# 清理容器内临时文件
docker exec "${POSTGRES_CONTAINER}" rm -f "/tmp/globalreach_dump_${TIMESTAMP}.dump" 2>/dev/null || true

# ======================== Redis 备份 ========================
log_info "[步骤 4/7] Redis 数据备份 (BGSAVE + RDB)..."
REDIS_DUMP_DIR="${WORK_DIR}/redis"
mkdir -p "${REDIS_DUMP_DIR}"

# 触发 BGSAVE（后台保存）
log_info "  触发 Redis BGSAVE..."
docker exec "${REDIS_CONTAINER}" redis-cli BGSAVE 2>/dev/null || true

# 等待BGSAVE完成（最多等待30秒）
for i in $(seq 1 30); do
    STATUS=$(docker exec "${REDIS_CONTAINER}" redis-cli LASTSAVE 2>/dev/null || echo "0")
    sleep 1
done

# 复制RDB文件
if docker exec "${REDIS_CONTAINER}" test -f /data/dump.rdb 2>/dev/null; then
    docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${REDIS_DUMP_DIR}/dump.rdb" 2>/dev/null && \
        log_ok "  dump.rdb 已复制"
else
    log_warn "  未找到 dump.rdb（Redis可能无持久化数据）"
fi

# 如果存在AOF文件也一并复制
if docker exec "${REDIS_CONTAINER}" test -f /data/appendonly.aof 2>/dev/null; then
    docker cp "${REDIS_CONTAINER}:/data/appendonly.aof" "${REDIS_DUMP_DIR}/appendonly.aof" 2>/dev/null && \
        log_ok "  appendonly.aof 已复制"
fi

# 导出键信息（用于验证）
docker exec "${REDIS_CONTAINER}" redis-cli DBSIZE 2>/dev/null > "${REDIS_DUMP_DIR}/dbsize.txt"
docker exec "${REDIS_CONTAINER}" redis-cli INFO keyspace 2>/dev/null > "${REDIS_DUMP_DIR}/keyspace_info.txt"

REDIS_SIZE=$(du -sh "${REDIS_DUMP_DIR}" 2>/dev/null | cut -f1)
log_ok "  Redis 备份完成 (${REDIS_SIZE})"

# ======================== Grafana 数据备份 ========================
log_info "[步骤 5/7] Grafana 数据备份 (dashboards/数据源/配置)..."
GRAFANA_DUMP_DIR="${WORK_DIR}/grafana"
mkdir -p "${GRAFANA_DUMP_DIR}"

# 通过 Grafana API 备份（需要容器运行中）
if docker exec "${GRAFANA_CONTAINER}" wget -q -O /dev/null http://localhost:3000/api/health 2>/dev/null; then
    # 备份 dashboard 数据库（SQLite）
    docker cp "${GRAFANA_CONTAINER}:/var/lib/grafana/grafana.db" \
        "${GRAFANA_DUMP_DIR}/grafana.db" 2>/dev/null && log_ok "  grafana.db 已复制"

    # 备份 provisioning 配置
    docker cp "${GRAFANA_CONTAINER}:/etc/grafana/grafana.ini" \
        "${GRAFANA_DUMP_DIR}/grafana.ini" 2>/dev/null || true
    docker cp "${GRAFANA_CONTAINER}:/etc/grafana/provisioning" \
        "${GRAFANA_DUMP_DIR}/provisioning" 2>/dev/null || true

    # 通过API导出dashboard
    GRAFANA_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin123}"
    for ds in $(docker exec "${GRAFANA_CONTAINER}" wget -qO- \
        --auth-no-challenge \
        --http-user=admin \
        --http-password="${GRAFANA_PASSWORD}" \
        "http://localhost:3000/api/datasources" 2>/dev/null | \
        python3 -c "import sys,json; [print(d.get('id','')) for d in json.load(sys.stdin)]" 2>/dev/null); do
        docker exec "${GRAFANA_CONTAINER}" wget -qO- \
            --auth-no-challenge \
            --http-user=admin \
            --http-password="${GRAFANA_PASSWORD}" \
            "http://localhost:3000/api/datasources/${ds}" \
            > "${GRAFANA_DUMP_DIR}/datasource_${ds}.json" 2>/dev/null || true
    done
    log_ok "  Grafana API 数据已导出"
else
    log_warn "  Grafana 容器未就绪，跳过API备份"
    # 尝试直接从volume复制
    docker cp "${GRAFANA_CONTAINER}:/var/lib/grafana" \
        "${GRAFANA_DUMP_DIR}/grafana_volume" 2>/dev/null || true
fi

GRAFANA_SIZE=$(du -sh "${GRAFANA_DUMP_DIR}" 2>/dev/null | cut -f1)
log_ok "  Grafana 备份完成 (${GRAFANA_SIZE})"

# ======================== Nginx 配置备份 ========================
log_info "[步骤 6/7] Nginx 配置备份 (SSL证书 + 配置文件)..."
NGINX_DUMP_DIR="${WORK_DIR}/nginx"
mkdir -p "${NGINX_DUMP_DIR}"

# Nginx 主配置
cp -r "${PROJECT_ROOT}/nginx/nginx.conf" "${NGINX_DUMP_DIR}/" 2>/dev/null || true
cp -r "${PROJECT_ROOT}/nginx/conf.d" "${NGINX_DUMP_DIR}/conf.d" 2>/dev/null || true

# SSL证书（GlobalReach自签名）
if [ -d "${PROJECT_ROOT}/nginx/ssl/globalreach" ]; then
    cp -r "${PROJECT_ROOT}/nginx/ssl/globalreach" "${NGINX_DUMP_DIR}/ssl_globalreach" 2>/dev/null && \
        log_ok "  GlobalReach SSL证书已备份"
fi

# Let's Encrypt 证书
if [ -d "${PROJECT_ROOT}/nginx/ssl/letsencrypt" ]; then
    cp -r "${PROJECT_ROOT}/nginx/ssl/letsencrypt" "${NGINX_DUMP_DIR}/ssl_letsencrypt" 2>/dev/null && \
        log_ok "  Let's Encrypt 证书已备份"
fi

NGINX_SIZE=$(du -sh "${NGINX_DUMP_DIR}" 2>/dev/null | cut -f1)
log_ok "  Nginx 配置备份完成 (${NGINX_SIZE})"

# ======================== docker-compose & 环境配置备份 ========================
log_info "[步骤 6.5/7] Docker Compose 配置备份..."
CONFIG_DUMP_DIR="${WORK_DIR}/config"
mkdir -p "${CONFIG_DUMP_DIR}"

cp "${COMPOSE_FILE}" "${CONFIG_DUMP_DIR}/docker-compose.prod.yml" 2>/dev/null
cp "${PROJECT_ROOT}/Dockerfile" "${CONFIG_DUMP_DIR}/Dockerfile" 2>/dev/null || true
cp "${PROJECT_ROOT}/.env.example" "${CONFIG_DUMP_DIR}/.env.example" 2>/dev/null || true

# Prometheus 配置
cp -r "${PROJECT_ROOT}/prometheus/prometheus.yml" "${CONFIG_DUMP_DIR}/prometheus.yml" 2>/dev/null || true
cp -r "${PROJECT_ROOT}/prometheus/rules" "${CONFIG_DUMP_DIR}/prometheus_rules" 2>/dev/null || true

# Loki 配置
cp -r "${PROJECT_ROOT}/loki/loki-config.yml" "${CONFIG_DUMP_DIR}/loki-config.yml" 2>/dev/null || true

# Tempo 配置
cp -r "${PROJECT_ROOT}/tempo/tempo-config.yml" "${CONFIG_DUMP_DIR}/tempo-config.yml" 2>/dev/null || true

# Alertmanager 配置
cp -r "${PROJECT_ROOT}/alertmanager/alertmanager.yml" "${CONFIG_DUMP_DIR}/alertmanager.yml" 2>/dev/null || true

log_ok "  配置文件备份完成"

# ======================== 打包 + GPG加密（可选） ========================
log_info "[步骤 7/7] 打包备份归档..."
BACKUP_FILENAME="globalreach_backup_${TIMESTAMP}.tar.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

# 生成备份清单
cat > "${WORK_DIR}/MANIFEST.txt" <<EOF
=====================================================================
GlobalReach V2.0 Backup Manifest
=====================================================================
Backup Time:     ${TIMESTAMP}
Generated by:    scripts/backup.sh (M-D06)
Project Root:    ${PROJECT_ROOT}
Docker Compose:  ${COMPOSE_FILE}

Contents:
  postgresql/    — PostgreSQL 15 database dump (SQL + custom format)
  redis/         — Redis 7 RDB/AOF data files
  grafana/       — Grafana dashboards, datasources, config
  nginx/         — Nginx configs, SSL certificates
  config/        — docker-compose, prometheus, loki, tempo configs
  MANIFEST.txt   — This file

PostgreSQL Tables:
$(cat "${PG_DUMP_DIR}/table_list.txt" 2>/dev/null)

Redis Info:
$(cat "${REDIS_DUMP_DIR}/keyspace_info.txt" 2>/dev/null)

File Sizes:
$(du -sh "${WORK_DIR}"/* 2>/dev/null)
=====================================================================
EOF

# 创建 tar.gz 归档
tar -czf "${BACKUP_PATH}" -C "${WORK_DIR}" . 2>/dev/null
TAR_EXIT=$?

if [ ${TAR_EXIT} -ne 0 ]; then
    log_err "  tar.gz 创建失败 (exit code: ${TAR_EXIT})"
    exit 1
fi

# 校验 tar.gz 完整性
if tar -tzf "${BACKUP_PATH}" >/dev/null 2>&1; then
    BACKUP_SIZE=$(du -h "${BACKUP_PATH}" 2>/dev/null | cut -f1)
    FILE_COUNT=$(tar -tzf "${BACKUP_PATH}" 2>/dev/null | wc -l)
    log_ok "  归档创建成功: ${BACKUP_FILENAME} (${BACKUP_SIZE}, ${FILE_COUNT} 个文件)"
else
    log_err "  归档完整性校验失败!"
    exit 1
fi

# 计算 SHA256 校验和
SHA256_SUM=$(sha256sum "${BACKUP_PATH}" 2>/dev/null | awk '{print $1}')
echo "${SHA256_SUM}  ${BACKUP_FILENAME}" > "${BACKUP_PATH}.sha256"
log_ok "  SHA256: ${SHA256_SUM}"

# 可选: GPG 加密
if [ "${ENCRYPT}" = "true" ] && [ -n "${GPG_RECIPIENT}" ]; then
    log_info "  GPG 加密中..."
    gpg --trust-model always --batch --yes \
        --output "${BACKUP_PATH}.gpg" \
        --encrypt --recipient "${GPG_RECIPIENT}" \
        "${BACKUP_PATH}" 2>/dev/null && \
        log_ok "  加密完成: ${BACKUP_FILENAME}.gpg"
fi

# ======================== 清理旧备份（保留策略）========================
log_info "[清理] 执行保留策略: 最近 ${RETENTION_DAYS} 天..."
CLEANED=0
find "${BACKUP_DIR}" -name "globalreach_backup_*.tar.gz*" -type f -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | while read -r old_file; do
    log_warn "  已删除旧备份: $(basename "${old_file}")"
    CLEANED=$((CLEANED + 1))
done
log_info "  清理完成"

# ======================== 备份汇总 ========================
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)
BACKUP_COUNT=$(find "${BACKUP_DIR}" -name "globalreach_backup_*.tar.gz" -type f 2>/dev/null | wc -l)

echo ""
log_info "============================================="
log_info "备份完成汇总"
log_info "============================================="
log_info "  文件名:   ${BACKUP_FILENAME}"
log_info "  大小:     ${BACKUP_SIZE}"
log_info "  SHA256:   ${SHA256_SUM}"
log_info "  路径:     ${BACKUP_PATH}"
log_info "  日志:     ${LOG_FILE}"
log_info "  总备份数: ${BACKUP_COUNT}"
log_info "  占用空间: ${TOTAL_SIZE}"
log_info "============================================="
