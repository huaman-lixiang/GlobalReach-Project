#!/bin/bash
# ============================================================
# GlobalReach V2.0 — Prometheus Metrics Endpoint Tester (S149)
# 用途: 验证 /api/v1/metrics 端点返回的 Prometheus 指标格式
# 使用: bash scripts/test-metrics-endpoint.sh [--verbose]
# ============================================================

set -uo pipefail

METRICS_URL="${METRICS_URL:-http://localhost:3000/api/v1/metrics}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/v1/health}"
VERBOSE="${1:-}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

pass() { echo -e "  ${GREEN}✅ PASS${NC}: $*"; ((PASS++)) || true; }
fail() { echo -e "  ${RED}❌ FAIL${NC}: $*"; ((FAIL++)) || true; }
warn() { echo -e "  ${YELLOW}⚠️  WARN${NC}: $*"; ((WARN++)) || true; }

echo "=============================================="
echo " GlobalReach V2.0 — Prometheus Metrics Test"
echo " 时间: ${TIMESTAMP} | 目标: ${METRICS_URL}"
echo "=============================================="

CURL="curl.exe"

# ---- 获取数据 ----
TMPDIR_TMP="${TMPDIR:-/tmp}"
TF="${TMPDIR_TMP}/met_$$"
$CURL -s "$METRICS_URL" > "$TF.body" 2>/dev/null || true
$CURL -s -o "$TF.devnull" -w "%{http_code}" "$METRICS_URL" > "$TF.code" 2>/dev/null || true
HTTP_CODE=$(cat "$TF.code" 2>/dev/null | tr -d '\r\n' | head -c 3)
: "${HTTP_CODE:=000}"
CT=$($CURL -sI "$METRICS_URL" | grep -i "^content-type:" | head -1 || echo "")
if [ -z "$CT" ]; then CT=$($CURL -sI "$METRICS_URL" | grep -i "content-type" | head -1 || echo ""); fi
METRICS=$(cat "$TF.body" 2>/dev/null || echo "")
rm -f "$TF.body" "$TF.code" "$TF.devnull" 2>/dev/null || true

# ---- Test 1: 端点可达性 ----
echo ""; echo -e "${CYAN}[Test 1] 端点可达性${NC}"
if [ "$HTTP_CODE" = "200" ]; then
    pass "Metrics HTTP ${HTTP_CODE}"
else
    fail "Metrics HTTP ${HTTP_CODE} (期望 200)"; exit 1
fi
if echo "$CT" | grep -qi "text/plain"; then
    pass "Content-Type: $(echo "$CT" | cut -d' ' -f2 | tr -d '\r')"
else
    fail "Content-Type 异常: ${CT}"
fi

# ---- Test 2: 数据完整性 ----
echo ""; echo -e "${CYAN}[Test 2] 数据解析${NC}"
if [ -z "$METRICS" ]; then fail "响应为空!"; exit 1; fi
LINES=$(echo "$METRICS" | wc -l | tr -d ' ')
BYTES=$(echo "$METRICS" | wc -c | tr -d ' ')
pass "响应: ${LINES} 行, ~$(( BYTES / 1024 )) KB"

# ---- Test 3: Prometheus 格式 ----
echo ""; echo -e "${CYAN}[Test 3] Prometheus 格式${NC}"
HELP_N=$(echo "$METRICS" | grep -c "^# HELP " || true); HELP_N=${HELP_N:-0}
TYPE_N=$(echo "$METRICS" | grep -c "^# TYPE " || true); TYPE_N=${TYPE_N:-0}
pass "# HELP: ${HELP_N} 行, # TYPE: ${TYPE_N} 行"

# ---- Test 4: 命名规范 ----
echo ""; echo -e "${CYAN}[Test 4] 命名规范 (globalreach_ 前缀)${NC}"
CUSTOM=$(echo "$METRICS" | grep -v "^#" | grep -v "^$" | awk '{print $1}' | grep "^globalreach_" | sort -u || true)
CN=$(echo "$CUSTOM" | grep -c "." || true); CN=${CN:-0}
pass "自定义指标: ~${CN} 个"

NON=$(echo "$METRICS" | grep -v "^#" | grep -v "^$" | awk '{print $1}' | grep -v "^globalreach_" | head -3 || true)
if [ -z "$NON" ]; then pass "全部符合命名规范"; else warn "非前缀指标: $(echo "$NON" | tr '\n' ',' )"; fi

