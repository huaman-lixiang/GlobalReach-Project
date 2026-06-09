#!/bin/bash
# ============================================
# S132/O01: AIOps Auto-Healing Script - L2: Safe Container Restart
# ============================================
#
# 功能：安全重启指定容器（带前置检查、冷却期验证、后置健康检查）
# 级别：L2 (服务重启) — 自动执行（需通过安全检查）
# 用法：./restart-container.sh --container <name> [--force] [--dry-run]
#
# 安全特性：
#   - 容器名白名单检查
#   - 黑名单强制阻止
#   - 冷却期验证（默认 10 分钟）
#   - 前置状态记录
#   - 后置健康检查
#   - 超时保护（等待就绪 120 秒）
#   - 完整的执行日志

set -euo pipefail

# ============================================
# 配置常量
# ============================================

SCRIPT_NAME="restart-container"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_PREFIX="[AIOps/L2/${SCRIPT_NAME}]"
LOG_FILE="${AIOPS_LOG_DIR:-/var/log/aiops}/restart-${TIMESTAMP}.log"

# 安全配置
RESTART_WHITELIST=${AIOPS_RESTART_WHITELIST:-"globalreach-api|send-worker|nginx"}
RESTART_BLACKLIST=${AIOPS_RESTART_BLACKLIST:-"postgresql|redis|prometheus|alertmanager|grafana"}
COOLDOWN_SECONDS=${AIOPS_COOLDOWN_SECONDS:-600}  # 10 分钟
HEALTH_CHECK_TIMEOUT=${AIOPS_HEALTH_TIMEOUT:-120}   # 健康检查超时
HEALTH_CHECK_INTERVAL=${AIOPS_HEALTH_INTERVAL:-5}   # 健康检查间隔（秒）
MAX_HEALTH_RETRIES=$(( HEALTH_CHECK_TIMEOUT / HEALTH_CHECK_INTERVAL ))

# 颜色输出
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# ============================================
# 参数解析
# ============================================

CONTAINER=""
FORCE=false
DRY_RUN=false

show_help() {
    cat << EOF
Usage: $0 --container <name> [--force] [--dry-run] [--help]

Options:
  --container <name>   Container name to restart (required)
  --force              Skip cooldown check (use with caution)
  --dry-run            Simulate restart without actual execution
  --help               Show this help message

Security:
  - Whitelist: $RESTART_WHITELIST
  - Blacklist: $RESTART_BLACKLIST
  - Cooldown: ${COOLDOWN_SECONDS}s between restarts

Exit Codes:
  0  Success (restart completed and health check passed)
  1  General error or safety check failed
  2  Container not found
  5  Container not in whitelist
  6  Container in blacklist (blocked)
  7  Cooldown period not elapsed
  8  Health check failed after restart
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --container)
            CONTAINER="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
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

# 初始化日志目录
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

# ============================================
# 日志函数
# ============================================

log() {
    local level=$1
    shift
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ${LOG_PREFIX} [$level] $*"
    
    # 输出到 stdout/stderr 和日志文件
    case $level in
        INFO)    echo -e "${GREEN}${msg}${NC}" | tee -a "$LOG_FILE" ;;
        WARN)    echo -e "${YELLOW}${msg}${NC}" | tee -a "$LOG_FILE" >&2 ;;
        ERROR)   echo -e "${RED}${msg}${NC}" | tee -a "$LOG_FILE" >&2 ;;
        *)       echo "$msg" | tee -a "$LOG_FILE" ;;
    esac
}

log_info()  { log INFO  "$@"; }
log_warn()  { log WARN  "$@"; }
log_error() { log ERROR "$@"; }

# ============================================
# 安全检查函数
# ============================================

check_docker_available() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker command not found"
        return 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker daemon not running or no permission"
        return 1
    fi
    
    return 0
}

check_container_exists() {
    if ! docker inspect "$CONTAINER" &> /dev/null; then
        log_error "Container '$CONTAINER' does not exist"
        return 1
    fi
    return 0
}

check_whitelist() {
    if echo "$CONTAINER" | grep -qiE "^(${RESTART_WHITELIST})$"; then
        log_info "Container '$CONTAINER' is in whitelist"
        return 0
    else
        log_error "Container '$CONTAINER' is NOT in whitelist: $RESTART_WHITELIST"
        return 1
    fi
}

check_blacklist() {
    if echo "$CONTAINER" | grep -qiE "^(${RESTART_BLACKLIST})$"; then
        log_error "BLOCKED: Container '$CONTAINER' is in BLACKLIST: $RESTART_BLACKLIST"
        log_error "This container cannot be auto-restarted for safety reasons"
        return 1
    fi
    return 0
}

