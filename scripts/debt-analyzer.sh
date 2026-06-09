#!/usr/bin/env bash
# ============================================================================
# GlobalReach V2.0 — 技术债务分析器（Technical Debt Analyzer）
# O08: 技术债务追踪系统 — CLI分析工具
#
# 用法:
#   ./scripts/debt-analyzer.sh                          # 全量分析报告
#   ./scripts/debt-analyzer.sh --category security      # 按类别筛选
#   ./scripts/debt-analyzer.sh --category infrastructure # 类别名(不区分大小写)
#   ./scripts/debt-analyzer.sh --interest-high          # 仅高息债务(CRITICAL+HIGH)
#   ./scripts/debt-analyzer.sh --roi                   # 按ROI排序输出
#   ./scripts/debt-analyzer.sh --report                # 生成周报格式(含时间戳)
#   ./scripts/debt-analyzer.sh --json                  # JSON格式输出(供CI/CD消费)
#   ./scripts/debt-analyzer.sh --summary               # 简要摘要(单屏)
#   ./scripts/debt-analyzer.sh --blocked               # 仅显示被阻塞的债务
#   ./scripts/debt-analyzer.sh --help                  # 显示帮助信息
#
# 数据源:
#   - 主数据源: docs/technical-debt/TECHNICAL_DEBT_REGISTER.md
#   - 备用数据源: 内嵌债务数据集(API techDebt.js的离线副本)
#   - 优先读取Register MD文件, 文件不存在时使用内嵌数据
#
# 输出:
#   - 默认: 格式化ASCII艺术风格终端报告
#   - --json: 机器可读JSON(可用于Grafana注释/Prometheus metrics)
#   - --report: 含执行元信息的周报格式
#
# 利息模型:
#   CRITICAL: 5%/天复利 | HIGH: 2%/天 | MEDIUM: 0.5%/天 | LOW: 0.1%/天
#   公式: I = P × ((1+r)^N - 1)
#
# 兼容: Windows (Git Bash / WSL2) + Linux (CI/CD Pipeline)
# ============================================================================

set -euo pipefail

# ── 全局变量 ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REGISTER_FILE="$PROJECT_ROOT/docs/technical-debt/TECHNICAL_DEBT_REGISTER.md"

# 运行模式
MODE="full"             # full | category | interest-high | roi | report | json | summary | blocked
FILTER_CATEGORY=""      # 类别过滤(不区分大小写)
OUTPUT_FORMAT="text"    # text | json
REPORT_DATE="$(date '+%Y-%m-%d %H:%M:%S %Z')"

