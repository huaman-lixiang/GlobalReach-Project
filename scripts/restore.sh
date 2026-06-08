#!/usr/bin/env bash
# ==============================================================================
# GlobalReach V2.0 — Remote Backup Strategy (M-D06)
# 从备份归档恢复数据的脚本
#
# Usage:
#   ./scripts/restore.sh <backup_file.tar.gz>              # 全量恢复（交互确认）
#   ./scripts/restore.sh <backup_file.tar.gz> --db          # 仅恢复 PostgreSQL
#   ./scripts/restore.sh <backup_file.tar.gz> --redis       # 仅恢复 Redis
#   ./scripts/restore.sh <backup_file.tar.gz> --grafana     # 仅恢复 Grafana
#   ./scripts/restore.sh <backup_file.tar.gz> --nginx       # 仅恢复 Nginx 配置
#   ./scripts/restore.sh <backup_file.tar.gz> --config      # 仅恢复 docker-compose 配置
#   ./scripts/restore.sh <backup_file.tar.gz> --all -y      # 全量恢复（跳过确认）
#   ./scripts/restore.sh --list <backup_file.tar.gz>        # 列出备份内容
#
# 注意:
#   - 恢复前会停止相关容器，恢复后重启
#   - PostgreSQL 恢复会覆盖目标数据库全部数据!
#   - Redis 恢复会覆盖当前内存数据!
# ==============================================================================

set -euo pipefail

# ======================== 颜色与工具函数 ========================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log_info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $*"; }
confirm()   {
    if [ "${SKIP_CONFIRM:-false}" = "true" ]; then return 0; fi
    echo -ne "${YELLOW}$* [y/N]: ${NC}"
    read -r answer
    [[ "$answer" =~ ^[Yy]$ ]]
}

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 容器名
POSTGRES_CONTAINER="globalreach-postgres"
REDIS_CONTAINER="globalreach-redis"
GRAFANA_CONTAINER="globalreach-grafana"
NGINX_CONTAINER="globalreach-nginx-prod"

DB_USER="${DB_USER:-globalreach_user}"
DB_NAME="${DB_NAME:-globalreach_prod}"

# ======================== 参数解析 ========================
BACKUP_FILE=""
RESTORE_DB=false
RESTORE_REDIS=false
RESTORE_GRAFANA=false
RESTORE_NGINX=false
RESTORE_CONFIG=false
LIST_ONLY=false
SKIP_CONFIRM=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --db)        RESTORE_DB=true; shift ;;
        --redis)     RESTORE_REDIS=true; shift ;;
        --grafana)   RESTORE_GRAFANA=true; shift ;;
        --nginx)     RESTORE_NGINX=true; shift ;;
        --config)    RESTORE_CONFIG=true; shift ;;
        --all)       RESTORE_DB=true; RESTORE_REDIS=true; RESTORE_GRAFANA=true;
                     RESTORE_NGINX=true; RESTORE_CONFIG=true; shift ;;
        -y|--yes)    SKIP_CONFIRM=true; shift ;;
        --list)      LIST_ONLY=true; shift ;;
        -*|*) 
            if [ -f "$1" ]; then
                BACKUP_FILE="$1"
            else
                log_err "未知参数或文件不存在: $1"
                echo "Usage: $0 <backup.tar.gz> [--db|--redis|--grafana|--nginx|--config|--all] [-y]"
                exit 1
            fi
            shift ;;
    esac
done

# 如果没有指定组件且不是 list 模式，默认全量恢复
if [ "$LIST_ONLY" = "false" ] && \
   [ "$RESTORE_DB" = "false" ] && [ "$RESTORE_REDIS" = "false" ] && \
   [ "$RESTORE_GRAFANA" = "false" ] && [ "$RESTORE_NGINX" = "false" ] && \
   [ "$RESTORE_CONFIG" = "false" ]; then
    RESTORE_DB=true; RESTORE_REDIS=true; RESTORE_GRAFANA=true
    RESTORE_NGINX=true; RESTORE_CONFIG=true
