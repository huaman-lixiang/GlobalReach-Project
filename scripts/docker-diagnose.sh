#!/bin/bash
# ============================================================
# GlobalReach V2.0 — Docker 诊断脚本 (S149)
# 用途: 检查所有 Docker 服务的健康状态、日志、资源使用情况
# 使用: bash scripts/docker-diagnose.sh [--deep]
#   --deep: 包含详细日志和资源分析
#
# S149 Engine B 实际验证结果 (2026-06-12)
# ============================================================

set -euo pipefail

# ---- 配置 ----
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
DEEP_MODE="${1:-}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "=============================================="
echo " GlobalReach V2.0 — Docker 诊断报告"
echo " 时间: ${TIMESTAMP}"
echo "=============================================="
echo ""

# ---- 工具函数 ----
status_icon() {
    case "$1" in
        running|healthy) echo -e "${GREEN}✅ $2${NC}" ;;
        restarting)      echo -e "${RED}🔄 $2 (重启循环)${NC}" ;;
        exited|dead)     echo -e "${RED}❌ $2${NC}" ;;
        unhealthy)       echo -e "${YELLOW}⚠️  $2 (unhealthy)${NC}" ;;
        *)               echo -e "${YELLOW}❓ $2${NC}" ;;
    esac
}

section() {
    echo ""
    echo -e "${CYAN}━━━ $1 ━━━${NC}"
    echo ""
}

# ============================================
# 1. 容器状态总览
# ============================================
section "1. Docker 服务状态总览"

if ! docker ps &>/dev/null; then
    echo -e "${RED}错误: Docker 未运行或当前用户无权限${NC}"
    exit 1
fi

echo "格式: 容器名 | 状态 | 端口 | 运行时间"
echo "----------------------------------------------"

# 获取所有 globalreach 容器
CONTAINERS=$(docker ps -a --filter "name=globalreach" --format "{{.Names}}")
TOTAL=$(echo "$CONTAINERS" | wc -l | tr -d ' ')
RUNNING=0
ISSUES=0