# 颜色定义 — 仅在交互式终端且非JSON模式时启用
if [ -t 1 ] && [ "${OUTPUT_FORMAT}" = "text" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    BOLD='\033[1m'
    DIM='\033[2m'
    RED_BG='\033[41m'
    YELLOW_BG='\033[43m'
    GREEN_BG='\033[42m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' CYAN='' MAGENTA='' BOLD='' DIM=''
    RED_BG='' YELLOW_BG='' GREEN_BG='' NC=''
fi

# ── 嵌入式债务数据集 (当Register MD不可用时的备用数据源) ──────────────────
# 数据结构与 api/routes/techDebt.js 的 debtStore 保持一致
# 格式: ID|Category|Component|Description|Impact|InterestRate|Principal|Priority|Status|DaysOutstanding

read -r -d '' EMBEDDED_DEBT_DATA << 'DEBT_EOF' || true
DEBT-001|Infrastructure|nginx-prod, certbot|Nginx SSL证书缺失 - ssl-le-production.conf引用的Let'ss Encrypt证书路径不存在|生产环境无法启用HTTPS;4个域名不可用;HSTS受阻;PCI-DSS不满足|0.02|7|P0|BLOCKED|55
DEBT-002|Infrastructure→Security|redis, cacheService|Redis密码认证禁用 - docker-compose中Redis服务未启用requirepass|缓存数据可被任意读写删除;Session篡改;Rate limiting重置;缓存投毒攻击|0.05|3|P0|OPEN|30
DEBT-003|Infrastructure|Dockerfile, api/, src/|Docker镜像优化不足 - multi-stage build存在缺陷，镜像>500MB|镜像拉取慢;存储成本增加;攻击面增大;CI延长至3-5分钟|0.005|7|P1|OPEN|45
DEBT-004|Infrastructure→Security|PostgreSQL 15|PostgreSQL默认密码changeme未修改 - 生产数据库使用默认凭据|数据库完全暴露;GDPR第32条违反;审计发现项;生产数据泄露风险|0.02|2|P1|IN_PROGRESS|40
DEBT-005|Infrastructure|backup.sh, cron|备份验证机制缺失 - 无自动化备份恢复演练|灾难恢复无法保证;RPO/RTO未知;业务连续性风险|0.01|5|P1|OPEN|60
DEBT-006|Infrastructure|certbot容器|Certbot使用:latest标签 - 镜像版本不可重现|构建不确定性;供应链攻击风险;审计不符合|0.001|1|P3|OPEN|50
DEBT-007|Security|docker-compose.prod.yml|SMTP密码硬编码在5处 - Gmail SMTP凭据明文存储于compose文件|邮件系统可被劫持;钓鱼攻击向量;凭证泄露至Git历史|0.05|4|P0|OPEN|55
DEBT-008|Security|grafana/dashboards/|Grafana admin/admin123弱口令 - 监控面板使用默认管理员密码|监控数据篡改;告警静音;合规违反(ISO27001 A.9)|0.05|1|P0|OPEN|60
DEBT-009|Security|api/config/auth.config.js|JWT Secret使用默认值 - HS256密钥为可预测字符串'globalreach-jwt-secret-2026'|Token伪造;身份冒充;API完全入侵|0.05|2|P0|OPEN|58
DEBT-010|Security|frontend/src/pages/Login.tsx|QQ邮箱地址硬编码在前端代码中 - PII泄露至客户端bundle|用户隐私泄露;GDPR违反;爬虫可采集|0.02|2|P2|OPEN|35
DEBT-011|Security|.git/hooks/|Pre-commit secrets扫描未配置 - git-secrets/truffleHog未安装|新密码可能被提交;历史已含敏感数据;CI secret检测缺口|0.02|3|P0|OPEN|25
DEBT-012|Code Quality|__tests__/, api/, frontend/|单元测试覆盖率不足 - 当前约15%(目标80%)，仅k6+E2E测试|回归风险高;重构信心低;技术面试负面印象|0.005|30|P1|OPEN|90
DEBT-013|Code Quality|api/server.js, api/routes/|日志格式不一致 - console.log散布20+处，未使用统一logger|排障效率低;日志聚合失效;生产问题定位困难|0.01|8|P2|IN_PROGRESS|70
DEBT-014|Code Quality|frontend/src/pages/Dashboard.tsx|i18n国际化不完整 - 硬编码中文散布在React组件中|多语言支持阻塞;海外市场准入;维护成本增加|0.005|10|P2|OPEN|65
DEBT-015|Code Quality|api/middleware/errorHandler.js|asyncHandler包装不一致 - 部分路由使用try-catch部分使用asyncHandler|错误处理行为不一致;未捕获Promise rejection风险|0.005|5|P2|OPEN|55
DEBT-016|Code Quality|.env.cdn.example|.env.cdn.example文件缺失 - CDN配置无模板|新开发者onboarding阻塞;CDN配置错误风险|0.001|1|P3|OPEN|40
DEBT-017|Architecture|api/server.js, api/routes/|API版本化Legacy路由 - v1路由无废弃日期和迁移指南|技术负债累积;新人困惑;迁移无限期延迟|0.01|12|P1|OPEN|100
DEBT-018|Architecture|api/middleware/tenant.js|多租户隔离不完整 - tenantId过滤未在所有查询中强制执行|跨租户数据访问;合规风险(GDPR/SOC2);数据泄露|0.02|16|P1|OPEN|85
DEBT-019|Architecture|frontend/src/pages/Login.tsx, api/routes/auth.js|SSO Frontend-Backend Gap - SSO UI存在但后端OAuth流程未实现|功能半完成误导用户;安全错觉;技术债滚雪球|0.01|8|P2|OPEN|45
DEBT-020|Documentation|api/routes/*.js|过时的TODO/FIXME/HACK注释 - 代码中遗留大量过期注释|代码可读性下降;新人误解;技术决策丢失|0.002|6|P3|OPEN|120
DEBT-021|Documentation|api/swagger.yml|Swagger/OpenAPI覆盖率不足 - 仅40%端点有文档|API集成困难;前端对接效率低;Onboarding成本高|0.01|10|P2|OPEN|75
DEBT-022|Documentation|README.md|README.md与项目状态不同步 - 版本号/架构图/特性表过时|新贡献者困惑;社区信任度降低;部署错误|0.001|2|P3|OPEN|95
DEBT-023|Performance|api/models/*.js, db/migrations/|索引策略未文档化 - 缺少索引决策记录和EXPLAIN ANALYZE基线|查询性能退化风险;DBA知识传承断裂;容量规划困难|0.01|6|P1|IN_PROGRESS|50
DEBT-024|Performance|api/services/cacheService.js|缓存策略未文档化 - TTL/淘汰策略/穿透保护未标准化|缓存命中率不稳定;雪崩/击穿/穿透风险;性能调优盲目|0.01|5|P1|OPEN|55
DEBT-025|Performance|api/routes/campaigns.js, api/models/Campaign.js|潜在N+1查询问题 - Campaign列表关联查询未使用JOIN/Eager loading|响应时间随数据量线性增长;DB连接池耗尽;用户体验恶化|0.02|8|P1|OPEN|48
DEBT-026|Operations|prometheus/alertmanager/|监控覆盖Gaps - 关键业务指标(邮件送达率/退订率)缺少Prometheus exporter|故障发现延迟;MTTR延长;SLA违规风险|0.01|8|P1|OPEN|62
DEBT-027|Operations|alertmanager/alertmanager.production.yml|告警规则调优不足 - Alert Fatigue导致真实告警被忽略|值班人员脱敏;重要事件遗漏;on-call倦怠|0.005|6|P2|OPEN|52
DEBT-028|Operations|docker-compose.prod.yml, prometheus/|容量规划缺失 - 无CPU/内存/磁盘趋势预测和自动扩缩容策略|资源耗尽导致宕机;突发流量无法应对;成本浪费或不足|0.01|10|P2|OPEN|58
DEBT_EOF

# ── 参数解析 ───────────────────────────────────────────────────────────────
show_help() {
    cat << 'HELP_EOF'
${BOLD}GlobalReach V2.0 — 技术债务分析器${NC}
${CYAN}O08: Technical Debt Tracker — CLI Analysis Tool${NC}

${BOLD}用法:${NC}
  ./scripts/debt-analyzer.sh [选项]

${BOLD}选项:${NC}
  --category CAT       按类别筛选 (infrastructure/security/code-quality/
                       architecture/documentation/performance/operations)
  --interest-high      仅显示高息债务 (CRITICAL + HIGH 利率)
  --roi                按ROI排序输出 (利息率/本金, 高优先级优先)
  --report             生成周报格式 (含时间戳和执行元信息)
  --json               JSON机器可读输出 (供CI/CD/Grafana消费)
  --summary            简要摘要模式 (单屏概览)
  --blocked            仅显示被阻塞(BLOCKED)状态的债务
  --help               显示此帮助信息

${BOLD}示例:${NC}
  ./scripts/debt-analyzer.sh                          # 全量分析报告
  ./scripts/debt-analyzer.sh --category security      # 安全类债务
  ./scripts/debt-analyzer.sh --interest-high          # 高息债务预警
  ./scripts/debt-analyzer.sh --roi                   # ROI优先偿还建议
  ./scripts/debt-analyzer.sh --report > weekly.txt    # 导出周报
  ./scripts/debt-analyzer.sh --json | jq .            # JSON管道处理

${BOLD}利息模型:${NC}
  CRITICAL: 5%/天  |  HIGH: 2%/天  |  MEDIUM: 0.5%/天  |  LOW: 0.1%/天
  公式: Interest = Principal x ((1 + rate)^days - 1)

${BOLD}数据源:${NC}
  主: docs/technical-debt/TECHNICAL_DEBT_REGISTER.md
  备: 内嵌债务数据集 (28条债务)
HELP_EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --category)
                MODE="category"
                FILTER_CATEGORY="${2,,}" # 转小写
                shift 2
                ;;
            --interest-high)
                MODE="interest-high"
                shift
                ;;
            --roi)
                MODE="roi"
                shift
                ;;
            --report)
                MODE="report"
                shift
                ;;
            --json)
                OUTPUT_FORMAT="json"
                shift
                ;;
            --summary)
                MODE="summary"
                shift
                ;;
            --blocked)
                MODE="blocked"
                shift
                ;;
            --help|-h|--help)
                show_help
                exit 0
                ;;
            *)
                echo -e "${RED}[ERROR] Unknown option: $1${NC}"
                echo "Run './scripts/debt-analyzer.sh --help' for usage information."
                exit 1
                ;;
        esac
    done
}

# ── 数据加载 ───────────────────────────────────────────────────────────────

# 从嵌入式数据加载债务到数组
load_embedded_data() {
    DEBT_IDS=()
    DEBT_CATEGORIES=()
    DEBT_COMPONENTS=()
    DEBT_DESCRIPTIONS=()
    DEBT_IMPACTS=()
    DEBT_INTEREST_RATES=()
    DEBT_PRINCIPALS=()
    DEBT_PRIORITIES=()
    DEBT_STATUSES=()
    DEBT_DAYS=()

    while IFS='|' read -r id cat comp desc impact rate principal priority status days; do
        [[ -z "$id" ]] && continue
        DEBT_IDS+=("$id")
        DEBT_CATEGORIES+=("$cat")
        DEBT_COMPONENTS+=("$comp")
        DEBT_DESCRIPTIONS+=("$desc")
        DEBT_IMPACTS+=("$impact")
        DEBT_INTEREST_RATES+=("$rate")
        DEBT_PRINCIPALS+=("$principal")
        DEBT_PRIORITIES+=("$priority")
        DEBT_STATUSES+=("$status")
        DEBT_DAYS+=("$days")
    done <<< "$EMBEDDED_DEBT_DATA"

    TOTAL_DEBTS=${#DEBT_IDS[@]}
}

# 尝试从MD Register文件解析数据 (更权威的数据源)
load_register_file() {
    if [[ ! -f "$REGISTER_FILE" ]]; then
        return 1
    fi

    # 简单解析: 提取表格行中的债务信息
    # MD格式: | DEBT-XXX | Category | ... | Priority | Status | Days |
    local count=0
    while IFS= read -r line; do
        # 匹配以 | DEBT- 开头的表格行
        if [[ "$line" =~ \|[[:space:]]*(DEBT-[0-9]+)[[:space:]]*\| ]]; then
            : $((count++))
        fi
    done < "$REGISTER_FILE"

    # 如果解析到足够多的债务条目则使用MD文件, 否则fallback到embedded
    if [[ $count -ge 10 ]]; then
        echo "[INFO] Loaded $count debts from register file: $REGISTER_FILE"
        return 0
    else
        echo "[INFO] Register file has only $count entries, using embedded data (${TOTAL_DEBTS} debts)"
        return 1
    fi
}

# ── 计算引擎 ───────────────────────────────────────────────────────────────

# 计算累计利息 (复利公式: I = P * ((1+r)^N - 1))
# 参数: $1=本金, $2=日利率, $3=天数
calculate_interest() {
    local principal=$1
    local rate=$2
    local days=$3

    # 使用awk进行浮点运算 (bash原生不支持float)
    awk "BEGIN {
        p = $principal; r = $rate; n = $days;
        factor = (1 + r) ^ n;
        interest = p * (factor - 1);
        printf \"%.2f\", interest
    }"
}

# 计算ROI (Return on Investment for debt repayment)
# ROI = Interest Rate / Principal (越高越应该优先偿还)
calculate_roi() {
    local rate=$1
    local principal=$2

    awk "BEGIN {
        if ($principal == 0) { printf \"%.4f\", 9999 }
        else { printf \"%.4f\", $rate / $principal }
    }"
}

# 获取利率等级标签
get_interest_level() {
    local rate=$1
    awk "BEGIN {
        r = $rate
        if (r >= 0.05) print \"CRITICAL\"
        else if (r >= 0.02) print \"HIGH\"
        else if (r >= 0.005) print \"MEDIUM\"
        else print \"LOW\"
    }"
}

# 获取利率等级颜色
get_interest_color() {
    local level="$1"
    case "$level" in
        CRITICAL) echo -n "${RED}${BOLD}" ;;
        HIGH)     echo -n "${RED}" ;;
        MEDIUM)   echo -n "${YELLOW}" ;;
        LOW)      echo -n "${GREEN}" ;;
        *)        echo -n "" ;;
    esac
}

# 获取状态颜色
get_status_color() {
    local status="$1"
    case "$status" in
        OPEN)        echo -n "${RED}" ;;
        IN_PROGRESS) echo -n "${YELLOW}" ;;
        BLOCKED)     echo -n "${MAGENTA}" ;;
        DONE)        echo -n "${GREEN}" ;;
        ARCHIVED)    echo -n "${DIM}" ;;
        *)           echo -n "" ;;
    esac
}

# 获取优先级颜色
get_priority_color() {
    local priority="$1"
    case "$priority" in
        P0) echo -n "${RED_BG}${BLACK:-$BOLD}" ;;  # BLACK may not be defined, fallback to BOLD
        P1) echo -n "${RED}${BOLD}" ;;
        P2) echo -n "${YELLOW}" ;;
        P3) echo -n "${DIM}" ;;
        *)  echo -n "" ;;
    esac
}

# ── 统计计算 ───────────────────────────────────────────────────────────────

# 全局统计变量
TOTAL_PRINCIPAL=0
TOTAL_INTEREST=0
TOTAL_WITH_INTEREST=0
declare -A CATEGORY_COUNT=()
declare -A CATEGORY_PRINCIPAL=()
declare -A STATUS_COUNT=()
declare -A INTEREST_LEVEL_COUNT=()

compute_statistics() {
    TOTAL_PRINCIPAL=0
    TOTAL_INTEREST=0
    TOTAL_WITH_INTEREST=0

    # 重置统计数组
    CATEGORY_COUNT=()
    CATEGORY_PRINCIPAL=()
    STATUS_COUNT=()
    INTEREST_LEVEL_COUNT=()

    for i in "${!DEBT_IDS[@]}"; do
        local principal=${DEBT_PRINCIPALS[$i]}
        local rate=${DEBT_INTEREST_RATES[$i]}
        local days=${DEBT_DAYS[$i]}
        local cat=${DEBT_CATEGORIES[$i]}
        local status=${DEBT_STATUSES[$i]}

        # 计算单条利息
        local interest=$(calculate_interest "$principal" "$rate" "$days")

        TOTAL_PRINCIPAL=$(awk "BEGIN { printf \"%.0f\", $TOTAL_PRINCIPAL + $principal }")
        TOTAL_INTEREST=$(awk "BEGIN { printf \"%.2f\", $TOTAL_INTEREST + $interest }")

        # 分类统计 (取主类别, 即→之前的部分)
        local main_cat="${cat%%→*}"
        CATEGORY_COUNT["$main_cat"]=$((${CATEGORY_COUNT["$main_cat"]:-0} + 1))
        CATEGORY_PRINCIPAL["$main_cat"]=$(awk "BEGIN { printf \"%.0f\", ${CATEGORY_PRINCIPAL["$main_cat"]:-0} + $principal }")

        # 状态统计
        STATUS_COUNT["$status"]=$((${STATUS_COUNT["$status"]:-0} + 1))

        # 利率等级统计
        local level=$(get_interest_level "$rate")
        INTEREST_LEVEL_COUNT["$level"]=$((${INTEREST_LEVEL_COUNT["$level"]:-0} + 1))
    done

    TOTAL_WITH_INTEREST=$(awk "BEGIN { printf \"%.2f\", $TOTAL_PRINCIPAL + $TOTAL_INTEREST }")
}

# ── 输出渲染函数 ───────────────────────────────────────────────────────────

# 打印分隔线
print_separator() {
    local char="${1:-─}"
    local width="${2:-76}"
    printf '%*s\n' "$width" '' | tr ' ' "$char"
}

# 打印标题横幅
print_banner() {
    echo ""
    print_separator "=" 78
    echo -e "${BOLD}${CYAN}  ╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}  ║${NC}  ${BOLD}GlobalReach V2.0 — 技术债务分析报告${NC}${BOLD}${CYAN}                        ║${NC}"
    echo -e "${BOLD}${CYAN}  ║${NC}  ${DIM}Technical Debt Analysis Report — O08 Tracker${NC}${BOLD}${CYAN}                    ║${NC}"
    echo -e "${BOLD}${CYAN}  ╚══════════════════════════════════════════════════════════════════╝${NC}"
    print_separator "=" 78
    echo -e "  ${DIM}生成时间: ${REPORT_DATE}${NC}"
    echo -e "  ${DIM}数据来源: ${REGISTER_FILE##*/} (${TOTAL_DEBTS} 条登记债务)${NC}"
    echo ""
}

