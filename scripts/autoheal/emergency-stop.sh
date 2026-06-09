#!/bin/bash
# ============================================
# S132/O01: AIOps Auto-Healing Script - L5: Emergency Stop (Reserved Interface)
# ============================================
#
# 功能：紧急停止预留接口（仅用于极端情况，防止级联故障扩散）
# 级别：L5 (紧急停机) — 仅在紧急情况下使用，需多重确认
# 用法：./emergency-stop.sh --service <name> [--reason <text>] [--confirm-code <code>]
#
# ⚠️ 极高风险操作警告：
#   - 此操作将完全停止指定服务
#   - 可能导致用户可见的服务中断
#   - 仅在检测到灾难性故障征兆时使用
#   - 需要操作者明确确认

set -euo pipefail

# ============================================
# 配置
# ============================================

SCRIPT_NAME="emergency-stop"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_PREFIX="[AIOps/L5/${SCRIPT_NAME}]"
LOG_FILE="${AIOPS_LOG_DIR:-/var/log/aiops}/emergency-stops.log"
AUDIT_FILE="${AIOPS_AUDIT_DIR:-/var/lib/aiops}/audit.log"

# 安全配置：需要输入的确认码（每次运行随机生成）
CONFIRM_CODE=$(head -c 8 /dev/urandom | xxd -p)

STOP_TIMEOUT=30  # 停止超时（秒）

# 颜色输出
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
fi

# ============================================
# 参数解析
# ============================================

SERVICE=""
REASON=""
CONFIRM_INPUT=""
FORCE=false

show_help() {
    cat << EOF
⚠️  ${RED}EMERGENCY STOP SCRIPT${NC} ⚠️

Usage: $0 --service <name> [options]

Options:
  --service <name>       Service to stop (required)
  --reason <text>        Reason for emergency stop (required or --force)
  --confirm-code <code>  Confirmation code displayed at startup
  --force                Skip confirmation code (NOT RECOMMENDED)
  --help                 Show this help message

${RED}WARNING:${NC}
This action will completely stop the specified service.
Only use this when:
  • Cascade failure is detected affecting >50% of services
  • Data corruption risk is imminent
  • Explicit emergency instruction received

${YELLOW}This script is a RESERVED INTERFACE.${NC}
Current version requires explicit operator confirmation.

Exit Codes:
  0  Success (stop executed)
  1  Error or safety check failed
  2  Confirmation failed
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --service)
            SERVICE="$2"
            shift 2
            ;;
        --reason)
            REASON="$2"
            shift 2
            ;;
        --confirm-code)
            CONFIRM_INPUT="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "${LOG_PREFIX} ${RED}Unknown option: $1${NC}" >&2
            show_help
            exit 1
            ;;
    esac
done

if [ -z "$SERVICE" ]; then
    echo "${LOG_PREFIX} ${RED}ERROR: --service is required${NC}" >&2
    exit 1
fi

# ============================================
# 日志函数
# ============================================

log() {
    local level=$1
    shift
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ${LOG_PREFIX} [$level] $*"
    
    case $level in
        INFO)    echo -e "${GREEN}${msg}${NC}" ;;
        WARN)    echo -e "${YELLOW}${msg}${NC}" >&2 ;;
        ERROR)   echo -e "${RED}${msg}${NC}" >&2 ;;
        CRITICAL) echo -e "${BOLD}${RED}${msg}${NC}" >&2 ;;
        *)       echo "$msg" ;;
    esac
}

log_info()     { log INFO      "$@"; }
log_warn()     { log WARN      "$@"; }
log_error()    { log ERROR     "$@"; }
log_critical() { log CRITICAL  "$@"; }

# ============================================
# 安全检查函数
# ============================================

check_docker_available() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker command not found"
        return 1
    fi
}

check_container_exists() {
    if ! docker inspect "$SERVICE" &> /dev/null; then
        log_error "Container '$SERVICE' does not exist"
        return 1
    fi
}

require_confirmation() {
    # 如果是强制模式且提供了原因，跳过确认
    if [ "$FORCE" = true ] && [ -n "$REASON" ]; then
        log_warn "FORCE mode: skipping interactive confirmation"
        return 0
    fi
    
    # 显示确认码并要求输入
    echo ""
    echo -e "${RED}${BOLD}═══════════════════════════════════════════════${NC}"
    echo -e "${RED}${BOLD}  ⚠️  EMERGENCY STOP CONFIRMATION REQUIRED  ⚠️${NC}"
    echo -e "${RED}${BOLD}═══════════════════════════════════════════════${NC}"
    echo ""
    echo -e "Service to stop: ${YELLOW}$SERVICE${NC}"
    echo -e "Reason:         ${YELLOW}${REASON:-<not provided>}${NC}"
    echo ""
    echo -e "${BOLD}To confirm this action, enter the following code:${NC}"
    echo -e "${BLUE}${BOLD}$CONFIRM_CODE${NC}"
    echo ""
    
    if [ -z "$CONFIRM_INPUT" ]; then
        # 交互式模式
        read -p "> Enter confirmation code: " user_input 2>/dev/null || {
            log_error "Cannot read input in non-interactive mode. Use --confirm-code or provide reason with --force."
            return 1
        }
        CONFIRM_INPUT="$user_input"
    fi
    
    if [ "$CONFIRM_INPUT" != "$CONFIRM_CODE" ]; then
        log_critical "Confirmation code mismatch!"
        log_critical "Expected: $CONFIRM_CODE"
        log_critical "Received: $CONFIRM_INPUT"
        echo ""
        log_error "Emergency stop ABORTED due to confirmation failure"
        return 1
    fi
    
    log_info "Confirmation code verified ✓"
    return 0
}