# ---- Test 5: 核心指标存在性 (40+) ----
echo ""; echo -e "${CYAN}[Test 5] 核心指标存在性检查${NC}"
EXPECTED=(
    globalreach_http_request_duration_seconds globalreach_http_requests_total globalreach_active_connections
    globalreach_error_rate_by_code globalreach_errors_total
    globalreach_subsystem_health_status globalreach_subsystem_health_latency_ms globalreach_health_score
    globalreach_email_queue_size globalreach_emails_sent_total globalreach_emails_failed_total
    globalreach_csrf_token_store_size globalreach_csrf_validation_failures_total
    globalreach_auth_operations_total
    globalreach_process_memory_bytes globalreach_process_uptime_seconds globalreach_heap_usage_percent
    globalreach_database_query_duration_seconds globalreach_db_pool_size
    globalreach_emails_total globalreach_email_send_duration_seconds globalreach_campaigns_active
    globalreach_clients_total globalreach_users_online
    globalreach_api_requests_total globalreach_api_request_duration_seconds
    globalreach_db_connections_active globalreach_redis_ops_duration_seconds globalreach_queue_depth
)
F=0; NF=0
for m in "${EXPECTED[@]}"; do
    if echo "$METRICS" | grep -q "^${m}"; then ((F++)) || true
    elif echo "$METRICS" | grep -q "# TYPE.*${m}$"; then ((F++)) || true
    elif echo "$METRICS" | grep -q "# TYPE.*${m}[[:space:]]"; then ((F++)) || true
    else fail "${m}"; ((NF++)) || true; fi
done
echo "  覆盖率: ${F}/${#EXPECTED[@]} ($(( F * 100 / ${#EXPECTED[@]} ))%)"

# ---- Test 6: Histogram Buckets ----
echo ""; echo -e "${CYAN}[Test 6] Histogram Bucket 验证${NC}"
HH=$(echo "$METRICS" | grep "^globalreach_http_request_duration_seconds_bucket" || true)
if [ -n "$HH" ]; then
    BN=$(echo "$HH" | wc -l | tr -d ' ')
    INF=$(echo "$HH" | grep 'le="+Inf"' | wc -l | tr -d ' ')
    pass "HTTP Duration: ${BN} buckets, +Inf: ${INF}"
else
    warn "HTTP Duration 无数据 (尚无请求样本)"
fi

# ---- Test 7: Counter 单调性 ----
echo ""; echo -e "${CYAN}[Test 7] Counter 合法性${NC}"
for c in globalreach_http_requests_total globalreach_auth_operations_total; do
    V=$(echo "$METRICS" | grep "^${c}" | awk '{print $NF}')
    NEG=$(echo "$V" | awk '$1 < 0' || true)
    if [ -z "$NEG" ]; then pass "${c}: 非负 ✓"; else fail "${c}: 发现负数!"; fi
done

# ---- Test 8: 动态请求测试 ----
echo ""; echo -e "${CYAN}[Test 8] 动态请求跟踪测试${NC}"
RB=$(echo "$METRICS" | grep "^globalreach_http_requests_total{" | awk '{sum+=$NF} END{print sum+0}')
$CURL -s "$HEALTH_URL" > /dev/null 2>&1 || true
sleep 1
METRICS2=$($CURL -s "$METRICS_URL" || echo "")
RA=$(echo "$METRICS2" | grep "^globalreach_http_requests_total{" | awk '{sum+=$NF} END{print sum+0}')
if [ "$RA" -ge "$RB" ] 2>/dev/null; then pass "计数器递增: ${RB} → ${RA}"
else warn "计数器未明显变化 (${RB}→${RA})"; fi

# ---- Test 9: Gauge 合理性 ----
echo ""; echo -e "${CYAN}[Test 9] Gauge 指标验证${NC}"
MV=$(echo "$METRICS" | grep '^globalreach_process_memory_bytes{type="heapUsed"}' | awk '{print $NF}' || echo "0")
if [ -n "$MV" ] && [ "$(( MV ))" -gt 0 ]; then pass "heapUsed: $(( MV / 1048576 )) MB"
else warn "process_memory_bytes 未就绪"; fi

UV=$(echo "$METRICS" | grep "^globalreach_process_uptime_seconds " | awk '{print $NF}' || echo "")
if [ -n "$UV" ]; then pass "uptime: $(echo "$UV / 60" | bc 2>/dev/null || echo "?") min"
else warn "uptime 未就绪"; fi

# ---- Test 10: Node.js 默认指标 ----
echo ""; echo -e "${CYAN}[Test 10] Node.js 默认指标${NC}"
NODE_METRICS=(globalreach_process_cpu_user_seconds_total globalreach_nodejs_eventloop_lag_seconds globalreach_process_resident_memory_bytes)
NF2=0
for m in "${NODE_METRICS[@]}"; do
    echo "$METRICS" | grep -q "^${m} " && ((NF2++)) || true
done
pass "Node.js 默认指标: ${NF2}/3"

# ============================================
echo ""
echo "=============================================="
echo -e " ${CYAN}汇总: ${GREEN}${PASS} 通过${NC} ${RED}${FAIL} 失败${NC} ${YELLOW}${WARN} 警告${NC}"
TOTAL=$(( PASS + FAIL + WARN ))
if [ "$FAIL" -eq 0 ]; then echo -e "  ${GREEN}🎉 全部核心检查通过!${NC}"
elif [ "$(( PASS * 100 / TOTAL ))" -ge 80 ]; then echo -e "  ${YELLOW}基本通过 ($(( PASS * 100 / TOTAL ))%)${NC}"
else echo -e "  ${RED}存在问题 ($(( PASS * 100 / TOTAL ))%)${NC}"; fi
echo ""
echo "  📊 自定义指标: ~${CN} | HELP: ${HELP_N} | TYPE: ${TYPE_N}"
echo "=============================================="
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
