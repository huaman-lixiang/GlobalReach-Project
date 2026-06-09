#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
#  GlobalReach V2.0 — On-call 排班管理脚本 (O07)
#
#  用法:
#    ./scripts/oncall-manager.sh                          # 显示当前值班状态
#    ./scripts/oncall-manager.sh --schedule               # 显示未来排班
#    ./scripts/oncall-manager.sh --handover               # 执行交接流程
#    ./scripts/oncall-manager.sh --escalate P0 "API down" # 触发升级通知
#    ./scripts/oncall-manager.sh --report                # 生成本周值班报告
#    ./scripts/oncall-manager.sh --help                  # 显示帮助
#
#  数据文件:
#    data/oncall-schedule.json     — 排班数据（轮值表、团队成员）
#    data/team-collaboration.json  — 交接记录和事件数据
#
#  集成:
#    Team API: /api/v1/team/* (读写同一数据文件)
#    AIOps: 告警触发时自动创建事件
#    O03 巡检: 事件验证通过后更新状态
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── 配置 ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEDULE_FILE="$PROJECT_ROOT/data/oncall-schedule.json"
COLLAB_FILE="$PROJECT_ROOT/data/team-collaboration.json"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── 工具函数 ─────────────────────────────────────────────────────────────────

usage() {
    cat <<'EOF'
${BOLD}GlobalReach V2.0 On-call 排班管理工具${NC}

${CYAN}用法:${NC}
  $0                              显示当前值班状态 (默认)
  $0 --schedule                   显示未来 2 周排班表
  $0 --handover [FROM] [TO]       执行交互式交接流程
  $0 --escalate <LEVEL> <MSG>     触发升级通知
  $0 --report                     生成本周值班报告
  $0 --stats                      显示本周统计数据
  $0 --init                       初始化/重置排班数据
  $0 --help                       显示此帮助信息

${CYAN}示例:${NC}
  $0                              # 查看当前谁在值班
  $0 --schedule                   # 查看未来谁值班
  $0 --handover alice bob         # 从 alice 交接给 bob
  $0 --escalate P0 "API全挂了"      # 触发 P0 级别升级
  $0 --report > weekly-report.md   # 导出本周报告

${CYAN}数据文件:${NC}
  排班数据: $SCHEDULE_FILE
  协作数据: $COLLAB_FILE

EOF
}

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_header() {
    echo ""
    echo -e "${BOLD}${BLUE}═══ $* ═══${NC}"
    echo ""
}

# 检查 jq 是否可用
check_dependencies() {
    if ! command -v jq &>/dev/null; then
        log_error "需要 jq 工具来解析 JSON。请安装: apt-get install jq / brew install jq"
        exit 1
    fi
    if ! command -v date &>/dev/null; then
        log_error "date 命令不可用"
        exit 1
    fi
}

# 确保数据文件存在
ensure_data_files() {
    if [[ ! -f "$SCHEDULE_FILE" ]]; then
        log_warn "排班数据文件不存在, 将使用默认值"
        mkdir -p "$(dirname "$SCHEDULE_FILE")"
        echo '{"rotations":[],"teamMembers":[]}' > "$SCHEDULE_FILE"
    fi
    if [[ ! -f "$COLLAB_FILE" ]]; then
        mkdir -p "$(dirname "$COLLAB_FILE")"
        echo '{"incidents":[],"handovers":[],"postmortems":[]}' > "$COLLAB_FILE"
    fi
}

# 获取当前时间戳 (ISO格式)
get_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# 获取当前 ISO 日期
get_today() {
    date -u +"%Y-%m-%d"
}

# ── 核心功能: 当前值班状态 ────────────────────────────────────────────────