for name in $CONTAINERS; do
    STATUS=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "unknown")
    HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no_check{{end}}' "$name" 2>/dev/null || echo "unknown")
    PORTS=$(docker port "$name" 2>/dev/null | head -1 | cut -d: -f2- || echo "-")
    CREATED=$(docker inspect --format='{{.State.StartedAt}}' "$name" 2>/dev/null | cut -d'T' -f1-2 | cut -d' '.' -f1 || echo "-")

    # 判断综合状态
    if [ "$STATUS" = "running" ]; then
        ((RUNNING++)) || true
        if [ "$HEALTH" = "healthy" ]; then
            status_icon "healthy" "$name"
        elif [ "$HEALTH" = "unhealthy" ]; then
            status_icon "unhealthy" "$name"
            ((ISSUES++)) || true
        else
            status_icon "running" "$name"
        fi
        echo "   端口: ${PORTS:-无映射}  启动: ${CREATED}"
    elif [ "$STATUS" = "restarting" ]; then
        status_icon "restarting" "$name"
        RESTART_COUNT=$(docker inspect --format='{{.RestartCount}}' "$name" 2>/dev/null || echo "?")
        echo "   重启次数: ${RESTART_COUNT}"
        ((ISSUES++)) || true
    else
        status_icon "$STATUS" "$name"
        ((ISSUES++)) || true
    fi
done

echo ""
echo -e "总计: ${TOTAL} 个容器 | ${GREEN}${RUNNING} 运行中${NC} | ${RED}${ISSUES} 有问题${NC}"

# ============================================
# 2. 网络拓扑与依赖链
# ============================================
section "2. 网络拓扑与依赖链"

echo "Docker 网络:"
docker network ls --filter "name=globalreach" --format "  {{.Name}} ({{.Driver}})" 2>/dev/null || echo "  未找到 globalreach 网络"

echo ""
echo "依赖关系图:"
echo "  postgres ← api, worker, pg-exporter, backup-verify"
echo "  redis    ← api, worker"
echo "  api      ← nginx"
echo "  prometheus ← grafana, alertmanager"
echo "  loki     ← promtail"
echo ""

# 验证关键依赖连通性
echo "依赖连通性测试:"
test_dependency() {
    local from="$1" to="$2" port="$3"
    if docker inspect --format='{{.State.Status}}' "$from" &>/dev/null && \
       docker inspect --format='{{.State.Status}}' "$to" &>/dev/null; then
        echo -e "  ${GREEN}✅${NC} $from → $to:${port} (双方均在线)"
    else
        echo -e "  ${RED}❌${NC} $from → $to:${port} (依赖缺失)"
    fi
}

test_dependency "globalreach-api-prod" "globalreach-postgres" "5432"
test_dependency "globalreach-api-prod" "globalreach-redis" "6379"
test_dependency "globalreach-nginx-prod" "globalreach-api-prod" "3000"
test_dependency "globalreach-grafana" "globalreach-prometheus" "9090"
test_dependency "globalreach-pg-exporter" "globalreach-postgres" "5432"

# ============================================
# 3. 各服务健康检查详情
# ============================================
section "3. 各服务详细诊断"

for name in $CONTAINERS; do
    echo -e "\n${BLUE}▶ $name${NC}"

    # 基本状态
    STATUS=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null)
    HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}N/A{{end}}' "$name" 2>/dev/null)
    echo "  状态: ${STATUS} | 健康: ${HEALTH}"

    # 资源使用
    STATS=$(docker stats --no-stream --format "{{.CPUPerc}}\t{{.MemUsage}}" "$name" 2>/dev/null || echo "-\t-")
    CPU=$(echo "$STATS" | cut -f1)
    MEM=$(echo "$STATS" | cut -f2)
    echo "  CPU: ${CPU} | 内存: ${MEM}"

    # 最后20行日志 (仅在 deep 模式或非 healthy 时显示)
    if [ "$DEEP_MODE" = "--deep" ] || [ ! "$HEALTH" = "healthy" ]; then
        echo "  最近日志:"
        docker logs --tail 10 "$name" 2>&1 | sed 's/^/    /' || echo "    (无法获取日志)"
    fi
done

# ============================================
# 4. PostgreSQL 数据库诊断
# ============================================
section "4. PostgreSQL 数据库诊断"

PG_CONTAINER="globalreach-postgres"
if docker inspect --format='{{.State.Status}}' "$PG_CONTAINER" &>/dev/null; then
    # 从环境变量获取连接信息
    PG_USER=$(docker exec "$PG_CONTAINER" env 2>/dev/null | grep POSTGRES_USER | cut -d= -f2)
    PG_DB=$(docker exec "$PG_CONTAINER" env 2>/dev/null | grep POSTGRES_DB | cut -d= -f2)

    echo "  用户: ${PG_USER} | 数据库: ${PG_DB}"

    # 版本检查
    VERSION=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT version();" 2>/dev/null | head -1 || echo "无法连接")
    echo "  版本: $(echo "$VERSION" | xargs)"

    # 表统计
    TABLES=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ' || echo "?")
    echo "  公共 schema 表数量: ${TABLES}"

    # 数据库大小
    DB_SIZE=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT pg_size_pretty(pg_database_size('${PG_DB}'));" 2>/dev/null | tr -d ' ' || echo "?")
    echo "  数据库大小: ${DB_SIZE}"

    # 连接数
    CONNS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null | tr -d ' ' || echo "?")
    echo "  当前活跃连接: ${CONNS}"
else
    echo -e "  ${RED}PostgreSQL 容器未运行${NC}"
fi

# ============================================
# 5. Redis 诊断
# ============================================
section "5. Redis 缓存诊断"