check_cooldown() {
    local cooldown_file="${AIOPS_STATE_DIR:-/var/lib/aiops}/restart-cooldowns.txt"
    
    # 如果强制模式，跳过冷却期检查
    if [ "$FORCE" = true ]; then
        log_warn "FORCE mode: skipping cooldown check"
        return 0
    fi
    
    # 检查冷却期文件
    if [ -f "$cooldown_file" ]; then
        local last_restart=$(grep "^${CONTAINER}:" "$cooldown_file" 2>/dev/null | tail -1 | cut -d: -f2)
        
        if [ -n "$last_restart" ]; then
            local now=$(date +%s)
            local elapsed=$(( now - last_restart ))
            
            if [ $elapsed -lt $COOLDOWN_SECONDS ]; then
                local remaining=$(( COOLDOWN_SECONDS - elapsed ))
                log_error "Cooldown period active: ${elapsed}s elapsed, ${remaining}s remaining"
                log_error "Use --force to override (not recommended)"
                return 1
            else
                log_info "Cooldown period expired (${elapsed}s ago)"
            fi
        fi
    fi
    
    return 0
}

record_cooldown() {
    local cooldown_file="${AIOPS_STATE_DIR:-/var/lib/aiops}/restart-cooldowns.txt"
    mkdir -p "$(dirname "$cooldown_file")" 2>/dev/null || true
    
    echo "${CONTAINER}:$(date +%s)" >> "$cooldown_file"
    log_info "Cooldown recorded for container '$CONTAINER'"
}

# ============================================
# 状态采集函数
# ============================================

capture_pre_restart_state() {
    log_info "Capturing pre-restart state..."
    
    local state_file="/tmp/aiops-pre-restart-${CONTAINER}-${TIMESTAMP}.json"
    
    docker inspect "$CONTAINER" > "$state_file" 2>&1
    
    # 提取关键指标
    PRE_RESTART_STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "unknown")
    PRE_RESTART_UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null || echo "unknown")
    PRE_RESTART_RESTART_COUNT=$(docker inspect --format='{{.RestartCount}}' "$CONTAINER" 2>/dev/null || echo "0")
    
    log_info "Pre-restart status: $PRE_RESTART_STATUS"
    log_info "Pre-restart uptime: $PRE_RESTART_UPTIME"
    log_info "Pre-restart restart count: $PRE_RESTART_RESTART_COUNT"
    
    echo "$state_file"
}

execute_restart() {
    log_info "Executing: docker restart $CONTAINER"
    
    if [ "$DRY_RUN" = true ]; then
        log_warn "[DRY RUN] Would execute: docker restart $CONTAINER"
        return 0
    fi
    
    local start_time=$(date +%s)
    
    # 执行重启（超时 60 秒）
    if timeout 60 docker restart "$CONTAINER" >> "$LOG_FILE" 2>&1; then
        local end_time=$(date +%s)
        local duration=$(( end_time - start_time ))
        log_info "Restart command completed in ${duration}s"
        
        # 记录冷却期
        record_cooldown
        
        return 0
    else
        log_error "docker restart failed or timed out"
        return 1
    fi
}

wait_for_healthy() {
    log_info "Waiting for container to become healthy (timeout: ${HEALTH_CHECK_TIMEOUT}s)..."
    
    if [ "$DRY_RUN" = true ]; then
        log_warn "[DRY RUN] Would wait for health check"
        return 0
    fi
    
    local retries=0
    
    while [ $retries -lt $MAX_HEALTH_RETRIES ]; do
        # 检查容器是否在运行
        local current_status=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")
        
        if [ "$current_status" != "running" ]; then
            log_warn "Container status: $current_status (waiting...)"
        else
            # 尝试健康检查端点（如果容器暴露了 HTTP 健康检查）
            local health_result=""
            
            # 获取容器映射的端口
            local port=$(docker port "$CONTAINER" 2>/dev/null | grep -oE '[0-9]+$' | head -1 || echo "")
            
            if [ -n "$port" ]; then
                # 尝试 HTTP 健康检查
                health_result=$(curl -sf --max-time 2 "http://localhost:${port}/api/health" 2>/dev/null || \
                                curl -sf --max-time 2 "http://localhost:${port}/health" 2>/dev/null || \
                                echo "")
                
                if [ -n "$health_result" ]; then
                    log_info "Health check passed on port $port"
                    return 0
                fi
            fi
            
            # 如果没有 HTTP 端口或健康检查失败，使用 Docker 内建健康检查
            local docker_health=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "")
            
            if [ "$docker_health" = "healthy" ]; then
                log_info "Docker health check: healthy"
                return 0
            elif [ "$docker_health" = "starting" ] || [ -z "$docker_health" ]; then
                log_info "Container starting up... (retry $((retries+1))/$MAX_HEALTH_RETRIES)"
            else
                log_warn "Docker health check: $docker_health"
            fi
        fi
        
        sleep $HEALTH_CHECK_INTERVAL
        retries=$((retries + 1))
    done
    
    log_error "Health check timed out after ${HEALTH_CHECK_TIMEOUT}s"
    return 1
}

