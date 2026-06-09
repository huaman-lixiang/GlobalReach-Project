#!/bin/bash
# ============================================
# S132/O01: AIOps Auto-Healing Script - Health Check Utility
# ============================================
#
# 功能：通用健康检查工具（用于判断自愈是否成功）
# 用法：./check-health.sh --container <name> [--endpoint <url>] [--retries <n>]
#
# 特性：
#   - 支持多种健康检查方式（Docker health, HTTP endpoint, TCP port）
#   - 可配置重试次数和间隔
#   - 详细的健康状态报告
#   - 退出码反映健康状态

set -euo pipefail

# ============================================
# 配置
# ============================================

SCRIPT_NAME="check-health"
LOG_PREFIX="[AIOps/HealthCheck]"

DEFAULT_RETRIES=12        # 默认重试次数（12 * 5s = 60s 超时）
DEFAULT_INTERVAL=5        # 重试间隔（秒）
DEFAULT_TIMEOUT=10         # 单次检查超时（秒）

# 颜色输出
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    NC='\033[0m'
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
ENDPOINT=""
RETRIES=$DEFAULT_RETRIES
INTERVAL=$DEFAULT_INTERVAL
TIMEOUT=$DEFAULT_TIMEOUT
VERBOSE=false

show_help() {
    cat << EOF
Usage: $0 --container <name> [options]

Options:
  --container <name>   Target container name (required)
  --endpoint <url>     HTTP/S health check endpoint (default: auto-detect)
  --retries <n>        Number of retries (default: $DEFAULT_RETRIES)
  --interval <sec>     Seconds between retries (default: $DEFAULT_INTERVAL)
  --timeout <sec>      Per-check timeout (default: $DEFAULT_TIMEOUT)
  --verbose            Enable verbose output
  --help               Show this help message

Exit Codes:
  0  Healthy
  1  Unhealthy (after all retries)
  2  Container not found
  3  Configuration error

Examples:
  $0 --container globalreach-api
  $0 --container globalreach-api --endpoint http://localhost:3000/api/health
  $0 --container nginx --retries 6 --interval 2
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --container)
            CONTAINER="$2"
            shift 2
            ;;
        --endpoint)
            ENDPOINT="$2"
            shift 2
            ;;
        --retries)
            RETRIES="$2"
            shift 2
            ;;
        --interval)
            INTERVAL="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "${LOG_PREFIX} ${RED}Unknown option: $1${NC}" >&2
            show_help
            exit 3
            ;;
    esac
done

if [ -z "$CONTAINER" ]; then
    echo "${LOG_PREFIX} ${RED}ERROR: --container is required${NC}" >&2
    exit 3
fi

# ============================================
# 日志函数
# ============================================

log_info()  { echo -e "${LOG_PREFIX} ${GREEN}$*${NC}"; }
log_warn()  { echo -e "${LOG_PREFIX} ${YELLOW}$*${NC}" >&2; }
log_error() { echo -e "${LOG_PREFIX} ${RED}$*${NC}" >&2; }
log_debug() { [ "$VERBOSE" = true ] && echo -e "${LOG_PREFIX} [DEBUG] $*"; }

# ============================================
# 健康检查函数
# ============================================

check_container_exists() {
    if ! docker inspect "$CONTAINER" &> /dev/null; then
        log_error "Container '$CONTAINER' not found"
        return 1
    fi
    return 0
}

get_container_status() {
    docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "unknown"
}

get_docker_health() {
    docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo ""
}

detect_endpoint() {
    # 如果用户指定了端点，直接使用
    if [ -n "$ENDPOINT" ]; then
        echo "$ENDPOINT"
        return
    fi
    
    # 尝试从容器端口映射自动检测
    local port=$(docker port "$CONTAINER" 2>/dev/null | grep -oE '[0-9]+$' | head -1 || echo "")
    
    if [ -n "$port" ]; then
        # 常见的健康检查端点列表
        for path in "/api/health" "/health" "/healthz" "/" ; do
            local url="http://localhost:${port}${path}"
            if curl -sf --max-time 2 "$url" > /dev/null 2>&1; then
                log_debug "Auto-detected endpoint: $url"
                echo "$url"
                return
            fi
        done
        
        # 如果没有找到可用的端点，返回第一个端口的基本 URL
        echo "http://localhost:${port}/"
    else
        echo ""
    fi
}