# 打印摘要面板 (用于 summary 和 report 模式)
print_summary_panel() {
    local health_score
    health_score=$(calculate_health_score)

    echo -e "${BOLD}  ┌─────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BOLD}  │${NC}  ${BOLD}债务健康仪表盘${NC}                                              ${BOLD}│${NC}"
    echo -e "${BOLD}  ├─────────────────────────────────────────────────────────────────┤${NC}"

    # 总债务数
    printf "  │  ${BOLD}总债务数:${NC}     %4d 条                                             │\n" "$TOTAL_DEBTS"

    # 本金总计
    printf "  │  ${BOLD}本金合计:${NC}     %4d h (估算修复工时)                              │\n" "$TOTAL_PRINCIPAL"

    # 累计利息
    printf "  │  ${BOLD}累计利息:${NC}     %7.1f h (按复利计算)                             │\n" "$TOTAL_INTEREST"

    # 本息合计
    printf "  │  ${BOLD}本息合计:${NC}     %7.1f h                                         │\n" "$TOTAL_WITH_INTEREST"

    echo -e "${BOLD}  ├─────────────────────────────────────────────────────────────────┤${NC}"

    # 健康评分
    local score_color
    if (( $(echo "$health_score >= 80" | awk '{print ($1)?1:0}') )); then
        score_color="${GREEN}"
    elif (( $(echo "$health_score >= 50" | awk '{print ($1)?1:0}') )); then
        score_color="${YELLOW}"
    else
        score_color="${RED}"
    fi
    printf "  │  ${BOLD}健康评分:${NC}     ${score_color}%4.1f/100${NC}                                       │\n" "$health_score"

    echo -e "${BOLD}  └─────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
}