record_audit_trail() {
    mkdir -p "$(dirname "$AUDIT_FILE")" 2>/dev/null || true
    
    local pre_state=$(docker inspect --format='{{.State.Status}}' "$SERVICE" 2>/dev/null || echo "unknown")
    local operator="${USER:-$(whoami)}@$(hostname)"
    
    {
        echo "$(date -Iseconds) EMERGENCY_STOP_EXECUTED"
        echo "  service=$SERVICE"
        echo "  reason=\"$REASON\""
        echo "  operator=$operator"
        echo "  pre_stop_status=$pre_state"
        echo "  forced=$FORCE"
        echo "  confirm_code_used=${CONFIRM_INPUT:+yes}"
    } >> "$AUDIT_FILE"
    
    log_info "Audit trail recorded to: $AUDIT_FILE"
}

execute_stop() {
    log_info "Executing: docker stop $SERVICE (timeout: ${STOP_TIMEOUT}s)"
    
    local start_time=$(date +%s)
    
    if timeout "$STOP_TIMEOUT" docker stop "$SERVICE" >> "$LOG_FILE" 2>&1; then
        local end_time=$(date +%s)
        local duration=$(( end_time - start_time ))
        
        log_info "Stop completed in ${duration}s"
        
        # 验证停止状态
        local post_status=$(docker inspect --format='{{.State.Status}}' "$SERVICE" 2>/dev/null || echo "unknown")
        
        if [ "$post_status" = "exited" ] || [ "$post_status" = "dead" ]; then
            log_info "✓ Container successfully stopped (status: $post_status)"
            return 0
        else
            log_warn "Container status after stop: $post_status (may need force)"
            return 0
        fi
    else
        log_error "docker stop failed or timed out"
        return 1
    fi
}

send_notification() {
    # 记录到日志文件
    {
        echo ""
        echo "========================================="
        echo "EMERGENCY STOP NOTIFICATION"
        echo "========================================="
        echo "Time: $(date)"
        echo "Service: $SERVICE"
        echo "Reason: $REASON"
        echo "Operator: ${USER:-$(whoami)}"
        echo "========================================="
    } >> "$LOG_FILE"
    
    log_info "Notification logged"
}

# ============================================
# 主执行流程
# ============================================

main() {
    local start_time=$(date +%s)
    local exit_code=0
    
    echo ""
    echo -e "${RED}${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${RED}${BOLD}║     AIOps EMERGENCY STOP (L5)           ║${NC}"
    echo -e "${RED}${BOLD}║     ⚠️  EXTREME CAUTION  ⚠️              ║${NC}"
    echo -e "${RED}${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Target Service: ${YELLOW}$SERVICE${NC}"
    echo -e "Timestamp: $(date)"
    echo -e "Confirm Code: ${BLUE}${BOLD}$CONFIRM_CODE${NC}"
    echo ""
    
    # ===== 阶段 1: 基础检查 =====
    log_info "--- Phase 1: Basic Checks ---"
    
    check_docker_available || exit 1
    check_container_exists || exit 1
    
    # 显示当前容器状态
    log_info "Current container status:"
    docker ps -a --filter "name=$SERVICE" --format "  Status: {{.Status}} | Uptime: {{.Status}}" 2>/dev/null || true
    echo ""
    
    # ===== 阶段 2: 确认 =====
    log_info "--- Phase 2: Operator Confirmation ---"
    
    if ! require_confirmation; then
        exit_code=2
        log_error "Emergency stop aborted"
    else
        echo ""
        
        # ===== 阶段 3: 审计记录 =====
        log_info "--- Phase 3: Audit Trail ---"
        record_audit_trail
        
        # ===== 阶段 4: 执行停止 =====
        log_info "--- Phase 4: Execute Emergency Stop ---"
        
        if execute_stop; then
            send_notification
            log_info "✓ Emergency stop completed"
        else
            exit_code=1
            log_error "✗ Emergency stop failed"
        fi
    fi
    
    # ===== 最终报告 =====
    local end_time=$(date +%s)
    local total_duration=$(( end_time - start_time ))
    
    echo ""
    echo -e "${RED}${BOLD}═══════════════════════════════════════════════${NC}"
    echo -e "${LOG_PREFIX} Emergency Stop Summary"
    echo -e "${RED}${BOLD}═══════════════════════════════════════════════${NC}"
    echo -e "Service:   $SERVICE"
    echo -e "Result:   $([ $exit_code -eq 0 ] && echo -e '${GREEN}EXECUTED${NC}' || echo -e '${RED}ABORTED${NC}')"
    echo -e "Duration: ${total_duration}s"
    echo -e "Audit:    $AUDIT_FILE"
    echo -e "Log:      $LOG_FILE"
    echo -e "${RED}${BOLD}═══════════════════════════════════════════════${NC}"
    echo ""
    
    # 输出 JSON 结果
    cat << EOF
{
  "status": "$([ $exit_code -eq 0 ] && echo 'executed' || echo 'aborted')",
  "level": "L5",
  "action": "emergency_stop",
  "service": "$SERVICE",
  "reason": "$REASON",
  "duration_seconds": $total_duration,
  "timestamp": "$(date -Iseconds)",
  "audit_file": "$AUDIT_FILE",
  "operator": "${USER:-$(whoami)}",
  "forced": $FORCE,
  "emergency_contact": true,
  "next_steps": [
    "Wait for root cause analysis report",
    "Prepare recovery plan",
    "Notify stakeholders",
    "Document incident"
  ]
}
EOF
    
    exit $exit_code
}

main "$@"