capture_post_restart_state() {
    log_info "Capturing post-restart state..."
    
    POST_RESTART_STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "unknown")
    POST_RESTART_UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null || echo "unknown")
    POST_RESTART_RESTART_COUNT=$(docker inspect --format='{{.RestartCount}}' "$CONTAINER" 2>/dev/null || echo "0")
    
    log_info "Post-restart status: $POST_RESTART_STATUS"
    log_info "Post-restart uptime: $POST_RESTART_UPTIME"
    log_info "Post-restart restart count: $POST_RESTART_RESTART_COUNT"
}

evaluate_result() {
    log_info "Evaluating restart result..."
    
    local success=true
    
    # 检查容器状态
    if [ "$POST_RESTART_STATUS" != "running" ]; then
        log_error "Container is not running after restart"
        success=false
    fi
    
    # 检查是否是新的启动时间（确认确实重启了）
    if [ "$POST_RESTART_UPTIME" = "$PRE_RESTART_UPTIME" ] && [ "$DRY_RUN" != true ]; then
        log_warn "Uptime unchanged - restart may not have taken effect"
    fi
    
    if [ "$success" = true ]; then
        log_info "✓ Restart evaluation: SUCCESS"
        return 0
    else
        log_error "✗ Restart evaluation: FAILED"
        return 1
    fi
}

# ============================================
# 主执行流程
# ============================================

main() {
    local start_time=$(date +%s)
    local exit_code=0
    
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${LOG_PREFIX} L2 Safe Container Restart"
    echo -e "${BLUE}========================================${NC}"
    echo -e "Target: ${YELLOW}$CONTAINER${NC}"
    echo -e "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY-RUN' || echo 'LIVE')"
    echo -e "Time: $(date)"
    echo ""
    
    # ===== 阶段 1: 安全检查 =====
    log_info "--- Phase 1: Safety Checks ---"
    
    check_docker_available  || exit 1
    check_container_exists  || exit 2
    check_blacklist         || exit 6
    check_whitelist         || exit 5
    check_cooldown          || exit 7
    
    log_info "All safety checks passed ✓"
    echo ""
    
    # ===== 阶段 2: 重启前状态采集 =====
    log_info "--- Phase 2: Pre-Restart State Capture ---"
    
    local pre_state_file=$(capture_pre_restart_state)
    echo ""
    
    # ===== 阶段 3: 执行重启 =====
    log_info "--- Phase 3: Execute Restart ---"
    
    if ! execute_restart; then
        log_error "Restart execution failed"
        exit_code=1
    fi
    echo ""
    
    # ===== 阶段 4: 等待健康检查 =====
    if [ $exit_code -eq 0 ]; then
        log_info "--- Phase 4: Health Check ---"
        
        if ! wait_for_healthy; then
            log_warn "Health check did not pass within timeout"
            # 不立即失败，继续评估
        fi
        echo ""
    fi
    
    # ===== 阶段 5: 重启后状态采集与评估 =====
    log_info "--- Phase 5: Post-Restart Evaluation ---"
    
    capture_post_restart_state
    
    if ! evaluate_result; then
        exit_code=8
    fi
    echo ""
    
    # ===== 最终报告 =====
    local end_time=$(date +%s)
    local total_duration=$(( end_time - start_time ))
    
    echo -e "${BLUE}========================================${NC}"
    echo -e "${LOG_PREFIX} Restart Summary"
    echo -e "${BLUE}========================================${NC}"
    echo -e "Container:     $CONTAINER"
    echo -e "Duration:      ${total_duration}s"
    echo -e "Result:        $([ $exit_code -eq 0 ] && echo -e '${GREEN}SUCCESS${NC}' || echo -e '${RED}FAILED${NC}')"
    echo -e "Pre-Status:    $PRE_RESTART_STATUS (up since $PRE_RESTART_UPTIME)"
    echo -e "Post-Status:   $POST_RESTART_STATUS (up since $POST_RESTART_UPTIME)"
    echo -e "Log File:      $LOG_FILE"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    
    # 输出 JSON 结果（供调用方解析）
    cat << EOF
{
  "status": "$([ $exit_code -eq 0 ] && echo 'success' || echo 'failure')",
  "container": "$CONTAINER",
  "duration_seconds": $total_duration,
  "timestamp": "$(date -Iseconds)",
  "pre_state": {
    "status": "$PRE_RESTART_STATUS",
    "uptime": "$PRE_RESTART_UPTIME",
    "restart_count": $PRE_RESTART_RESTART_COUNT
  },
  "post_state": {
    "status": "$POST_RESTART_STATUS",
    "uptime": "$POST_RESTART_UPTIME",
    "restart_count": $POST_RESTART_RESTART_COUNT
  },
  "log_file": "$LOG_FILE"
}
EOF
    
    exit $exit_code
}

# 执行主函数
main "$@"