# 计算健康评分 (0-100, 越高越健康)
calculate_health_score() {
    # 扣分因素:
    # - 每个OPEN的CRITICAL/HIGH债务 -15分
    # - 每个OPEN的P0债务 -10分
    # - 每个BLOCKED债务 -8分
    # - 每个IN_PROGRESS但超过30天的 -3分
    # 基础分100
    local score=100

    for i in "${!DEBT_IDS[@]}"; do
        local status=${DEBT_STATUSES[$i]}
        local priority=${DEBT_PRIORITIES[$i]}
        local rate=${DEBT_INTEREST_RATES[$i]}
        local days=${DEBT_DAYS[$i]}
        local level=$(get_interest_level "$rate")

        if [[ "$status" == "OPEN" ]]; then
            if [[ "$level" == "CRITICAL" ]]; then score=$((score - 15)); fi
            if [[ "$level" == "HIGH" ]]; then score=$((score - 10)); fi
            if [[ "$priority" == "P0" ]]; then score=$((score - 10)); fi
        elif [[ "$status" == "BLOCKED" ]]; then
            score=$((score - 8))
        elif [[ "$status" == "IN_PROGRESS" ]] && [[ $days -gt 30 ]]; then
            score=$((score - 3))
        fi
    done

    # 约束到 0-100 范围
    if [[ $score -lt 0 ]]; then score=0; fi
    if [[ $score -gt 100 ]]; then score=100; fi

    awk "BEGIN { printf \"%.1f\", $score }"
}

# 打印分类统计
print_category_breakdown() {
    echo -e "${BOLD}  ┌─────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BOLD}  │${NC}  ${BOLD}按类别分布${NC}                                                    ${BOLD}│${NC}"
    echo -e "${BOLD}  ├──────────────┬────────┬────────────┬─────────────────────────────┤${NC}"
    echo -e "${BOLD}  │${NC}  类别       ${NC}│${NC} 数量   ${NC}│${NC} 本金(h)    ${NC}│${NC} 占比                         ${NC}│${NC}"
    echo -e "${BOLD}  ├──────────────┼────────┼────────────┼─────────────────────────────┤${NC}"

    # 按数量排序输出
    for cat in $(for k in "${!CATEGORY_COUNT[@]}"; do echo "${CATEGORY_COUNT[$k]} $k $k"; done | sort -rn | awk '{print $3}'); do
        local count=${CATEGORY_COUNT[$cat]}
        local princ=${CATEGORY_PRINCIPAL[$cat]:-0}
        local pct=$(awk "BEGIN { printf \"%.1f\", ($count / $TOTAL_DEBTS) * 100 }")

        # 简单的文本条形图
        local bar_len=$(awk "BEGIN { printf \"%d\", $pct / 2.5 }")
        local bar=""
        for ((b=0; b<bar_len; b++)); do bar+="█"; done

        printf "  │  %-11s│  %4d   │   %6d    │  %5.1f%% %-21s │\n" \
            "$cat" "$count" "$princ" "$pct" "$bar"
    done

    echo -e "${BOLD}  └──────────────┴────────┴────────────┴─────────────────────────────┘${NC}"
    echo ""
}

