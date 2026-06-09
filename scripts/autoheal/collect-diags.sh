#!/bin/bash
# ============================================
# S132/O01: AIOps Auto-Healing Script - L1: Diagnostics Collection
# ============================================
#
# 功能：收集诊断信息（logs + metrics + 容器状态）
# 级别：L1 (信息收集) — 无需审批，自动执行
# 用法：./collect-diags.sh --container <name> [--output-dir <path>]
#
# 安全特性：
#   - 参数验证（容器名白名单检查可选）
#   - 输出目录自动创建
#   - 超时保护（默认 60 秒）
#   - 执行日志记录

set -euo pipefail

# ============================================
# 配置
# ============================================

SCRIPT_NAME="collect-diags"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_PREFIX="[AIOps/L1/${SCRIPT_NAME}]"
OUTPUT_BASE_DIR="${AIOPS_DIAGS_DIR:-/var/tmp/aiops-diagnostics}"
TIMEOUT_SECONDS=${DIAGS_TIMEOUT:-60}

# 颜色输出（如果终端支持）
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    NC=''
fi

# ============================================
# 参数解析
# ============================================

CONTAINER=""
OUTPUT_DIR=""

show_help() {
    cat << EOF
Usage: $0 --container <name> [--output-dir <path>] [--help]

Options:
  --container <name>   Target container name (required)
  --output-dir <path>  Output directory for diagnostics (default: /var/tmp/aiops-diagnostics)
  --help               Show this help message

Examples:
  $0 --container globalreach-api
  $0 --container globalreach-api --output-dir /tmp/diags

Exit Codes:
  0  Success
  1  General error
  2  Container not found
  3  Timeout exceeded
  4  Permission denied
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --container)
            CONTAINER="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo -e "${LOG_PREFIX} ${RED}Unknown option: $1${NC}" >&2
            show_help
            exit 1
            ;;
    esac
done

# 验证必填参数
if [ -z "$CONTAINER" ]; then
    echo -e "${LOG_PREFIX} ${RED}ERROR: --container is required${NC}" >&2
    exit 1
fi

# 设置输出目录
if [ -z "$OUTPUT_DIR" ]; then
    OUTPUT_DIR="${OUTPUT_BASE_DIR}/${CONTAINER}_${TIMESTAMP}"
fi

# ============================================
# 日志函数
# ============================================

log_info() {
    echo -e "${LOG_PREFIX} ${GREEN}INFO:${NC} $*"
}

log_warn() {
    echo -e "${LOG_PREFIX} ${YELLOW}WARN:${NC} $*" >&2
}

log_error() {
    echo -e "${LOG_PREFIX} ${RED}ERROR:${NC} $*" >&2
}

# ============================================
# 前置检查
# ============================================

pre_check() {
    log_info "Running pre-flight checks..."

    # 检查 Docker 是否可用
    if ! command -v docker &> /dev/null; then
        log_error "Docker command not found"
        exit 1
    fi

    # 检查容器是否存在
    if ! docker inspect "$CONTAINER" &> /dev/null; then
        log_error "Container '$CONTAINER' not found"
        exit 2
    fi

    # 创建输出目录
    mkdir -p "$OUTPUT_DIR" || {
        log_error "Failed to create output directory: $OUTPUT_DIR"
        exit 4
    }

    log_info "Output directory: $OUTPUT_DIR"
    log_info "Pre-flight checks passed"
}

# ============================================
# 信息收集函数
# ============================================

collect_container_state() {
    log_info "Collecting container state..."
    
    local output_file="${OUTPUT_DIR}/docker-state.json"
    
    docker inspect "$CONTAINER" > "$output_file" 2>&1 || {
        log_warn "Failed to get container inspect data"
    }
    
    # 提取关键状态信息
    {
        echo "=== Container Status ==="
        docker ps -a --filter "name=$CONTAINER" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        echo ""
        echo "=== Container Stats (snapshot) ==="
        docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" "$CONTAINER" 2>/dev/null || true
    } > "${OUTPUT_DIR}/docker-status.txt" 2>&1
}

collect_application_logs() {
    log_info "Collecting application logs (last 100 lines)..."
    
    local log_file="${OUTPUT_DIR}/app.log"
    
    # 尝试获取容器日志（最近 100 行，带时间戳）
    if timeout "$TIMEOUT_SECONDS" docker logs --tail 100 -t "$CONTAINER" > "$log_file" 2>&1; then
        log_info "Application logs collected successfully"
    else
        log_warn "Timeout or error collecting application logs"
        echo "[WARNING] Log collection timed out or failed at $(date)" > "$log_file"
    fi
    
    # 统计日志中的错误数量
    if [ -f "$log_file" ]; then
        local error_count=$(grep -ciE "(error|exception|fatal|failed)" "$log_file" || echo "0")
        echo "Error count in last 100 lines: $error_count" >> "${OUTPUT_DIR}/summary.txt"
    fi
}

collect_system_resources() {
    log_info "Collecting system resources..."
    
    local sys_file="${OUTPUT_DIR}/system-resources.txt"
    
    {
        echo "=== System Resources ($(date)) ==="
        echo ""
        
        # 内存使用
        echo "--- Memory ---"
        free -h 2>/dev/null || cat /proc/meminfo | head -5
        
        echo ""
        
        # 磁盘使用
        echo "--- Disk ---"
        df -h 2>/dev/null
        
        echo ""
        
        # CPU 负载
        echo "--- CPU Load ---"
        uptime
        
        echo ""
        
        # Top processes（按内存排序）
        echo "--- Top Processes (by memory) ---"
        ps aux --sort=-%mem | head -10 2>/dev/null || true
        
    } > "$sys_file" 2>&1
}