check_http_health() {
    local url="$1"
    
    log_debug "Checking HTTP health: $url"
    
    local response=$(curl -sf --max-time "$TIMEOUT" \
        -w '\n%{http_code}\n%{time_total}' \
        "$url" 2>/dev/null) || {
        log_debug "HTTP request failed"
        return 1
    }
    
    local http_code=$(echo "$response" | tail -2 | head -1)
    local response_time=$(echo "$response" | tail -1)
    
    log_debug "HTTP response: $http_code (${response_time}s)"
    
    # 2xx 状态码表示健康
    if [[ "$http_code" =~ ^2 ]]; then
        return 0
    else
        return 1
    fi
}

check_docker_health() {
    local status=$(get_docker_health)
    
    log_debug "Docker health status: $status"
    
    [ "$status" = "healthy" ]
}

perform_single_check() {
    local attempt_num=$1
    
    log_debug "Check attempt $attempt_num/$RETRIES"
    
    # 1. 检查容器是否运行
    local container_status=$(get_container_status)
    if [ "$container_status" != "running" ]; then
        log_debug "Container status: $container_status (not running)"
        return 1
    fi
    
    # 2. 检查 Docker 内建健康检查（如果有）
    local docker_health=$(get_docker_health)
    if [ -n "$docker_health" ] && [ "$docker_health" != "starting" ]; then
        if [ "$docker_health" = "healthy" ]; then
            log_debug "Docker health: healthy ✓"
            return 0
        elif [ "$docker_health" = "unhealthy" ]; then
            log_debug "Docker health: unhealthy ✗"
            return 1
        fi
    fi
    
    # 3. 检查 HTTP 端点（如果可用）
    local endpoint=$(detect_endpoint)
    if [ -n "$endpoint" ]; then
        if check_http_health "$endpoint"; then
            log_debug "HTTP health check passed ✓"
            return 0
        else
            log_debug "HTTP health check failed"
            return 1
        fi
    fi
    
    # 如果没有任何健康检查方法可用，仅检查容器是否运行
    log_debug "No specific health check available, using container running state"
    [ "$container_status" = "running" ]
}

# ============================================
# 主执行流程
# ============================================

main() {
    local start_time=$(date +%s)
    local attempt=0
    local healthy=false
    
    echo ""
    echo -e "${LOG_PREFIX} Health Check for ${YELLOW}$CONTAINER${NC}"
    echo ""
    
    # 前置检查
    check_container_exists || exit 2
    
    # 执行健康检查循环
    while [ $attempt -lt $RETRIES ]; do
        attempt=$((attempt + 1))
        
        if perform_single_check $attempt; then
            healthy=true
            break
        fi
        
        if [ $attempt -lt $RETRIES ]; then
            [ "$VERBOSE" = true ] && log_info "Attempt $attempt/$RETRIES failed, waiting ${INTERVAL}s..."
            sleep $INTERVAL
        fi
    done
    
    local end_time=$(date +%s)
    local duration=$(( end_time - start_time ))
    
    # 输出结果
    echo ""
    if [ "$healthy" = true ]; then
        log_info "✓ HEALTHY (after ${attempt} attempts, ${duration}s)"
        
        # 输出详细状态
        echo "--- Container Status ---"
        echo "Status:     $(get_container_status)"
        echo "DockerHealth: $(get_docker_health || 'N/A')"
        echo "Endpoint:   $(detect_endpoint || 'N/A')"
        echo "Duration:   ${duration}s"
        echo "Attempts:   $attempt/$RETRIES"
        
        exit 0
    else
        log_error "✗ UNHEALTHY (after $RETRIES attempts, ${duration}s)"
        
        echo "--- Container Status ---"
        echo "Status:     $(get_container_status)"
        echo "DockerHealth: $(get_docker_health || 'N/A')"
        echo "Duration:   ${duration}s"
        echo "Attempts:   $RETRIES/$RETRIES"
        
        exit 1
    fi
}

main "$@"