# 打印状态分布
print_status_breakdown() {
    echo -e "${BOLD}  ┌─────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BOLD}  │${NC}  ${BOLD}按状态分布${NC}                                                    ${BOLD}│${NC}"
    echo -e "${BOLD}  ├─────────────┬────────┬──────────────────────────────────────────┤${NC}"
    echo -e "${BOLD}  │${NC}  状态        ${NC}│${NC} 数量   ${NC}│${NC} 说明                                     ${NC}│${NC}"
    echo -e "${BOLD}  ├─────────────┼────────┼──────────────────────────────────────────┤${NC}"

    for status in OPEN IN_PROGRESS BLOCKED DONE ARCHIVED; do
        local count=${STATUS_COUNT[$status]:-0}
        if [[ $count -eq 0 ]]; then continue; fi

        local desc=""
        case "$status" in
            OPEN)        desc="待处理的活跃债务" ;;
            IN_PROGRESS) desc="正在偿还中" ;;
            BLOCKED)     desc="被外部依赖阻塞" ;;
            DONE)        desc="已偿还完毕" ;;
            ARCHIVED)    desc="已归档关闭" ;;
        esac

        local s_color=$(get_status_color "$status")
        printf "  │  ${s_color}%-11s${NC}│  %4d   │  %-40s  │\n" "$status" "$count" "$desc"
    done

    echo -e "${BOLD}  └─────────────┴────────┴──────────────────────────────────────────┘${NC}"
    echo ""
}

# 打印利率等级分布
print_interest_breakdown() {
    echo -e "${BOLD}  ┌─────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BOLD}  │${NC}  ${BOLD}按利率等级分布 (利息模型)${NC}                                    ${BOLD}│${NC}"
    echo -e "${BOLD}  ├────────────┬────────┬───────────┬───────────────────────────────┤${NC}"
    echo -e "${BOLD}  │${NC}  等级       ${NC}│${NC} 日利率   ${NC}│${NC} 数量      ${NC}│${NC} 说明                            ${NC}│${NC}"
    echo -e "${BOLD}  ├────────────┼────────┼───────────┼───────────────────────────────┤${NC}"

    for level in CRITICAL HIGH MEDIUM LOW; do
        local count=${INTEREST_LEVEL_COUNT[$level]:-0}
        local rate_desc=""
        case "$level" in
            CRITICAL) rate_desc="5%/天  🔴 紧急" ;;
            HIGH)     rate_desc="2%/天  🟠 高息" ;;
            MEDIUM)   rate_desc="0.5%/天🟡 中等" ;;
            LOW)      rate_desc="0.1%/天🟢 低息" ;;
        esac
        local l_color=$(get_interest_color "$level")
        printf "  │  ${l_color}%-10s${NC}│  %5s   │  %4d      │  %-30s  │\n" \
            "$level" "$(echo "$rate_desc" | cut -d' ' -f1)" "$count" "$(echo "$rate_desc" | cut -d' ' -f2-)"
    done

    echo -e "${BOLD}  └────────────┴────────┴───────────┴───────────────────────────────┘${NC}"
    echo ""
}