collect_network_status() {
    log_info "Collecting network status..."
    
    local net_file="${OUTPUT_DIR}/network-status.txt"
    
    {
        echo "=== Network Status ($(date)) ==="
        echo ""
        
        # 容器网络信息
        echo "--- Container Network ---"
        docker exec "$CONTAINER" cat /etc/resolv.conf 2>/dev/null || true
        echo ""
        docker exec "$CONTAINER" sh -c 'cat /proc/net/tcp 2>/dev/null | head -20' 2>/dev/null || true
        
        echo ""
        
        # 连通性测试（简单检测）
        echo "--- Connectivity Test ---"
        docker exec "$CONTAINER" sh -c 'wget -q -O- --timeout=2 http://localhost:3000/api/health 2>/dev/null | head -5' 2>/dev/null || echo "Health check failed or timeout"
        
    } > "$net_file" 2>&1
}

collect_database_status() {
    log_info "Collecting database connection status..."
    
    local db_file="${OUTPUT_DIR}/database-status.txt"
    
    {
        echo "=== Database Status ($(date)) ==="
        echo ""
        
        # 检查 PostgreSQL 容器（如果存在）
        if docker ps --format '{{.Names}}' | grep -qi postgres; then
            echo "--- PostgreSQL Container ---"
            docker exec postgresql psql -U postgres -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;" 2>/dev/null || \
                echo "Cannot connect to PostgreSQL"
        else
            echo "PostgreSQL container not running or not accessible"
        fi
        
        echo ""
        
        # Redis 状态（如果存在）
        if docker ps --format '{{.Names}}' | grep -qi redis; then
            echo "--- Redis Status ---"
            docker exec redis redis-cli INFO server 2>/dev/null | head -15 || \
                echo "Cannot connect to Redis"
            
            echo ""
            echo "--- Redis Memory ---"
            docker exec redis redis-cli INFO memory 2>/dev/null | head -10 || true
        else
            echo "Redis container not running or not accessible"
        fi
        
    } > "$db_file" 2>&1
}

generate_summary() {
    log_info "Generating diagnostic summary..."
    
    local summary_file="${OUTPUT_DIR}/summary.txt"
    
    {
        echo "========================================="
        echo "AIOps Diagnostic Summary"
        echo "Generated: $(date)"
        echo "Container: $CONTAINER"
        echo "========================================="
        echo ""
        
        # 收集的文件列表
        echo "Collected Files:"
        ls -lh "$OUTPUT_DIR"/*.txt "$OUTPUT_DIR"/*.json "$OUTPUT_DIR"/*.log 2>/dev/null | awk '{print "  - " $NF " (" $5 ")"}'
        echo ""
        
        # 容器基本信息
        echo "Container Information:"
        docker inspect --format='  Name: {{.Name}}' "$CONTAINER" 2>/dev/null
        docker inspect --format='  Status: {{.State.Status}}' "$CONTAINER" 2>/dev/null
        docker inspect --format='  Started: {{.State.StartedAt}}' "$CONTAINER" 2>/dev/null
        docker inspect --format='  Restart Count: {{.RestartCount}}' "$CONTAINER" 2>/dev/null
        echo ""
        
        echo "========================================="
        echo "End of Summary"
        echo "========================================="
        
    } >> "$summary_file" 2>&1
}

# ============================================
# 主执行流程
# ============================================

main() {
    local start_time=$(date +%s)
    
    echo ""
    echo -e "${LOG_PREFIX} ${GREEN}Starting L1 diagnostic collection...${NC}"
    echo -e "${LOG_PREFIX} Target container: ${YELLOW}$CONTAINER${NC}"
    echo -e "${LOG_PREFIX} Output directory: ${OUTPUT_DIR}"
    echo ""
    
    # 前置检查
    pre_check
    
    # 执行收集（带超时保护）
    if ! timeout "$TIMEOUT_SECONDS" bash -c '
        collect_container_state
        collect_application_logs
        collect_system_resources
        collect_network_status
        collect_database_status
        generate_summary
    '; then
        log_error "Diagnostics collection timed out after ${TIMEOUT_SECONDS}s"
        exit 3
    fi
    
    local end_time=$(date +%s)
    local duration=$(( end_time - start_time ))
    
    echo ""
    echo -e "${LOG_PREFIX} ${GREEN}✓ Diagnostic collection completed successfully${NC}"
    echo -e "${LOG_PREFIX} Duration: ${duration}s"
    echo -e "${LOG_PREFIX} Output: ${OUTPUT_DIR}"
    echo -e "${LOG_PREFIX} Files collected:"
    ls -1 "$OUTPUT_DIR" 2>/dev/null | while read f; do
        echo -e "  ${GREEN}•${NC} $f"
    done
    
    # 输出 JSON 格式的结果（供调用方解析）
    echo ""
    echo "DIAGNOSTICS_RESULT={"
    echo "  \"status\": \"success\","
    echo "  \"container\": \"$CONTAINER\","
    echo "  \"output_dir\": \"$OUTPUT_DIR\","
    echo "  \"duration_seconds\": $duration,"
    echo "  \"timestamp\": \"$(date -Iseconds)\","
    echo "  \"artifacts\": {"
    ls -1 "$OUTPUT_DIR" 2>/dev/null | while read f; do
        echo "    \"$f\": \"$OUTPUT_DIR/$f\","
    done
    echo "  }"
    echo "}"
}

# 执行主函数
main "$@"