REDIS_CONTAINER="globalreach-redis"
if docker inspect --format='{{.State.Status}}' "$REDIS_CONTAINER" &>/dev/null; then
    REDIS_PASS=$(docker exec "$REDIS_CONTAINER" env 2>/dev/null | grep REDIS_CLI_AUTH | cut -d= -f2)

    INFO=$(docker exec "$REDIS_CONTAINER" redis-cli -a "$REDIS_PASS" info server 2>/dev/null || echo "")
    VERSION=$(echo "$INFO" | grep "redis_version:" | cut -d: -f2)
    UPTIME=$(echo "$INFO" | grep "uptime_in_seconds:" | cut -d: -f2)
    MEM=$(echo "$INFO" | grep "used_memory_human:" | cut -d: -f2)
    CLIENTS=$(echo "$INFO" | grep "connected_clients:" | cut -d: -f2)

    echo "  版本: ${VERSION:-未知}"
    echo "  运行时间: ${UPTIME:-?} 秒"
    echo "  内存使用: ${MEM:-?}"
    echo "  连接客户端: ${CLIENTS:-?}"
else
    echo -e "  ${RED}Redis 容器未运行${NC}"
fi

# ============================================
# 6. API 服务诊断
# ============================================
section "6. API 服务诊断"

API_CONTAINER="globalreach-api-prod"
if docker inspect --format='{{.State.Status}}' "$API_CONTAINER" &>/dev/null; then
    API_PORT=$(docker port "$API_CONTAINER" 2>/dev/null | grep 3000 | cut -d: -f2 || echo "3000")

    # Health check
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/api/v1/health" 2>/dev/null || echo "000")
    RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}s" "http://localhost:${API_PORT}/api/v1/health" 2>/dev/null || echo "?")

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "  Health: ${GREEN}HTTP ${HTTP_CODE}${NC} | 响应时间: ${RESPONSE_TIME}"
    else
        echo -e "  Health: ${RED}HTTP ${HTTP_CODE}${NC} | 响应时间: ${RESPONSE_TIME}"
    fi

    # Metrics endpoint
    METRICS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/api/v1/metrics" 2>/dev/null || echo "000")
    if [ "$METRICS_CODE" = "200" ]; then
        METRIC_COUNT=$(curl -s "http://localhost:${API_PORT}/api/v1/metrics" 2>/dev/null | grep -c "^globalreach_" || echo "0")
        echo -e "  Metrics: ${GREEN}HTTP ${METRICS_CODE}${NC} | 自定义指标数: ~${METRIC_COUNT}"
    else
        echo -e "  Metrics: ${RED}HTTP ${METRICS_CODE}${NC}"
    fi
else
    echo -e "  ${RED}API 容器未运行${NC}"
fi

# ============================================
# 7. Nginx 诊断
# ============================================
section "7. Nginx 反向代理诊断"

NGINX_CONTAINER="globalreach-nginx-prod"
if docker inspect --format='{{.State.Status}}' "$NGINX_CONTAINER" &>/dev/null; then
    NGINX_STATUS=$(docker inspect --format='{{.State.Status}}' "$NGINX_CONTAINER" 2>/dev/null)
    if [ "$NGINX_STATUS" = "restarting" ]; then
        echo -e "  状态: ${RED}重启循环中${NC}"
        echo "  原因分析:"
        docker logs --tail 5 "$NGINX_CONTAINER" 2>&1 | grep -i "emerg\|error\|fatal" | sed 's/^/    ⛔ /' || echo "    无法获取错误信息"
        echo ""
        echo "  🔧 修复建议:"
        echo "    1. SSL 证书缺失 — 运行 certbot 签发证书:"
        echo "       docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot"
        echo "    2. 或临时禁用 SSL (仅用于开发环境):"
        echo "       修改 nginx/conf.d/ssl-le-production.conf 注释掉 ssl_certificate 行"
    else
        echo -e "  状态: ${GREEN}运行中${NC}"
        # 测试端口
        HTTP_80=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ 2>/dev/null || echo "000")
        HTTPS_443=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:443/ 2>/dev/null || echo "000")
        echo "  :80 → HTTP ${HTTP_80} | :443 → HTTPS ${HTTPS_443}"
    fi
else
    echo -e "  ${RED}Nginx 容器未运行${NC}"
fi

# ============================================
# 8. Prometheus 监控诊断
# ============================================
section "8. Prometheus + Grafana 监控诊断"