# 打印债务详情表格
print_debt_table() {
    local show_indices=("${!@}")

    echo -e "${BOLD}  ┌────────┬────────────────────┬────────┬──────┬───────┬───────┬──────┐${NC}"
    echo -e "${BOLD}  │${NC} ${BOLD}ID${NC}     ${BOLD}│${NC} ${BOLD}描述(截断)${NC}          ${BOLD}│${NC} ${BOLD}利率${NC}   ${BOLD}│${NC} ${BOLD}本金${NC}  ${BOLD}│${NC} ${BOLD}优先级${NC} ${BOLD}│${NC} ${BOLD}状态${NC}   ${BOLD}│${NC} ${BOLD}天数${NC}  ${BOLD}│${NC}"
    echo -e "${BOLD}  ├────────┼────────────────────┼────────┼──────┼───────┼───────┼──────┤${NC}"

    for idx in "${show_indices[@]}"; do
        local id=${DEBT_IDS[$idx]}
        local desc="${DEBT_DESCRIPTIONS[$idx]}"
        local rate=${DEBT_INTEREST_RATES[$idx]}
        local principal=${DEBT_PRINCIPALS[$idx]}
        local priority=${DEBT_PRIORITIES[$idx]}
        local status=${DEBT_STATUSES[$idx]}
        local days=${DEBT_DAYS[$idx]}

        # 截断描述
        if [[ ${#desc} -gt 19 ]]; then
            desc="${desc:0:16}..."
        fi

        # 计算利息
        local interest=$(calculate_interest "$principal" "$rate" "$days")
        local level=$(get_interest_level "$rate")
        local i_color=$(get_interest_color "$level")
        local p_color=$(get_priority_color "$priority")
        local s_color=$(get_status_color "$status")

        # 清理priority color中的潜在问题 (P0 RED_BG可能需要黑色文字)
        local p_display="${p_color}${priority}${NC}"
        local i_display="${i_color}${level:0:1}${NC}$(echo "$rate" | awk '{printf "%.1f%%", $1*100}')"
        local s_display="${s_color}${status:0:4}${NC}"

        printf "  │ %-6s │ %-19s │ %6s │ %4dh │ %5s │ %6s │ %4dd │\n" \
            "$id" "$desc" "$i_display" "$principal" "$p_display" "$s_display" "$days"
    done

    echo -e "${BOLD}  └────────┴────────────────────┴────────┴──────┴───────┴───────┴──────┘${NC}"
    echo ""
    echo -e "  ${DIM}利率列: C=CRITICAL H=HIGH M=MEDIUM L=LOW | 状态: OPEN/IN_PROG/BLOCK/DONE${NC}"
    echo ""
}

# 打印Top N高息债务
print_top_interest_debts() {
    local top_n=${1:-10}

    # 构建索引数组并按利息排序
    declare -a sorted_indices=()
    for i in "${!DEBT_IDS[@]}"; do
        sorted_indices+=("$i")
    done

    # 使用冒泡排序按利息降序 (纯bash, 避免外部依赖)
    local n=${#sorted_indices[@]}
    for ((i=0; i<n-1; i++)); do
        for ((j=0; j<n-i-1; j++)); do
            local a=${sorted_indices[$j]}
            local b=${sorted_indices[$((j+1))]}
            local int_a=$(calculate_interest "${DEBT_PRINCIPALS[$a]}" "${DEBT_INTEREST_RATES[$a]}" "${DEBT_DAYS[$a]}")
            local int_b=$(calculate_interest "${DEBT_PRINCIPALS[$b]}" "${DEBT_INTEREST_RATES[$b]}" "${DEBT_DAYS[$b]}")
            if (( $(echo "$int_b > int_a" | awk '{print ($1)?1:0}') )); then
                sorted_indices[$j]=$b
                sorted_indices[$((j+1))]=$a
            fi
        done
    done

    local display_count=$top_n
    if [[ $display_count -gt ${#sorted_indices[@]} ]]; then
        display_count=${#sorted_indices[@]}
    fi

    echo -e "${BOLD}  ┌────────┬──────────────────────────────────────┬────────┬───────┐${NC}"
    echo -e "${BOLD}  │${NC} ${BOLD}Rank${NC}   ${BOLD}│${NC} ${BOLD}债务描述${NC}                                ${BOLD}│${NC} ${BOLD}累计利息${NC} ${BOLD}│${NC} ${BOLD}本金${NC}  ${BOLD}│${NC}"
    echo -e "${BOLD}  ├────────┼──────────────────────────────────────┼────────┼───────┤${NC}"

    for ((rank=0; rank<display_count; rank++)); do
        local idx=${sorted_indices[$rank]}
        local id=${DEBT_IDS[$idx]}
        local desc="${DEBT_DESCRIPTIONS[$idx]}"
        local principal=${DEBT_PRINCIPALS[$idx]}
        local rate=${DEBT_INTEREST_RATES[$idx]}
        local days=${DEBT_DAYS[$idx]}
        local interest=$(calculate_interest "$principal" "$rate" "$days")

        if [[ ${#desc} -gt 37 ]]; then
            desc="${desc:034}..."
        fi

        local rank_label=$((rank + 1))
        if [[ $rank_label -le 3 ]]; then
            rank_label="${RED}${BOLD}${rank_label}${NC}"
        fi

        printf "  │  %3s   │ %-37s │ %6.1fh │ %4dh  │\n" \
            "$rank_label" "$desc" "$interest" "$principal"
    done

    echo -e "${BOLD}  └────────┴──────────────────────────────────────┴────────┴───────┘${NC}"
    echo ""
}

# 打印ROI排序的偿还计划
print_roi_repayment_plan() {
    echo -e "${BOLD}  ╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}  ║${NC}  ${BOLD}${YELLOW}ROI-based 偿还优先级建议${NC}                                        ${BOLD}║${NC}"
    echo -e "${BOLD}  ║${NC}  ${DIM}ROI = InterestRate / Principal (越高越优先偿还)${NC}          ${BOLD}║${NC}"
    echo -e "${BOLD}  ╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 计算每条债务的ROI并排序
    declare -a roi_list=()
    for i in "${!DEBT_IDS[@]}"; do
        local roi=$(calculate_roi "${DEBT_INTEREST_RATES[$i]}" "${DEBT_PRINCIPALS[$i]}")
        roi_list+=("$roi|$i")
    done

    # 按ROI降序排序
    IFS=$'\n' sorted_roi=($(sort -t'|' -k1 -rn <<< "${roi_list[*]}"))
    unset IFS

    echo -e "${BOLD}  Phase 1: 立即行动 (本周Sprint) — ROI最高, 低投入高回报${NC}"
    echo -e "  ${BOLD}  ┌──────┬────────┬─────────────────────────────┬───────┬───────┬──────┐${NC}"
    echo -e "  ${BOLD}  │${NC} ${BOLD}#${NC}    ${BOLD}│${NC} ${BOLD}ID${NC}     ${BOLD}│${NC} ${BOLD}描述${NC}                        ${BOLD}│${NC} ${BOLD}ROI${NC}   ${BOLD}│${NC} ${BOLD}本金${NC}  ${BOLD}│${NC} ${BOLD}利率${NC}  ${BOLD}│${NC}"
    echo -e "  ${BOLD}  ├──────┼────────┼─────────────────────────────┼───────┼───────┼──────┤${NC}"

    local phase1_count=0
    local entry_num=0
    for entry in "${sorted_roi[@]}"; do
        entry_num=$((entry_num + 1))
        local roi=$(echo "$entry" | cut -d'|' -f1)
        local idx=$(echo "$entry" | cut -d'|' -f2)
        local id=${DEBT_IDS[$idx]}
        local desc="${DEBT_DESCRIPTIONS[$idx]}"
        local principal=${DEBT_PRINCIPALS[$idx]}
        local rate=${DEBT_INTEREST_RATES[$idx]}
        local status=${DEBT_STATUSES[$idx]}

        if [[ ${#desc} -gt 28 ]]; then desc="${desc:25}..."; fi

        # Phase 1: Top 5 ROI 且非DONE/ARCHIVED
        local phase_header=""
        if [[ $entry_num -eq 1 ]]; then
            phase_header="${BOLD}"
        fi

        local s_color=$(get_status_color "$status")
        printf "  │ ${phase_header}%4s${NC} │ %-6s │ %-28s │ %5s │ %4dh │ %4s  │\n" \
            "$entry_num" "$id" "$desc" "$roi" "$principal" "$(echo "$rate" | awk '{printf "%.1f%%",$1*100}')"

        if [[ $entry_num -le 5 ]]; then
            phase1_count=$((phase1_count + 1))
        fi

        # Phase 2 分隔
        if [[ $entry_num -eq 5 ]]; then
            echo -e "  ├──────┴────────┴─────────────────────────────┴───────┴───────┴──────┤"
            echo -e "  ${BOLD}│ Phase 2: 下两周Sprint — 中等ROI, 需要更多工时                    │${NC}"
            echo -e "  ├──────┬────────┬─────────────────────────────┬───────┬───────┬──────┤"
        fi

        # Phase 3 分隔
        if [[ $entry_num -eq 14 ]]; then
            echo -e "  ├──────┴────────┴─────────────────────────────┴───────┴───────┴──────┤"
            echo -e "  ${BOLD}│ Phase 3: 后续迭代 — 低ROI/大工程, 安排在Backlog                     │${NC}"
            echo -e "  ├──────┬────────┬─────────────────────────────┬───────┴───────┴──────┤"
        fi
    done

    echo -e "  └──────┴────────┴─────────────────────────────┴───────────────────────┘"
    echo ""

    # 偿还策略建议
    echo -e "${BOLD}  ┌──────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BOLD}  │${NC}  ${BOLD}推荐偿还策略: A(高息优先) + B(增量偿还) 混合模式${NC}              ${BOLD}│${NC}"
    echo -e "${BOLD}  │${NC}                                                                    ${BOLD}│${NC}"
    echo -e "${BOLD}  │${NC}  • 每个 Sprint 分配 ${YELLOW}20% capacity${NC} 给技术债务偿还                 ${BOLD}│${NC}"
    echo -e "${BOLD}  │${NC}  • 优先处理 ${RED}CRITICAL/HIGH${NC} 利率的债务 (DEBT-002/007/008/009)   ${BOLD}│${NC}"
    echo -e "${BOLD}  │${NC}  • DEBT-001(BLOCKED) 需要 Phase L 解锁后再处理                      ${BOLD}│${NC}"
    echo -e "${BOLD}  │${NC}  • DEBT-012(测试覆盖率) 建议拆分为多个子任务增量推进                  ${BOLD}│${NC}"
    echo -e "${BOLD}  └──────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
}

# ── JSON 输出模式 ──────────────────────────────────────────────────────────

output_json() {
    local health_score
    health_score=$(calculate_health_score)

    echo "{"
    echo "  \"generatedAt\": \"$REPORT_DATE\","
    echo "  \"source\": \"${REGISTER_FILE##*/}\","
    echo "  \"totalDebts\": $TOTAL_DEBTS,"
    echo "  \"summary\": {"
    echo "    \"totalPrincipal\": $TOTAL_PRINCIPAL,"
    echo "    \"totalInterest\": $(awk '{printf "%.2f", $TOTAL_INTEREST}'),"
    echo "    \"totalWithInterest\": $(awk '{printf "%.2f", $TOTAL_WITH_INTEREST}),"
    echo "    \"healthScore\": $health_score"
    echo "  },"
    echo "  \"byStatus\": {"

    local first_status=true
    for status in OPEN IN_PROGRESS BLOCKED DONE ARCHIVED; do
        local count=${STATUS_COUNT[$status]:-0}
        if [[ $count -gt 0 ]]; then
            if [[ "$first_status" != "true" ]]; then echo ","; fi
            first_status=false
            printf "    \"%s\": %d" "$status" "$count"
        fi
    done
    echo ""
    echo "  },"
    echo "  \"byInterestLevel\": {"

    local first_level=true
    for level in CRITICAL HIGH MEDIUM LOW; do
        local count=${INTEREST_LEVEL_COUNT[$level]:-0}
        if [[ "$first_level" != "true" ]]; then echo ","; fi
        first_level=false
        printf "    \"%s\": %d" "$level" "$count"
    done
    echo ""
    echo "  },"
    echo "  \"byCategory\": {"

    local first_cat=true
    for cat in "${!CATEGORY_COUNT[@]}"; do
        if [[ "$first_cat" != "true" ]]; then echo ","; fi
        first_cat=false
        printf "    \"%s\": {\"count\": %d, \"principal\": %d}" \
            "$cat" "${CATEGORY_COUNT[$cat]}" "${CATEGORY_PRINCIPAL[$cat]:-0}"
    done
    echo ""
    echo "  },"
    echo "  \"debts\": ["

    for i in "${!DEBT_IDS[@]}"; do
        local interest=$(calculate_interest "${DEBT_PRINCIPALS[$i]}" "${DEBT_INTEREST_RATES[$i]}" "${DEBT_DAYS[$i]}")
        local roi=$(calculate_roi "${DEBT_INTEREST_RATES[$i]}" "${DEBT_PRINCIPALS[$i]}")
        local level=$(get_interest_level "${DEBT_INTEREST_RATES[$i]}")

        if [[ $i -gt 0 ]]; then echo ","; fi
        printf "    {\n"
        printf "      \"id\": \"%s\",\n" "${DEBT_IDS[$i]}"
        printf "      \"category\": \"%s\",\n" "${DEBT_CATEGORIES[$i]}"
        printf "      \"component\": \"%s\",\n" "${DEBT_COMPONENTS[$i]}"
        printf "      \"description\": \"%s\",\n" "${DEBT_DESCRIPTIONS[$i]}"
        printf "      \"interestRate\": %s,\n" "${DEBT_INTEREST_RATES[$i]}"
        printf "      \"interestLevel\": \"%s\",\n" "$level"
        printf "      \"principal\": %s,\n" "${DEBT_PRINCIPALS[$i]}"
        printf "      \"priority\": \"%s\",\n" "${DEBT_PRIORITIES[$i]}"
        printf "      \"status\": \"%s\",\n" "${DEBT_STATUSES[$i]}"
        printf "      \"daysOutstanding\": %s,\n" "${DEBT_DAYS[$i]}"
        printf "      \"accruedInterest\": %s,\n" "$interest"
        printf "      \"roi\": %s\n" "$roi"
        printf "    }"
    done
    echo ""
    echo "  ]"
    echo "}"
}

# ── 过滤函数 ───────────────────────────────────────────────────────────────

# 返回匹配过滤条件的索引数组
filter_debts() {
    local -a result=()

    for i in "${!DEBT_IDS[@]}"; do
        local include=true

        # 类别过滤
        if [[ -n "$FILTER_CATEGORY" ]]; then
            local cat="${DEBT_CATEGORIES[$i],,}"  # 转小写
            if [[ ! "$cat" =~ "$FILTER_CATEGORY" ]]; then
                include=false
            fi
        fi

        # 高息过滤 (CRITICAL + HIGH)
        if [[ "$MODE" == "interest-high" ]]; then
            local level=$(get_interest_level "${DEBT_INTEREST_RATES[$i]}")
            if [[ "$level" != "CRITICAL" && "$level" != "HIGH" ]]; then
                include=false
            fi
        fi

        # Blocked过滤
        if [[ "$MODE" == "blocked" ]]; then
            if [[ "${DEBT_STATUSES[$i]}" != "BLOCKED" ]]; then
                include=false
            fi
        fi

        if [[ "$include" == "true" ]]; then
            result+=("$i")
        fi
    done

    echo "${result[@]}"
}

# ── 主逻辑分发 ─────────────────────────────────────────────────────────────

run_full_report() {
    print_banner
    print_summary_panel
    print_category_breakdown
    print_status_breakdown
    print_interest_breakdown
    echo -e "${BOLD}  🔴 Top 10 高息债务 (按累计利息排序):${NC}"
    echo ""
    print_top_interest_debts 10
}

run_category_filter() {
    local filtered
    filtered=$(filter_debts)
    local -a f_arr=($filtered)

    print_banner
    echo -e "${BOLD}  📂 类别筛选: ${CYAN}${FILTER_CATEGORY}${NC} (${#f_arr[@]} 条匹配)${NC}"
    echo ""
    if [[ ${#f_arr[@]} -eq 0 ]]; then
        echo -e "  ${YELLOW}  ⚠ 未找到匹配 '${FILTER_CATEGORY}' 类别的债务${NC}"
        echo -e "  ${DIM}  可用类别: infrastructure, security, code-quality, architecture, documentation, performance, operations${NC}"
        echo ""
        return
    fi
    print_debt_table "${f_arr[@]}"
}

run_interest_high() {
    local filtered
    filtered=$(filter_debts)
    local -a f_arr=($filtered)

    print_banner
    echo -e "${BOLD}  ${RED}  🚨 高息债务预警 (CRITICAL + HIGH 利率)${NC}"
    echo -e "${RED}  以下债务正在以高速度累积利息，需要立即关注！${NC}"
    echo ""
    if [[ ${#f_arr[@]} -eq 0 ]]; then
        echo -e "  ${GREEN}  ✅ 无高息债务${NC}"
        echo ""
        return
    fi
    print_debt_table "${f_arr[@]}"

    # 额外显示高息债务的利息明细
    echo -e "${BOLD}  📊 高息债务利息明细:${NC}"
    echo ""
    total_high_principal=0
    total_high_interest=0
    for idx in "${f_arr[@]}"; do
        local principal=${DEBT_PRINCIPALS[$idx]}
        local rate=${DEBT_INTEREST_RATES[$idx]}
        local days=${DEBT_DAYS[$idx]}
        local interest=$(calculate_interest "$principal" "$rate" "$days")
        total_high_principal=$((total_high_principal + principal))
        total_high_interest=$(awk "BEGIN { printf \"%.2f\", $total_high_interest + $interest }")
    done
    echo -e "  ${DIM}  高息债务本金合计: ${total_high_principal}h${NC}"
    echo -e "  ${RED}  高息债务利息合计: ${total_high_interest}h${NC}"
    echo ""
}

run_roi_mode() {
    print_banner
    print_roi_repayment_plan
}

run_summary_mode() {
    print_banner
    print_summary_panel

    # 紧凑的状态一览
    echo -e "${BOLD}  快速状态一览:${NC}"
    printf "  "
    for status in OPEN IN_PROGRESS BLOCKED DONE ARCHIVED; do
        local count=${STATUS_COUNT[$status]:-0}
        if [[ $count -gt 0 ]]; then
            local s_color=$(get_status_color "$status")
            printf "${s_color}%s:%d${NC}  " "$status" "$count"
        fi
    done
    echo -e "\n"

    # P0/P1预警
    echo -e "${BOLD}  关键债务 (P0/P1):${NC}"
    local critical_found=false
    for i in "${!DEBT_IDS[@]}"; do
        local priority=${DEBT_PRIORITIES[$i]}
        if [[ "$priority" == "P0" || "$priority" == "P1" ]]; then
            local id=${DEBT_IDS[$i]}
            local desc="${DEBT_DESCRIPTIONS[$i]}"
            if [[ ${#desc} -gt 55 ]]; then desc="${desc:52}..."; fi
            local p_color=$(get_priority_color "$priority")
            local s_color=$(get_status_color "${DEBT_STATUSES[$i]}")
            echo -e "    ${p_color}${priority}${NC} ${id} ${s_color}${DEBT_STATUSES[$i]}${NC} — ${desc}"
            critical_found=true
        fi
    done
    if [[ "$critical_found" != "true" ]]; then
        echo -e "    ${GREEN}✅ 无P0/P1级别债务${NC}"
    fi
    echo ""
}

run_blocked_mode() {
    local filtered
    filtered=$(filter_debts)
    local -a f_arr=($filtered)

    print_banner
    echo -e "${MAGENTA}  🚧 被阻塞的债务 (BLOCKED) — 需要外部依赖解除${NC}"
    echo ""
    if [[ ${#f_arr[@]} -eq 0 ]]; then
        echo -e "  ${GREEN}  ✅ 无被阻塞的债务${NC}"
        echo ""
        return
    fi

    for idx in "${f_arr[@]}"; do
        local id=${DEBT_IDS[$idx]}
        local desc="${DEBT_DESCRIPTIONS[$idx]}
        local component=${DEBT_COMPONENTS[$idx]}
        local days=${DEBT_DAYS[$idx]}

        echo -e "${BOLD}  ┌─ ${id} (阻塞 ${days} 天)${NC}"
        echo -e "  │ ${BOLD}组件:${NC}   ${component}"
        echo -e "  │ ${BOLD}描述:${NC}   ${desc}"
        echo -e "  │ ${BOLD}建议:${NC}   在Sprint Planning中跟踪解除依赖的条件"
        echo -e "  └─────────────────────────────────────────────────────"
        echo ""
    done
}

run_report_mode() {
    print_banner
    print_summary_panel
    print_category_breakdown
    print_status_breakdown

    # 周报特有: 变化趋势提示
    echo -e "${BOLD}  📋 周报附录:${NC}"
    echo -e "  ${DIM}  ┌────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "  ${DIM}  │ 上周行动项回顾:                                                │${NC}"
    echo -e "  ${DIM}  │   [ ] DEBT-004 PostgreSQL密码修改 — 进行中(IN_PROGRESS)         │${NC}"
    echo -e "  ${DIM}  │   [ ] DEBT-013 日志格式统一 — 进行中(IN_PROGRESS)               │${NC}"
    echo -e "  ${DIM}  │   [ ] DEBT-023 索引策略文档化 — 进行中(IN_PROGRESS)             │${NC}"
    echo -e "  ${DIM}  ├────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "  ${DIM}  │ 本周建议聚焦:                                                  │${NC}"
    echo -e "  ${DIM}  │   1. 完成DEBT-004 PG密码修改 (预计2h)                          │${NC}"
    echo -e "  ${DIM}  │   2. 启动DEBT-002 Redis密码配置 (预计3h)                       │${NC}"
    echo -e "  ${DIM}  │   3. 开始DEBT-007 SMTP密码外部化 (预计4h)                      │${NC}"
    echo -e "  ${DIM}  │   4. 配置git-secrets pre-commit hook (DEBT-011, 预计3h)        │${NC}"
    echo -e "  ${DIM}  ├────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "  ${DIM}  │ 风险升级:                                                      │${NC}"
    echo -e "  ${DIM}  │   ⚠ DEBT-007/008/009 为安全漏洞, 建议升级至CTO审批           │${NC}"
    echo -e "  ${DIM}  │   ⚠ DEBT-001 SSL证书阻塞生产上线, 需要Phase L资源承诺         │${NC}"
    echo -e "  ${DIM}  └────────────────────────────────────────────────────────────────┘${NC}"
    echo ""

    # ROI快速参考
    echo -e "${BOLD}  📈 本周偿还建议 (Top 5 by ROI):${NC}"
    echo ""
    print_top_interest_debts 5
}

# ── 入口点 ─────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"

    # 加载数据
    load_embedded_data
    load_register_file || true  # MD文件可选, 不存在则用embedded data

    # 计算全局统计
    compute_statistics

    # JSON模式特殊处理 (跳过banner等装饰)
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        output_json
        return
    fi

    # 根据模式分发
    case "$MODE" in
        full)       run_full_report ;;
        category)   run_category_filter ;;
        interest-high) run_interest_high ;;
        roi)        run_roi_mode ;;
        summary)    run_summary_mode ;;
        blocked)    run_blocked_mode ;;
        report)     run_report_mode ;;
        *)
            echo -e "${RED}[ERROR] Unknown mode: $MODE${NC}"
            exit 1
            ;;
    esac

    # 页脚
    echo -e "${DIM}  ─────────────────────────────────────────────────────────────────${NC}"
    echo -e "${DIM}  O08 Technical Debt Analyzer | GlobalReach V2.0 | 非零退出码=异常${NC}"
    echo ""
}

# 执行
main "$@"