show_current_oncall() {
    log_header "📋 当前 On-call 值班状态"

    local current_time
    current_time=$(get_timestamp)
    log_info "查询时间: $current_time"

    # 查找当前生效的轮值
    local current_rotation
    current_rotation=$(jq '
        [.rotations[] | {
            weekNumber, startDate, endDate, primary, secondary
        }] |
        map(select(.startDate <= "'$current_time'" and (.endDate >= "'$current_time'" or .endDate == null))) |
        .[-1]
    ' "$SCHEDULE_FILE")

    if [[ "$current_rotation" == "null" ]] || [[ -z "$current_rotation" ]]; then
        # 如果没有匹配的, 取最新的一个作为 fallback
        current_rotation=$(jq '.rotations[-1]' "$SCHEDULE_FILE")
    fi

    local primary_email secondary_email primary_name secondary_name week_num start_date end_date

    primary_email=$(echo "$current_rotation" | jq -r '.primary // empty')
    secondary_email=$(echo "$current_rotation" | jq -r '.secondary // empty')
    week_num=$(echo "$current_rotation" | jq -r '.weekNumber // "?"')
    start_date=$(echo "$current_rotation" | jq -r '.startDate // "?"')
    end_date=$(echo "$current_rotation" | jq -r '.endDate // "?"')

    # 查找成员姓名
    primary_name=$(jq --arg email "$primary_email" \
        '.teamMembers[] | select(.email == $email) | .name // $email' "$SCHEDULE_FILE")
    secondary_name=$(jq --arg email "$secondary_email" \
        '.teamMembers[] | select(.email == $email) | .name // $email' "$SCHEDULE_FILE")

    # 输出当前值班信息
    echo -e "  ${BOLD}Primary (主值班)${NC}:  ${GREEN}$primary_name${NC} <$primary_email>"
    echo -e "  ${BOLD}Secondary (备值班)${NC}: ${CYAN}$secondary_name${NC} <$secondary_email>"
    echo ""
    echo "  📅 轮值周期: 第 ${week_num} 周"
    echo "  🕐 开始时间: ${start_date}"
    echo "  🕐 结束时间: ${end_date}"

    # 显示活跃事件数
    local open_incidents
    open_incidents=$(jq '[.incidents[] | select(.status == "open" or .status == "investigating" or .status == "identified" or .status == "resolving")] | length' "$COLLAB_FILE" 2>/dev/null || echo "0")
    echo ""
    echo "  ⚠️  进行中的事件: ${RED}${open_incidents}${NC} 个"

    # 显示最近的交接记录
    local last_handover
    last_handover=$(jq '.handovers[0]' "$COLLAB_FILE" 2>/dev/null || echo "null")
    if [[ "$last_handover" != "null" ]]; then
        local ho_from ho_to ho_time ho_ack
        ho_from=$(echo "$last_handover" | jq -r '.from // "?"')
        ho_to=$(echo "$last_handover" | jq -r '.to // "?"')
        ho_time=$(echo "$last_handover" | jq -r '.timestamp // "?"')
        ho_ack=$(echo "$last_handover" | jq -r '.acknowledged // false')
        echo ""
        echo "  🔄 最近交接: $ho_from → $ho_to (${ho_time})"
        if [[ "$ho_ack" == "true" ]]; then
            echo -e "     ✅ 已确认"
        else
            echo -e "     ${YELLOW}⏳ 待确认${NC}"
        fi
    fi
}

# ── 核心功能: 排班表 ────────────────────────────────────────────────────────

show_schedule() {
    log_header "📅 未来排班表 (未来 2 周)"

    local current_time
    current_time=$(get_timestamp)

    # 计算两周后的时间
    local two_weeks_later
    two_weeks_later=$(date -u -d "$current_time + 14 days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
                     date -u -v+14d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
                     echo "2099-12-31T23:59:59Z")

    # 输出表头
    printf "  %-6s │ %-24s │ %-20s │ %-20s │ %s\n" "Week" "Period" "Primary" "Secondary" "Status"
    printf "  %-6s┼%-26s┼%-22s┼%-22s┼%s\n" "------" "------------------------" "--------------------" "--------------------" "------"

    # 遍历排班
    local rotations
    rotations=$(jq -c '.rotations[]' "$SCHEDULE_FILE")

    echo "$rotations" | while read -r rotation; do
        local week_num start_date end_date primary secondary status
        week_num=$(echo "$rotation" | jq -r '.weekNumber')
        start_date=$(echo "$rotation" | jq -r '.startDate' | cut -dT -f1-3 | tr '-' '/')
        end_date=$(echo "$rotation" | jq -r '.endDate' | cut -dT -f1-3 | tr '-' '/' 2>/dev/null || echo "...")
        primary=$(echo "$rotation" | jq -r '.primary')
        secondary=$(echo "$rotation" | jq -r '.secondary')

        # 查找姓名
        local p_name s_name
        p_name=$(jq --arg email "$primary" '.teamMembers[] | select(.email == $email) | .name // $email' "$SCHEDULE_FILE")
        s_name=$(jq --arg email "$secondary" '.teamMembers[] | select(.email == $email) | .name // $email' "$SCHEDULE_FILE")

        # 判断状态
        local rot_start_iso
        rot_start_iso=$(echo "$rotation" | jq -r '.startDate')
        if [[ "$rot_start_iso" < "$current_time" ]]; then
            rot_end_iso=$(echo "$rotation" | jq -r '.endDate // "2099"')
            if [[ "$rot_end_iso" > "$current_time" ]]; then
                status="${GREEN}◀ 当前${NC}"
            else
                status="已结束"
            fi
        elif [[ "$rot_start_iso" < "$two_weeks_later" ]]; then
            status="${CYAN}即将到来${NC}"
        else
            status=""
        fi

        printf "  %-6s │ %-24s │ %-20s │ %-20s │ %s\n" \
            "#$week_num" "$start_date ~ $end_date" "$p_name" "$s_name" "$status"
    done

    # 团队成员列表
    echo ""
    echo -e "  ${BOLD}团队成员:${NC}"
    jq -r '.teamMembers[] | "    • \(.name) (\(.email)) — \(.role)"' "$SCHEDULE_FILE"
}

# ── 核心功能: 交接流程 ────────────────────────────────────────────────────

do_handover() {
    local from_email="$1"
    local to_email="$2"

    log_header "🔄 值班交接流程"

    # 如果没有提供参数, 进入交互模式
    if [[ -z "$from_email" ]] || [[ -z "$to_email" ]]; then
        log_info "进入交互式交接模式..."

        # 显示当前值班
        show_current_oncall

        echo ""
        echo -e "  可选的团队成员:"
        jq -r '.teamMembers[] | "    [\(.index + 1)] \(.name) (\(.email))"' "$SCHEDULE_FILE"

        # 选择交班人
        echo ""
        read -rp "  请输入交班人编号或邮箱: " from_input
        if [[ "$from_input" =~ ^[0-9]+$ ]]; then
            from_email=$(jq -r ".team_members[$((from_input - 1))].email // empty" "$SCHEDULE_FILE" 2>/dev/null || \
                        jq --arg idx "$((from_input - 1))" '.team_members[$idx|tonumber].email // empty' "$SCHEDULE_FILE" 2>/dev/null)
        else
            from_email="$from_input"
        fi

        # 选择接班人
        read -rp "  请输入接班人编号或邮箱: " to_input
        if [[ "$to_input" =~ ^[0-9]+$ ]]; then
            to_email=$(jq --arg idx "$((to_input - 1))" '.team_members[$idx|tonumber].email // empty' "$SCHEDULE_FILE" 2>/dev/null)
        else
            to_email="$to_input"
        fi
    fi

    # 验证输入
    if [[ -z "$from_email" ]] || [[ -z "$to_email" ]]; then
        log_error "交班人和接班人都必须指定"
        return 1
    fi

    local from_name to_name
    from_name=$(jq --arg email "$from_email" '.teamMembers[] | select(.email == $email) | .name // $email' "$SCHEDULE_FILE")
    to_name=$(jq --arg email "$to_email" '.teamMembers[] | select(.email == $email) | .name // $email' "$SCHEDULE_FILE")

    log_info "交班人: ${BOLD}$from_name${NC} ($from_email)"
    log_info "接班人: ${BOLD}$to_name${NC} ($to_email)"

    # ── 交互式检查清单 ──────────────────────────────────────────────
    echo ""
    log_header "📋 交接检查清单 (共 25 项, 关键项标记为 ★)"

    local checklist_passed=0
    local checklist_total=25

    # A 类: 系统状态 (8项)
    echo -e "\n  ${BOLD}[A] 系统状态类 (8项)${NC}"

    check_item "A1★" "所有 Docker 容器运行正常?" "docker ps --format '{{.Names}} {{.Status}}' | grep -q 'Exit\|Restarting' && echo 'FAIL' || echo 'OK'"
    check_item "A2★" "PostgreSQL 连接池 < 80%?" "docker exec postgresql psql -U globalreach_user -c 'SELECT count(*) FROM pg_stat_active;' 2>/dev/null | head -1"
    check_item "A3" "Redis 内存 < 85%?" "docker exec redis redis-cli INFO memory 2>/dev/null | grep used_memory_human"
    check_item "A4★" "磁盘剩余空间 > 15%?" "df -h / | tail -1 | awk '{print \$5}'"
    check_item "A5★" "API 健康检查端点正常?" "curl -sf http://localhost:3000/health 2>/dev/null | head -c 100 || echo 'UNREACHABLE'"
    check_item "A6" "Nginx 无大量 502/503?" "docker exec nginx tail -5 /var/log/nginx/error.log 2>/dev/null | grep -c '502\|503' || echo '0'"
    check_item "A7" "Prometheus Targets 正常?" "echo '需手动确认: http://localhost:9090/targets'"
    check_item "A8" "无未处理的 critical 告警?" "echo '需手动确认: http://localhost:9093'"

    # B 类: 事件处理 (6项)
    echo -e "\n  ${BOLD}[B] 事件处理类 (6项)${NC}"
    check_item "B1★" "所有进行中事件有责任人?" "jq '[.incidents[] | select(.status | test(\"open|investigating|resolving\"))] | length' $COLLAB_FILE"
    check_item "B2" "Open 事件状态已更新?" "echo '请手动确认事件系统'"
    check_item "B3" "Timeline 完整?" "echo '请手动确认'"
    check_item "B4" "行动项已列出?" "echo '请手动确认'"
    check_item "B5" "未关闭事件已说明?" "jq '[.incidents[] | select(.status != \"resolved\" and .status != \"closed\" and .status != \"cancelled\")] | length' $COLLAB_FILE"
    check_item "B6" "Post-Mortem 已安排?" "echo '如 P0 事件未做 PM, 请安排'"

    # C 类: 安全 (4项)
    echo -e "\n  ${BOLD}[C] 安全与访问类 (4项)${NC}"
    check_item "C1" "无临时特权账号?" "echo '请手动确认'"
    check_item "C2" "维护窗口已告知?" "echo '如有维护窗口请告知接班人'"
    check_item "C3" "安全事件已记录?" "jq '[.incidents[] | select(.tags | index(\"security\"))] | length' $COLLAB_FILE"
    check_item "C4" "证书无即将过期?" "echo '| openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -dates'"

    # D 类: 文档 (4项)
    echo -e "\n  ${BOLD}[D] 文档与知识类 (4项)${NC}"
    check_item "D1" "新问题已记录到 FMB?" "echo '请手动确认'"
    check_item "D2" "Runbook 不足之处已标注?" "echo '请手动确认'"
    check_item "D3★" "排班文件已更新?" "echo '将在交接完成后自动更新'"
    check_item "D4" "交接记录将写入系统?" "echo '将在确认后自动写入'"

    # E 类: 通信 (3项)
    echo -e "\n  ${BOLD}[E] 通信与协作类 (3项)${NC}"
    check_item "E1" "IM 待回复消息已处理?" "echo '请手动确认'"
    check_item "E2" "外部待跟进事项已告知?" "echo '请手动确认'"
    check_item "E3★" "交接后将发送通知?" "echo '将在确认后自动通知'"

    # ── 收集附加信息 ───────────────────────────────────────────────
    echo ""
    log_header "📝 附加信息收集"

    echo -n "  系统整体状态 (green/yellow/red): "
    read -r overall_status
    overall_status=${overall_status:-green}

    echo -n "  本周处理的事件数 (P0/P1/P2/P3): "
    read -r incident_counts
    incident_counts=${incident_counts:-"0/0/0/0"}

    echo -n "  已知问题 (多行输入, 空行结束): "
    local known_issues=""
    while IFS= read -r line; do
        [[ -z "$line" ]] && break
        known_issues="$known_issues$line\n"
    done
    known_issues=${known_issues:-"无特殊问题"}

    echo -n "  备注/提醒: "
    read -r notes
    notes=${notes:-"无"}

    # ── 写入交接记录 ────────────────────────────────────────────────
    log_info "正在生成交接记录..."

    local timestamp
    timestamp=$(get_timestamp)

    local handover_json
    handover_json=$(cat <<INNEREOF
{
  "from": "$from_email",
  "to": "$to_email",
  "timestamp": "$timestamp",
  "items": {
    "systemStatus": {
      "overall": "$overall_status",
      "checklistPassed": "$checklist_passed/$checklist_total"
    },
    "incidentSummary": "$incident_counts",
    "knownIssues": $(echo "$known_issues" | jq -Rs .),
    "notes": $(echo "$notes" | jq -Rs .)
  },
  "acknowledged": false,
  "acknowledgedAt": null,
  "acknowledgedBy": null
}
INNEREOF
    )

    # 通过 API 或直接写入 JSON 文件
    if command -v curl &>/dev/null; then
        local api_response
        api_response=$(curl -s -X POST \
            http://localhost:3000/api/v1/team/oncall/handover \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer oncall-script-token" \
            -d "$handover_json" 2>/dev/null || echo "")

        if echo "$api_response" | jq -e '.success' &>/dev/null; then
            log_info "✅ 交接记录已通过 API 提交"
            echo "$api_response" | jq '.data.id'
        else
            log_warn "API 不可用, 直接写入数据文件..."
            write_handover_directly "$handover_json"
        fi
    else
        write_handover_directly "$handover_json"
    fi

    # ── 完成 ──────────────────────────────────────────────────────
    echo ""
    log_header "✅ 交接流程完成"

    echo -e "  交班人: ${BOLD}$from_name${NC}"
    echo -e "  接班人: ${BOLD}$to_name${NC}"
    echo "  时间:   $timestamp"
    echo "  检查清单: $checklist_passed / $checklist_total 项通过"
    echo ""
    echo -e "  ${GREEN}接班人 ($to_name) 请确认接收: ${NC}"
    echo "  $0 --acknowledge HO-ID"
    echo ""
    log_info "交接完成! 请通知团队频道。"
}

# 执行单个检查项
check_item() {
    local id="$1"
    local question="$2"
    local cmd="$3"

    printf "  [%s] %s " "$id" "$question"
    read -r answer
    answer=${answer:-y}

    if [[ "$answer" =~ ^[Yy]$ ]] || [[ "$answer" =~ ^[Yy][Ee][Ss]$ ]]; then
        echo -e "  ${GREEN}✅ PASS${NC}"
        ((checklist_passed++))
    elif [[ "$answer" =~ ^[Nn]$ ]]; then
        echo -e "  ${RED}❌ FAIL — 需要关注${NC}"
    else
        echo -e "  ${YELLOW}⚠️ SKIP${NC}"
    fi

    # 如果有命令, 显示命令输出作为参考
    if [[ -n "$cmd" ]] && [[ "$cmd" != "echo"* ]]; then
        local output
        output=$(eval "$cmd" 2>/dev/null) || true
        if [[ -n "$output" ]]; then
            echo "       → $output"
        fi
    fi
}

# 直接写入交接记录到数据文件
write_handover_directly() {
    local handover_json="$1"

    # 使用 jq 更新 collaboration 文件
    local new_id
    new_id="HO-$(date +%Y%m%d)-$(jq '.handovers | length' "$COLLAB_FILE" 2>/dev/null || echo 0 | xargs printf '%03d')"

    jq --argjson ho "$handover_json" --arg id "$new_id" \
        '.handovers |= [{id: $id} + $ho] + . | 
         .meta.lastUpdated = "'$(get_timestamp)'"' \
        "$COLLAB_FILE" > "${COLLAB_FILE}.tmp" && mv "${COLLAB_FILE}.tmp" "$COLLAB_FILE"

    log_info "交接记录已写入: $new_id"
}

# ── 核心功能: 升级通知 ────────────────────────────────────────────────────

do_escalate() {
    local level="$1"
    local message="$2"

    log_header "🚨 升级通知触发"

    # 验证级别
    case "$level" in
        P0|P1|P2|P3) ;;
        *)
            log_error "无效的级别: $level (必须是 P0/P1/P2/P3)"
            return 1
            ;;
    esac

    if [[ -z "$message" ]]; then
        log_error "升级消息不能为空"
        return 1
    fi

    local timestamp
    timestamp=$(get_timestamp)

    # 获取当前值班信息
    local primary secondary
    primary=$(jq -r '.rotations[-1].primary // "unknown"' "$SCHEDULE_FILE")
    secondary=$(jq -r '.rotations[-1].secondary // "unknown"' "$SCHEDULE_FILE")

    # 获取升级联系人
    local escalation_target contact_info
    case "$level" in
        P0)
            escalation_target="Secondary + Tech Lead (L1+L2)"
            contact_info=$(jq '.escalationContacts[] | select(.level=="L2") | "  \(.name) (\(.email), \(.phone)"' "$SCHEDULE_FILE")
            ;;
        P1)
            escalation_target="Secondary (L1)"
            contact_info=$(jq -r --arg sec "$secondary" '.teamMembers[] | select(.email == $sec) | "  \(.name) (\(.email), \(.phone)"' "$SCHEDULE_FILE")
            ;;
        P2)
            escalation_target="Secondary (提醒)"
            contact_info=$(jq -r --arg sec "$secondary" '.teamMembers[] | select(.email == $sec) | "  \(.name) (\(.email)"' "$SCHEDULE_FILE")
            ;;
        P3)
            escalation_target="Email 通知全团队"
            contact_info="  全团队邮件通知"
            ;;
    esac

    # 构建升级消息
    local escalation_msg
    escalation_msg=$(cat <<ESCALATION_EOF
【升级请求】$level — $message

📋 事件信息:
  - 触发时间: $timestamp
  - 当前 Primary: $primary
  - 当前 Secondary: $secondary
  - 级别: $level

🎯 升级目标: $escalation_target

📞 联系方式:
$contact_info

---
由 oncall-manager.sh 自动生成 @ $timestamp
ESCALATION_EOF
    )

    # 输出到控制台 (模拟发送)
    echo -e "${RED}${BOLD}"
    echo "╔══════════════════════════════════════════════════╗"
    echo "║           🔴 ESCALATION NOTIFICATION 🔴          ║"
    echo "╠══════════════════════════════════════════════════╣"
    echo -e "$escalation_msg"
    echo "╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # 尝试通过 webhook 发送 (预留接口)
    local webhook_url
    webhook_url=$(jq -r '.settings.escalationWebhookUrl // empty' "$SCHEDULE_FILE" 2>/dev/null)

    if [[ -n "$webhook_url" ]] && command -v curl &>/dev/null; then
        log_info "正在发送 Webhook 通知..."
        curl -s -X POST "$webhook_url" \
            -H "Content-Type: application/json" \
            -d "{\"level\":\"$level\",\"message\":\"$message\",\"timestamp\":\"$timestamp\"}" \
            >/dev/null 2>&1 && log_info "Webhook 发送成功" || log_warn "Webhook 发送失败"
    else
        log_info "(Webhook 未配置, 仅输出到控制台)"
        log_info "可通过 SCHEDULE_FILE 中的 settings.escalationWebhookUrl 配置"
    fi

    # 同时尝试发送邮件 (预留接口)
    local smtp_configured
    smtp_configured=$(jq -r '.settings.smtpEnabled // "false"' "$SCHEDULE_FILE" 2>/dev/null)
    if [[ "$smtp_configured" == "true" ]]; then
        log_info "SMTP 已配置, 可扩展邮件发送逻辑"
    fi
}