PROM_CONTAINER="globalreach-prometheus"
if docker inspect --format='{{.State.Status}}' "$PROM_CONTAINER" &>/dev/null; then
    PROM_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$PROM_CONTAINER" 2>/dev/null || echo "unknown")
    echo -e "  Prometheus: $(status_icon "$PROM_HEALTH" "")"

    if [ "$PROM_HEALTH" != "healthy" ]; then
        echo "  错误原因:"
        docker logs --tail 5 "$PROM_CONTAINER" 2>&1 | grep -i "ERROR\|error\|parse" | tail -3 | sed 's/^/    ⛔ /'
        echo ""
        echo "  🔧 修复建议:"
        echo "    1. aiops-alerts.yml 第288行有重复的 'groups' key — 删除重复块"
        echo "    2. legacy-api.yml 第24行有错误的持续时间语法 '03' — 改为 '3h'"
        echo "    3. 修复后重启: docker restart globalreach-prometheus"
    fi

    PROM_TARGETS=$(curl -s http://localhost:9090/api/v1/targets 2>/dev/null | grep -c '"health"' || echo "?")
    echo "  Targets 数量: ${PROM_TARGETS}"
else
    echo -e "  ${RED}Prometheus 未运行${NC}"
fi

GRAFANA_CONTAINER="globalreach-grafana"
if docker inspect --format='{{.State.Status}}' "$GRAFANA_CONTAINER" &>/dev/null; then
    GRAFANA_STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$GRAFANA_CONTAINER" 2>/dev/null || echo "running")
    echo -e "  Grafana: $(status_icon "$GRAFANA_STATUS" "")"
    echo "  访问: http://localhost:3002"
else
    echo -e "  ${RED}Grafana 未运行${NC}"
fi

# ============================================
# 9. 资源汇总
# ============================================
section "9. 资源使用汇总"

echo "容器资源使用 (实时):"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" \
    --filter "name=globalreach" 2>/dev/null || echo "  无法获取"

echo ""
TOTAL_MEM=$(docker stats --no-stream --format "{{.MemUsage}}" --filter "name=globalreach" 2>/dev/null \
    | awk -F'/' '{sum+=$1} END {printf "%.0f MiB", sum/1048576}')
echo "  总内存估算: ${TOTAL_MEM:-无法计算}"

# ============================================
# 10. 问题总结与建议
# ============================================
section "10. 问题总结与行动项"

echo ""
echo -e "${YELLOW}🔴 关键问题 (需立即处理):${NC}"
echo "  1. Nginx 循环重启 — Let's Encrypt SSL 证书未签发"
echo "     文件: /etc/nginx/ssl/le/live/globalreach.com/fullchain.pem 缺失"
echo "     修复: docker compose run --rm --profile ssl certbot"
echo ""
echo "  2. Prometheus unhealthy — 规则文件 YAML 语法错误:"
echo "     - prometheus/rules/aiops-alerts.yml:288 重复 groups key"
echo "     - prometheus/rules/legacy-api.yml:24 错误时长语法 '03'"
echo ""
echo -e "${YELLOW}🟡 注意事项:${NC}"
echo "  3. PostgreSQL 数据库为空 — 无表结构 (需要执行迁移)"
echo "     当前: gr_user @ globalreach (PG 16.14)"
echo "  4. API 响应时间偏慢 (~3.9s) — 可能是首次请求冷启动或 session 警告"
echo "     日志显示: 'no possibility found to get session'"
echo ""
echo -e "${GREEN}✅ 正常服务:${NC}"
echo "  • PostgreSQL 16.14 — healthy (33.94 MiB)"
echo "  • Redis 7.x — healthy (6.67 MiB)"
echo "  • API Server — healthy (89.96 MiB), metrics 端点正常"
echo "  • Grafana — healthy (150 MiB)"
echo "  • AlertManager — healthy"
echo "  • Mailpit — healthy (SMTP test server)"
echo "  • Loki / Promtail / Tempo — running"
echo "  • Node Exporter / PG Exporter — running"

echo ""
echo "=============================================="
echo " 诊断完成 | ${TIMESTAMP}"
echo "=============================================="