fi

# ======================== 校验备份文件 ========================
if [ "$LIST_ONLY" = "false" ]; then
    if [ -z "$BACKUP_FILE" ]; then
        log_err "未指定备份文件!"
        echo "Usage: $0 <backup.tar.gz> [options]"
        exit 1
    fi

    if [ ! -f "$BACKUP_FILE" ]; then
        log_err "备份文件不存在: $BACKUP_FILE"
        exit 1
    fi

    # SHA256 校验
    SHA_FILE="${BACKUP_FILE}.sha256"
    if [ -f "$SHA_FILE" ]; then
        log_info "校验 SHA256 完整性..."
        if (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$SHA_FILE")" 2>/dev/null); then
            log_ok "SHA256 校验通过"
        else
            log_err "SHA256 校验失败! 文件可能已损坏"
            confirm "校验失败仍要继续?" || exit 1
        fi
    fi

    # tar.gz 完整性校验
    log_info "校验 tar.gz 归档完整性..."
    if ! tar -tzf "$BACKUP_FILE" >/dev/null 2>&1; then
        log_err "tar.gz 归档损坏或格式不正确!"
        exit 1
    fi
    log_ok "归档完整性验证通过"
fi

# ======================== 列出模式 ========================
if [ "$LIST_ONLY" = "true" ]; then
    log_info "备份内容清单: ${BACKUP_FILE:-<未指定>}"
    echo "----------------------------------------"
    tar -tzf "$BACKUP_FILE" 2>/dev/null | head -80
    COUNT=$(tar -tzf "$BACKUP_FILE" 2>/dev/null | wc -l)
    echo "----------------------------------------"
    echo "共 ${COUNT} 个文件/目录"
    exit 0
fi

# ======================== 解压到临时目录 ========================
WORK_DIR=$(mktemp -d)
trap 'rm -rf "${WORK_DIR}"' EXIT

log_info "解压备份文件到临时目录..."
tar -xzf "$BACKUP_FILE" -C "${WORK_DIR}" 2>/dev/null
log_ok "解压完成: ${WORK_DIR}"

# 显示 MANIFEST
if [ -f "${WORK_DIR}/MANIFEST.txt" ]; then
    log_info "备份清单:"
    cat "${WORK_DIR}/MANIFEST.txt"
fi

echo ""
echo -e "${BOLD}=============================================${NC}"
echo -e "${BOLD}  GlobalReach V2.0 数据恢复向导 (M-D06)${NC}"
echo -e "${BOLD}=============================================${NC}"
echo -e "  备份文件: $(basename "$BACKUP_FILE")"
echo -e "  恢复组件:"
[ "$RESTORE_DB"      = "true" ] && echo -e "    ${GREEN}[✓]${NC} PostgreSQL 数据库"
[ "$RESTORE_REDIS"   = "true" ] && echo -e "    ${GREEN}[✓]${NC} Redis 缓存数据"
[ "$RESTORE_GRAFANA" = "true" ] && echo -e "    ${GREEN}[✓]${NC} Grafana Dashboard/数据源"
[ "$RESTORE_NGINX"   = "true" ] && echo -e "    ${GREEN}[✓]${NC} Nginx 配置 & SSL证书"
[ "$RESTORE_CONFIG"  = "true" ] && echo -e "    ${GREEN}[✓]${NC} Docker Compose & 监控配置"
echo -e "${BOLD}=============================================${NC}"
echo ""

confirm "⚠️  警告: 此操作将覆盖现有数据! 确认继续?" || exit 1