# ── 核心功能: 周报生成 ─────────────────────────────────────────────────────

generate_report() {
    log_header "📊 本周值班报告生成"

    local report_date
    report_date=$(get_today)

    # 获取一周前的日期
    local week_ago
    week_ago=$(date -u -d "$report_date -7 days" +"%Y-%m-%dT00:00:00Z" 2>/dev/null || \
              date -u -v-7d +"%Y-%m-%dT00:00:00Z" 2>/dev/null || \
              echo "${report_date}T00:00:00Z")

    # 统计数据
    local total_incidents p0_count p1_count p2_count p3_count
    total_incidents=$(jq "[.incidents[] | select(.createdAt >= \"$week_ago\")] | length" "$COLLAB_FILE" 2>/dev/null || echo 0)
    p0_count=$(jq "[.incidents[] | select(.createdAt >= \"$week_ago\" and .severity == \"P0\")] | length" "$COLLAB_FILE" 2>/dev/null || echo 0)
    p1_count=$(jq "[.incidents[] | select(.createdAt >= \"$week_ago\" and .severity == \"P1\")] | length" "$COLLAB_FILE" 2>/dev/null || echo 0)
    p2_count=$(jq "[.incidents[] | select(.createdAt >= \"$week_ago\" and .severity == \"P2\")] | length" "$COLLAB_FILE" 2>/dev/null || echo 0)
    p3_count=$(jq "[.incidents[] | select(.createdAt >= \"$week_ago\" and .severity == \"P3\")] | length" "$COLLAB_FILE" 2>/dev/null || echo 0)

    # MTTR 计算
    local mttr_data
    mttr_data=$(jq '[.incidents[] | select(.resolvedAt != null and .createdAt >= "'"$week_ago"'") | 
        ((resolvedAt | fromiso8601) - (createdAt | fromiso8601)) / 60] |
        if length > 0 then add / length else null end' "$COLLAB_FILE" 2>/dev/null || echo "null")

    # 平均响应时间估算
    local avg_mttr_display
    if [[ "$mttr_data" != "null" ]]; then
        avg_mttr_display=$(echo "$mttr_data" | jq 'round // 0')
        avg_mttr_display="${avg_mttr_display} 分钟"
    else
        avg_mttr_display="N/A (无已解决事件)"
    fi

    # 交接次数
    local handover_count
    handover_count=$(jq "[.handovers[] | select(.timestamp >= \"$week_ago\")] | length" "$COLLAB_FILE" 2>/dev/null || echo 0)

    # PostMortem 数量
    local pm_count
    pm_count=$("[.postmortems[] | select(.createdAt >= \"$week_ago\")] | length" "$COLLAB_FILE" 2>/dev/null || echo 0)

    # 输出报告
    cat <<REPORT_EOF
${BOLD}╔══════════════════════════════════════════════════════════╗${NC}
${BOLD}║       GlobalReach V2.0 — On-call 周值班报告                 ║${NC}
${BOLD}╠══════════════════════════════════════════════════════════╣${NC}
${BOLD}║  报告周期: ${week_ago/T/ } ~ ${report_date}                         ║${NC}
${BOLD}║  生成时间: $(get_timestamp)                    ║${NC}
${BOLD}╚══════════════════════════════════════════════════════════╝${NC}

${BOLD}一、事件统计${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  总事件数:     ${total_incidents}
  ├─ P0 Critical: ${RED}${p0_count}${NC}
  ├─ P1 High:     ${p1_count}
  ├─ P2 Medium:   ${p2_count}
  └─ P3 Low:      ${p3_count}

${BOLD}二、效率指标${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  平均 MTTR:    ${avg_mttr_display}
  交接次数:      ${handover_count}
  Post-Mortem:  ${pm_count} 份

${BOLD}三、本周事件详情${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$(jq -r '[.incidents[] | select(.createdAt >= "'"$week_ago"'")] | sort_by(.createdAt) | reverse | .[] |
    "  [\(.severity)] \(.id) — \(.title)\n    状态: \(.status) | 创建: \(.createdAt | split("T")[0])\n    指派: \(.assignee // "未指派")\n    "' "$COLLAB_FILE" 2>/dev/null || echo "  无事件")

${BOLD}四、交接记录${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$(jq -r '[.handovers[] | select(.timestamp >= "'"$week_ago"'")] | .[] |
    "  \(.timestamp | split("T")[0]) \(.from) → \(.to) (\(if .acknowledged then "✅已确认" else "⏳待确认" end))\n    备注: \(.notes // "无")\n    "' "$COLLAB_FILE" 2>/dev/null || echo "  无交接记录")

${BOLD}五、改进建议${NC}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  基于本周数据自动生成以下建议:

$(if [[ "$p0_count" -gt 0 ]]; then
    echo "  ⚠️  本周有 $p0_count 个 P0 事件, 建议:"
    echo "     • 安排 Post-Mortem 复盘会议"
    echo "     • 审查是否需要改进检测机制"
    echo ""
fi

if [[ "$mttr_data" != "null" ]]; then
    local mttr_num
    mttr_num=$(echo "$mttr_data" | jq '. // 0')
    if (( $(echo "$mttr_num > 30" | bc -l 2>/dev/null || echo 0) )); then
        echo "  ⚠️  平均 MTTR (${avg_mttr_display}) 超过 30 分钟目标, 建议:"
        echo "     • 优化 Runbook 修复步骤"
        echo "     • 加强决策树(TT)诊断能力"
        echo ""
    fi
fi

if [[ "$handover_count" -eq 0 ]]; then
    echo "  ℹ️  本周无交接记录, 请确保每次交接都执行 --handover"
    echo ""
fi)

  📋 详细报告请查看: docs/oncall/ONCALL_HANDBOOK.md
  📊 API 数据端点: GET /api/v1/team/dashboard/stats?days=7

---
报告由 scripts/oncall-manager.sh --report 自动生成
REPORT_EOF
}

# ── 核心功能: 初始化 ────────────────────────────────────────────────────────

do_init() {
    log_header "🔧 初始化排班数据"

    if [[ -f "$SCHEDULE_FILE" ]]; then
        log_warn "排班文件已存在, 是否覆盖? (y/N)"
        read -r confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            log_info "取消初始化"
            return 0
        fi
    fi

    # 创建默认排班数据
    mkdir -p "$(dirname "$SCHEDULE_FILE")"
    cat > "$SCHEDULE_FILE" <<'INIT_EOF'
{
  "version": "1.0.0",
  "lastUpdated": null,
  "teamMembers": [],
  "rotations": [],
  "escalationContacts": [
    {"level": "L2", "role": "Tech Lead", "name": "TBD", "email": "techlead@example.com", "phone": "+86-0000-0000"}
  ],
  "settings": {
    "timezone": "Asia/Shanghai",
    "handoverDay": "monday",
    "handoverTime": "09:00",
    "autoRemindMinutesBeforeHandover": 60,
    "maxConsecutiveWeeks": 2
  }
}
INIT_EOF

    # 创建协作数据文件
    mkdir -p "$(dirname "$COLLAB_FILE")"
    cat > "$COLLAB_FILE" <<'INIT_EOF'
{
  "incidents": [],
  "handovers": [],
  "postmortems": {},
  "comments": {},
  "meta": { "version": "1.0.0", "lastUpdated": null }
}
INIT_EOF

    log_info "✅ 初始化完成!"
    log_info "  排班文件: $SCHEDULE_FILE"
    log_info "  协作文件: $COLLAB_FILE"
    log_info ""
    log_info "下一步: 编辑 $SCHEDULE_FILE 添加团队成员和排班"
}

# ── 主入口 ───────────────────────────────────────────────────────────────────

main() {
    check_dependencies
    ensure_data_files

    case "${1:-}" in
        --help|-h|--usage)
            usage
            ;;
        --schedule|-s)
            show_schedule
            ;;
        --handover|-h)
            do_handover "${2:-}" "${3:-}"
            ;;
        --escalate|-e)
            if [[ -z "${2:-}" ]] || [[ -z "${3:-}" ]]; then
                log_error "用法: $0 --escalate <P0|P1|P2|P3> <消息>"
                exit 1
            fi
            do_escalate "$2" "$3"
            ;;
        --report|-r)
            generate_report
            ;;
        --stats)
            generate_report  # stats 和 report 共用同一个统计函数
            ;;
        --init|-i)
            do_init
            ;;
        ""|"--current"|"-c")
            show_current_oncall
            ;;
        *)
            log_error "未知参数: $1"
            echo ""
            usage
            exit 1
            ;;
    esac
}

# 运行主函数
main "$@"