# ======================== PostgreSQL 恢复 ========================
if [ "$RESTORE_DB" = "true" ]; then
    log_info "[恢复 1/N] PostgreSQL 数据库..."

    PG_DUMP="${WORK_DIR}/postgresql/globalreach_prod.dump"
    PG_SQL="${WORK_DIR}/postgresql/globalreach_prod.sql"

    if [ ! -f "$PG_DUMP" ] && [ ! -f "$PG_SQL" ]; then
        log_warn "  备份中未找到 PostgreSQL dump 文件，跳过"
    else
        confirm "  确认恢复 PostgreSQL 数据库 '${DB_NAME}'? (将覆盖全部数据)" || exit 1

        log_info "  停止 API 容器（避免写入冲突）..."
        docker stop globalreach-api-prod 2>/dev/null || true

        # 使用 pg_restore (custom format) 或 psql (SQL format)
        if [ -f "$PG_DUMP" ]; then
            log_info "  使用 pg_restore 恢复 (custom format)..."
            docker cp "$PG_DUMP" "${POSTGRES_CONTAINER}:/tmp/restore.dump"
            docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
                -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
            docker exec "${POSTGRES_CONTAINER}" pg_restore -U "${DB_USER}" -d "${DB_NAME}" \
                --no-owner --no-privileges --clean /tmp/restore.dump 2>/dev/null
            docker exec "${POSTGRES_CONTAINER}" rm -f /tmp/restore.dump
        elif [ -f "$PG_SQL" ]; then
            log_info "  使用 psql 恢复 (SQL format)..."
            docker cp "$PG_SQL" "${POSTGRES_CONTAINER}:/tmp/restore.sql"
            docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
                -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
            docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
                -f /tmp/restore.sql 2>/dev/null
            docker exec "${POSTGRES_CONTAINER}" rm -f /tmp/restore.sql
        fi

        # 验证恢复结果
        TABLE_COUNT=$(docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
            -c "\dt" 2>/dev/null | grep -c "table" || echo "0")
        log_ok "  PostgreSQL 恢复完成 (检测到约 ${TABLE_COUNT} 张表)"
    fi
fi

# ======================== Redis 恢复 ========================
if [ "$RESTORE_REDIS" = "true" ]; then
    log_info "[恢复 2/N] Redis 数据..."

    RDB_FILE="${WORK_DIR}/redis/dump.rdb"
    AOF_FILE="${WORK_DIR}/redis/appendonly.aof"

    if [ ! -f "$RDB_FILE" ]; then
        log_warn "  备份中未找到 Redis dump.rdb，跳过"
    else
        confirm "  确认恢复 Redis 数据? (将覆盖内存中全部键值)" || exit 1

        log_info "  停止 Redis 容器..."
        docker stop "${REDIS_CONTAINER}" 2>/dev/null || true

        # 获取 redis_data volume 的实际路径
        VOL_PATH=$(docker inspect "${REDIS_CONTAINER}" \
            --format='{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)

        if [ -n "$VOL_PATH" ] && [ -d "$VOL_PATH" ]; then
            log_info "  复制 RDB 到 volume 路径: ${VOL_PATH}"
            cp "$RDB_FILE" "${VOL_PATH}/dump.rdb"
            # 清理旧的 AOF（如有）
            rm -f "${VOL_PATH}/appendonly.aof" 2>/dev/null || true
            if [ -f "$AOF_FILE" ]; then
                cp "$AOF_FILE" "${VOL_PATH}/appendonly.aof"
            fi
        else
            log_warn "  无法获取 volume 路径，尝试通过 docker cp..."
            # 备选方案: 启动临时容器挂载同一 volume
            docker run --rm -v globalreach-project_redis_data:/data \
                -v "$(dirname "$RDB_FILE"):/source" alpine sh -c \
                "cp /source/dump.rdb /data/dump.rdb" 2>/dev/null || \
                log_err "  Volume 恢复失败，请手动复制"
        fi

        log_info "  启动 Redis 容器..."
        docker start "${REDIS_CONTAINER}" 2>/dev/null || true

        # 等待 Redis 就绪
        sleep 3
        if docker exec "${REDIS_CONTAINER}" redis-cli ping 2>/dev/null | grep -q PONG; then
            DBSIZE=$(docker exec "${REDIS_CONTAINER}" redis-cli DBSIZE 2>/dev/null)
            log_ok "  Redis 恢复完成 (当前键数: ${DBSIZE:-unknown})"
        else
            log_warn "  Redis 启动后可能需要几秒恢复"
        fi
    fi
fi

# ======================== Grafana 恢复 ========================
if [ "$RESTORE_GRAFANA" = "true" ]; then
    log_info "[恢复 3/N] Grafana 数据..."

    GRAFANA_DB="${WORK_DIR}/grafana/grafana.db"

    if [ ! -f "$GRAFANA_DB" ]; then
        log_warn "  备份中未找到 grafana.db，跳过"
    else
        confirm "  确认恢复 Grafana 数据? (Dashboard/数据源/用户配置)" || exit 1

        log_info "  停止 Grafana 容器..."
        docker stop "${GRAFANA_CONTAINER}" 2>/dev/null || true

        # 获取 volume 路径并复制
        VOL_PATH=$(docker inspect "${GRAFANA_CONTAINER}" \
            --format='{{range .Mounts}}{{if eq .Destination "/var/lib/grafana"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)

        if [ -n "$VOL_PATH" ] && [ -d "$VOL_PATH" ]; then
            cp "$GRAFANA_DB" "${VOL_PATH}/grafana.db"
            log_ok "  grafana.db 已恢复"
        else
            docker run --rm -v globalreach-project_grafana_data:/var/lib/grafana \
                -v "${WORK_DIR}/grafana:/source" alpine sh -c \
                "cp /source/grafana.db /var/lib/grafana/grafana.db" 2>/dev/null || \
                log_err "  Grafana volume 恢复失败"
        fi

        # 恢复 provisioning 配置
        if [ -d "${WORK_DIR}/grafana/provisioning" ]; then
            cp -r "${WORK_DIR}/grafana/provisioning"* "${PROJECT_ROOT}/grafana/provisioning/" 2>/dev/null || true
            log_ok "  provisioning 配置已恢复"
        fi

        log_info "  启动 Grafana 容器..."
        docker start "${GRAFANA_CONTAINER}" 2>/dev/null || true
        sleep 5
        log_ok "  Grafana 恢复完成"
    fi
fi

# ======================== Nginx 配置恢复 ========================
if [ "$RESTORE_NGINX" = "true" ]; then
    log_info "[恢复 4/N] Nginx 配置..."

    NGINX_SRC="${WORK_DIR}/nginx"
    if [ ! -d "$NGINX_SRC" ]; then
        log_warn "  备份中未找到 nginx 目录，跳过"
    else
        confirm "  确认恢复 Nginx 配置 & SSL证书?" || exit 1

        # 恢复主配置
        [ -f "${NGINX_SRC}/nginx.conf" ] && \
            cp "${NGINX_SRC}/nginx.conf" "${PROJECT_ROOT}/nginx/nginx.conf" && \
            log_ok "  nginx.conf 已恢复"

        # 恢复 conf.d
        [ -d "${NGINX_SRC}/conf.d" ] && \
            cp -r "${NGINX_SRC}/conf.d/"* "${PROJECT_ROOT}/nginx/conf.d/" 2>/dev/null && \
            log_ok "  conf.d 已恢复"

        # 恢复 SSL证书
        [ -d "${NGINX_SRC}/ssl_globalreach" ] && \
            cp -r "${NGINX_SRC}/ssl_globalreach/"* "${PROJECT_ROOT}/nginx/ssl/globalreach/" 2>/dev/null && \
            log_ok "  GlobalReach SSL证书已恢复"

        [ -d "${NGINX_SRC}/ssl_letsencrypt" ] && \
            cp -r "${NGINX_SRC}/ssl_letsencrypt/"* "${PROJECT_ROOT}/nginx/ssl/letsencrypt/" 2>/dev/null && \
            log_ok "  Let's Encrypt 证书已恢复"

        # 重载 Nginx
        if docker exec "${NGINX_CONTAINER}" nginx -t 2>/dev/null; then
            docker exec "${NGINX_CONTAINER}" nginx -s reload 2>/dev/null && \
                log_ok "  Nginx 已重载配置"
        else
            log_warn "  Nginx 配置测试未通过，请手动检查"
        fi
    fi
fi

# ======================== Config 恢复 ========================
if [ "$RESTORE_CONFIG" = "true" ]; then
    log_info "[恢复 5/N] Docker Compose & 监控配置..."

    CONFIG_SRC="${WORK_DIR}/config"
    if [ ! -d "$CONFIG_SRC" ]; then
        log_warn "  备份中未找到 config 目录，跳过"
    else
        confirm "  确认恢复 docker-compose 和监控配置?" || exit 1

        [ -f "${CONFIG_SRC}/docker-compose.prod.yml" ] && \
            cp "${CONFIG_SRC}/docker-compose.prod.yml" "${PROJECT_ROOT}/docker-compose.prod.yml" && \
            log_ok "  docker-compose.prod.yml 已恢复"

        [ -f "${CONFIG_SRC}/prometheus.yml" ] && \
            cp "${CONFIG_SRC}/prometheus.yml" "${PROJECT_ROOT}/prometheus/prometheus.yml" && \
            log_ok "  prometheus.yml 已恢复"

        [ -d "${CONFIG_SRC}/prometheus_rules" ] && \
            cp -r "${CONFIG_SRC}/prometheus_rules/"* "${PROJECT_ROOT}/prometheus/rules/" 2>/dev/null && \
            log_ok "  Prometheus rules 已恢复"

        [ -f "${CONFIG_SRC}/loki-config.yml" ] && \
            cp "${CONFIG_SRC}/loki-config.yml" "${PROJECT_ROOT}/loki/loki-config.yml" && \
            log_ok "  loki-config.yml 已恢复"

        [ -f "${CONFIG_SRC}/tempo-config.yml" ] && \
            cp "${CONFIG_SRC}/tempo-config.yml" "${PROJECT_ROOT}/tempo/tempo-config.yml" && \
            log_ok "  tempo-config.yml 已恢复"

        [ -f "${CONFIG_SRC}/alertmanager.yml" ] && \
            cp "${CONFIG_SRC}/alertmanager.yml" "${PROJECT_ROOT}/alertmanager/alertmanager.yml" && \
            log_ok "  alertmanager.yml 已恢复"

        log_ok "  配置恢复完成 (如需应用新配置，请执行 docker compose up -d)"
    fi
fi

# ======================== 重启服务 & 最终验证 ========================
log_info "重启受影响的容器..."
docker start globalreach-api-prod 2>/dev/null || true

sleep 5

echo ""
echo -e "${BOLD}${GREEN}=============================================${NC}"
echo -e "${BOLD}${GREEN}  恢复完成! 后续验证步骤:${NC}"
echo -e "${BOLD}${GREEN}=============================================${NC}"
echo ""
echo "  1. 验证 PostgreSQL:"
echo "     docker exec globalreach-postgres psql -U ${DB_USER} -d ${DB_NAME} -c '\dt'"
echo ""
echo "  2. 验证 Redis:"
echo "     docker exec globalreach-redis redis-cli DBSIZE"
echo ""
echo "  3. 验证 Grafana:"
echo "     curl http://localhost:3002/api/health"
echo ""
echo "  4. 验证 API:"
echo "     curl http://localhost:3000/api/v1/health"
echo ""
echo "  5. 如修改了 docker-compose，重新部署:"
echo "     docker compose -f docker-compose.prod.yml up -d"
echo ""
echo -e "${BOLD}${GREEN}=============================================${NC}"
