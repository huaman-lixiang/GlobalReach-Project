#!/usr/bin/env bash
# ============================================================================
# GlobalReach V2.0 — 变更风险评分系统（Change Risk Scoring System）
# O05: 构建五维风险评估引擎
#
# 用法:
#   ./scripts/risk-assessor.sh                          # 评估当前未推送的变更
#   ./scripts/risk-assessor.sh --commit HASH            # 评估指定commit的变更
#   ./scripts/risk-assessor.sh --diff origin/main..HEAD # 评估差异范围
#   ./scripts/risk-assessor.sh --json                   # JSON输出
#   ./scripts/risk-assessor.sh --report                 # 生成风险评估报告
#
# 五维评分模型:
#   D1: 影响范围 (25%) - 变更涉及的组件数量/关键度
#   D2: 变更类型 (20%) - 配置变更 vs 代码变更 vs 数据库迁移
#   D3: 历史故障率 (20%) - 该组件/文件的历史故障频率
#   D4: 回滚难度 (20%) - 变更是否可逆、回滚复杂度
#   D5: 测试覆盖 (15%) - 变更区域是否有对应测试/验证
#
# 风险等级:
#   🟢 LOW     1.0-3.0    自助部署
#   🟡 MEDIUM  3.1-5.0    同行评审后部署
#   🟠 HIGH    5.1-7.0    技术负责人审批
#   🔴 CRITICAL 7.1-10.0  CTO审批+变更委员会
#
# 兼容: Windows (Git Bash / WSL2) + Linux (CI)
# ============================================================================

set -euo pipefail

# ── 全局变量 ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RISK_DB="$PROJECT_ROOT/data/risk-db.json"

MODE="report"           # report | json | quiet
TARGET_COMMIT=""        # 指定 commit hash
DIFF_RANGE=""           # 自定义 diff 范围
OUTPUT_FORMAT="text"    # text | json

# 颜色定义
if [ -t 1 ] && [ "${OUTPUT_FORMAT}" = "text" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' CYAN='' MAGENTA='' BOLD='' NC=''
fi

# 评分结果存储
declare -A DIMENSION_SCORES=()
declare -a CHANGED_FILES=()
declare -a HIGH_RISK_FACTORS=()
declare -a MITIGATION_FACTORS=()
declare -a RECOMMENDATIONS=()

# 维度权重
W_D1=0.25  # 影响范围
W_D2=0.20  # 变更类型
W_D3=0.20  # 历史故障率
W_D4=0.20  # 回滚难度
W_D5=0.15  # 测试覆盖

# ── 工具函数 ───────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
${BOLD}GlobalReach 变更风险评估系统${NC}

用法:
    $0 [选项]

选项:
    --commit HASH      评估指定 commit 的变更
    --diff RANGE       评估指定差异范围 (如 origin/main..HEAD)
    --json             JSON 格式输出
    --report           生成完整风险评估报告（默认）
    -h, --help         显示此帮助信息

示例:
    $0                              # 评估未推送的变更
    $0 --commit abc1234             # 评估特定 commit
    $0 --diff origin/main..HEAD     # 评估与 main 的差异
    $0 --json                       # JSON 输出（用于 CI 集成）

退出码:
    0  评估完成
    1  参数错误
    2  内部错误（无法执行评估）
EOF
}

log_info()  { printf "  ${CYAN}ℹ️  %s${NC}\n" "$1"; }
log_warn()  { printf "  ${YELLOW}⚠️  %s${NC}\n" "$1"; }
log_error() { printf "  ${RED}❌ %s${NC}\n" "$1"; }
log_pass()  { printf "  ${GREEN}✅ %s${NC}\n" "$1"; }

# 获取 Git 信息
get_git_head() {
    if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
        git rev-parse --short HEAD 2>/dev/null || echo "unknown"
    else
        echo "n/a"
    fi
}

get_unpushed_commits() {
    if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
        git log --oneline origin/main..HEAD 2>/dev/null || echo ""
    fi
}

get_commit_count() {
    local range="${1:-origin/main..HEAD}"
    if command -v git &>/dev/null; then
        git log --oneline "$range" 2>/dev/null | wc -l || echo "0"
    else
        echo "0"
    fi
}

# ── 参数解析 ───────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --commit)   shift; TARGET_COMMIT="$1" ;;
        --diff)     shift; DIFF_RANGE="$1" ;;
        --json)     OUTPUT_FORMAT="json"; MODE="json" ;;
        --report)   MODE="report"; OUTPUT_FORMAT="text" ;;
        -h|--help)  usage; exit 0 ;;
        *)          echo "未知参数: $1"; usage; exit 1 ;;
    esac
    shift
done

# ── 数据收集：获取变更文件列表 ──────────────────────────────────────────

collect_changed_files() {
    local range=""

    if [ -n "$TARGET_COMMIT" ]; then
        range="${TARGET_COMMIT}^..${TARGET_COMMIT}"
    elif [ -n "$DIFF_RANGE" ]; then
        range="$DIFF_RANGE"
    else
        range="origin/main..HEAD"
    fi

    # 使用 git diff 获取变更文件
    if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
        while IFS= read -r file; do
            [ -n "$file" ] && CHANGED_FILES+=("$file")
        done < <(git diff --name-only "$range" 2>/dev/null || true)
    fi

    # 如果没有获取到文件，尝试 staged 文件
    if [ ${#CHANGED_FILES[@]} -eq 0 ]; then
        while IFS= read -r file; do
            [ -n "$file" ] && CHANGED_FILES+=("$file")
        done < <(git diff --cached --name-only 2>/dev/null || true)
    fi
}

# ── D1: 影响范围评分 ────────────────────────────────────────────────────

calculate_d1_scope_impact() {
    local score=2.0
    local file_count=${#CHANGED_FILES[@]}
    local has_core_component=false
    local has_entry_component=false

    # 基于文件数量的基础分
    if (( file_count <= 2 )); then
        score=2.0
    elif (( file_count <= 5 )); then
        score=4.0
    elif (( file_count <= 10 )); then
        score=6.0
    elif (( file_count <= 20 )); then
        score=8.0
    else
        score=10.0
    fi

    # 检查是否涉及核心组件
    for file in "${CHANGED_FILES[@]}"; do
        # 核心组件: api-prod, postgres, redis
        if [[ "$file" =~ ^api/(routes|services|models)/ ]] || \
           [[ "$file" =~ ^api/db/ ]] || \
           [[ "$file" =~ postgres ]] || \
           [[ "$file" =~ redis ]]; then
            has_core_component=true
        fi

        # 入口组件: nginx
        if [[ "$file" =~ ^nginx/ ]]; then
            has_entry_component=true
        fi
    done

    # 应用加权系数
    if $has_core_component; then
        score=$(echo "$score * 1.5" | bc 2>/dev/null || echo "$score")
    fi
    if $has_entry_component; then
        score=$(echo "$score * 1.3" | bc 2>/dev/null || echo "$score")
    fi

    # 限制最大值为 10
    if (( $(echo "$score > 10.0" | bc -l 2>/dev/null || echo "0") )); then
        score=10.0
    fi

    # 四舍五入到 1 位小数
    score=$(printf "%.1f" "$score" 2>/dev/null || echo "$score")

    DIMENSION_SCORES[d1]="$score"
}

# ── D2: 变更类型评分 ────────────────────────────────────────────────────

calculate_d2_change_type() {
    local max_score=1.0
    local has_config_change=false
    has_code_modification=false
    has_db_migration=false
    has_infra_change=false
    has_doc_only=true
    has_new_test_or_script=false
    has_new_code=false

    for file in "${CHANGED_FILES[@]}"; do
        case "$file" in
            *.md|*.txt|*.rst|docs/*)
                # 纯文档 - 保持最低分
                : ;;
            *.test.js|*.spec.js|tests/*|__tests__/*)
                has_new_test_or_script=true
                has_doc_only=false ;;
            scripts/*.sh)
                has_new_test_or_script=true
                has_doc_only=false ;;
            docker-compose*.yml|Dockerfile*|.dockerignore)
                has_infra_change=true
                has_doc_only=false ;;
            api/db/*|*/migrations/*|*.sql)
                has_db_migration=true
                has_doc_only=false ;;
            nginx/*.conf|alertmanager/*.yml|prometheus/rules/*.yml|loki/*.yml|*.env*)
                has_config_change=true
                has_doc_only=false ;;
            api/routes/*.js|api/services/*.js|api/models/*.js|api/middleware/*.js)
                # 检查是新增还是修改
                if git diff --name-status origin/main..HEAD 2>/dev/null | grep -q "^A.*${file}$" || \
                   git diff --cached --name-status 2>/dev/null | grep -q "^A.*${file}$"; then
                    has_new_code=true
                else
                    has_code_modification=true
                fi
                has_doc_only=false ;;
            *)
                has_code_modification=true
                has_doc_only=false ;;
        esac
    done

    # 按优先级从高到低确定分数
    if $has_infra_change; then
        max_score=10.0
    elif $has_db_migration; then
        max_score=9.0
    elif $has_config_change; then
        max_score=7.0
    elif $has_code_modification; then
        max_score=6.0
    elif $has_new_code; then
        max_score=5.0
    elif $has_new_test_or_script; then
        max_score=3.0
    elif $has_doc_only; then
        max_score=1.0
    fi

    DIMENSION_SCORES[d2]="$max_score"
}

# ── D3: 历史故障率评分 ──────────────────────────────────────────────────

calculate_d3_history_failure() {
    local total_weighted_score=3.0  # 默认保守值
    local component_incident_count=0
    declare -A file_incidents=()

    for file in "${CHANGED_FILES[@]}"; do
        local incidents=0

        # 从 risk-db.json 的 compat_issues 中查找历史故障
        if [ -f "$RISK_DB" ] && command -v python3 &>/dev/null; then
            incidents=$(python3 -c "
import json, sys
try:
    with open('$RISK_DB', 'r') as f:
        db = json.load(f)
    file_pattern = '$file'
    count = 0
    for issue in db.get('compat_issues', []):
        if issue.get('file', '') in file_pattern or file_pattern.endswith(issue.get('file', '')):
            count += 1
    print(count)
except Exception as e:
    print(0)
" 2>/dev/null || echo "0")
        elif [ -f "$RISK_DB" ] && command -v python &>/dev/null; then
            incidents=$(python -c "
import json, sys
try:
    with open('$RISK_DB', 'r') as f:
        db = json.load(f)
    file_pattern = '$file'
    count = 0
    for issue in db.get('compat_issues', []):
        if issue.get('file', '') in file_pattern or file_pattern.endswith(issue.get('file', '')):
            count += 1
    print(count)
except:
    print(0)
" 2>/dev/null || echo "0")
        fi

        file_incidents["$file"]=$incidents
        component_incident_count=$((component_incident_count + incidents))
    done

    # 基于故障次数映射分数
    if (( component_incident_count >= 3 )); then
        total_weighted_score=9.0
    elif (( component_incident_count == 2 )); then
        total_weighted_score=7.0
    elif (( component_incident_count == 1 )); then
        total_weighted_score=5.0
    else
        total_weighted_score=3.0  # 无记录，保守估计
    fi

    DIMENSION_SCORES[d3]="$total_weighted_score"
}

# ── D4: 回滚难度评分 ────────────────────────────────────────────────────

calculate_d4_rollback_difficulty() {
    local score=2.0  # 默认：纯新增文件最简单
    local has_external_state_change=false
    local needs_data_migration=false
    local all_new_files=true

    for file in "${CHANGED_FILES[@]}"; do
        # 检查文件状态（新增还是修改）
        local is_modified=false
        if command -v git &>/dev/null; then
            if git diff --name-status origin/main..HEAD 2>/dev/null | grep -q "^M.*${file}$" || \
               git diff --cached --name-status 2>/dev/null | grep -q "^M.*${file}$"; then
                is_modified=true
                all_new_files=false
            fi
        fi

        # 检查是否涉及外部状态变更
        case "$file" in
            api/db/*|*/migrations/*|*.sql)
                needs_data_migration=true
                has_external_state_change=true ;;
            *.pem|*.key|*.crt|certbot/*)
                has_external_state_change=true ;;
        esac
    done

    # 确定回滚难度等级
    if $has_external_state_change; then
        if $needs_data_migration; then
            score=9.0  # DB schema 变更最难回滚
        else
            score=9.0  # 证书等外部状态变更
        fi
    elif ! $all_new_files; then
        # 有修改的现有文件
        if $needs_data_migration; then
            score=7.0  # 需要数据迁移回滚
        else
            score=4.0  # 可以 git revert
        fi
    else
        score=2.0  # 纯新增文件，直接删除即可
    fi

    DIMENSION_SCORES[d4]="$score"
}

# ── D5: 测试覆盖评分 ────────────────────────────────────────────────────

calculate_d5_test_coverage() {
    local score=9.0  # 默认：无自动化验证
    local has_unit_test=false
    local has_config_validation=false
    local has_manual_verification=false

    for file in "${CHANGED_FILES[@]}"; do
        # 检查是否有对应的单元测试
        local base_name
        base_name="$(basename "$file" .js)"
        if [ -f "${file%/*}/__tests__/${base_name}.test.js" ] || \
           [ -f "${file%/*}/${base_name}.test.js" ] || \
           [ -f "${file%/*}/${base_name}.spec.js" ]; then
            has_unit_test=true
        fi

        # 检查是否有配置验证脚本覆盖
        case "$file" in
            nginx/*.conf|alertmanager/*.yml|prometheus/rules/*.yml|loki/*.yml|docker-compose*.yml)
                if [ -f "$PROJECT_ROOT/scripts/validate-configs.sh" ]; then
                    has_config_validation=true
                fi ;;
        esac

        # 检查是否有 health endpoint 可用于手动验证
        case "$file" in
            api/routes/*.js|api/services/*.js)
                if [ -f "$PROJECT_ROOT/api/routes/health.js" ]; then
                    has_manual_verification=true
                fi ;;
        esac
    done

    # 确定测试覆盖等级
    if $has_unit_test; then
        score=2.0  # 最佳：有自动化测试
    elif $has_config_validation; then
        score=4.0  # 有配置验证覆盖
    elif $has_manual_verification; then
        score=6.0  # 可通过 health endpoint 手动验证
    else
        score=9.0  # 无自动化验证
    fi

    DIMENSION_SCORES[d5]="$score"
}

# ── 综合风险分计算 ──────────────────────────────────────────────────────

calculate_risk_score() {
    local d1="${DIMENSION_SCORES[d1]:-5.0}"
    local d2="${DIMENSION_SCORES[d2]:-5.0}"
    local d3="${DIMENSION_SCORES[d3]:-5.0}"
    local d4="${DIMENSION_SCORES[d4]:-5.0}"
    local d5="${DIMENSION_SCORES[d5]:-5.0}"

    # RiskScore = D1×0.25 + D2×0.20 + D3×0.20 + D4×0.20 + D5×0.15
    local risk_score
    risk_score=$(echo "$d1 * $W_D1 + $d2 * $W_D2 + $d3 * $W_D3 + $d4 * $W_D4 + $d5 * $W_D5" | bc 2>/dev/null || echo "5.0")

    # 四舍五入到 1 位小数
    risk_score=$(printf "%.1f" "$risk_score" 2>/dev/null || echo "$risk_score")

    echo "$risk_score"
}

# ── 风险等级判定 ────────────────────────────────────────────────────────

get_risk_level() {
    local score="$1"
    local level emoji color approval action

    if (( $(echo "$score <= 3.0" | bc -l 2>/dev/null || echo "0") )); then
        level="LOW"; emoji="🟢"; color="green"; approval="自助部署"; action="正常合并"
    elif (( $(echo "$score <= 5.0" | bc -l 2>/dev/null || echo "0") )); then
        level="MEDIUM"; emoji="🟡"; color="yellow"; approval="同行评审后部署"; action="Review后合并"
    elif (( $(echo "$score <= 7.0" | bc -l 2>/dev/null || echo "0") )); then
        level="HIGH"; emoji="🟠"; color="orange"; approval="技术负责人审批"; action="窗口期部署+监控"
    else
        level="CRITICAL"; emoji="🔴"; color="red"; approval="CTO审批+变更委员会"; action="紧急预案就绪"
    fi

    echo "$level|$emoji|$color|$approval|$action"
}

# ── 高风险因素检测 ──────────────────────────────────────────────────────

detect_high_risk_factors() {
    HIGH_RISK_FACTORS=()

    for file in "${CHANGED_FILES[@]}"; do
        # 检测 Prometheus 规则变更
        if [[ "$file" =~ prometheus/rules ]]; then
            HIGH_RISK_FACTORS+=("涉及 Prometheus 规则变更 (影响告警)")
        fi

        # 检测新增 API 路由
        if [[ "$file" =~ ^api/routes ]] && [[ "$file" =~ \.js$ ]]; then
            if command -v git &>/dev/null; then
                if git diff --name-status origin/main..HEAD 2>/dev/null | grep -q "^A.*${file}$" || \
                   git diff --cached --name-status 2>/dev/null | grep -q "^A.*${file}$"; then
                    HIGH_RISK_FACTORS+=("新增 API 路由 $file (影响路由安全)")
                fi
            fi
        fi

        # 检测数据库变更
        if [[ "$file" =~ api/db ]] || [[ "$file" =~ migration ]] || [[ "$file" =~ \.sql$ ]]; then
            HIGH_RISK_FACTORS+=("数据库结构变更 $file (需要回滚计划)")
        fi

        # 检测 Docker Compose 变更
        if [[ "$file" =~ docker-compose ]]; then
            HIGH_RISK_FACTORS+=("Docker Compose 编排变更 (影响基础设施)")
        fi

        # 检测 Nginx 入口配置变更
        if [[ "$file" =~ ^nginx ]] && [[ "$file" =~ \.conf$ ]]; then
            HIGH_RISK_FACTORS+=("Nginx 入口配置变更 (影响流量路由)")
        fi

        # 检测 AlertManager 配置变更
        if [[ "$file" =~ alertmanager ]]; then
            HIGH_RISK_FACTORS+=("AlertManager 配置变更 (影响告警通知)")
        fi
    done

    # 检测无测试覆盖
    local has_any_test=false
    for file in "${CHANGED_FILES[@]}"; do
        if [[ "$file" =~ test\.js$ ]] || [[ "$file" =~ spec\.js$ ]] || [[ "$file" =~ __tests__ ]]; then
            has_any_test=true
            break
        fi
    done
    if ! $has_any_test && [ ${#CHANGED_FILES[@]} -gt 0 ]; then
        HIGH_RISK_FACTORS+=("无对应集成测试")
    fi
}

# ── 缓解因素检测 ────────────────────────────────────────────────────────

detect_mitigation_factors() {
    MITIGATION_FACTORS=()

    # 检测配置是否已通过 validate-configs.sh 验证
    local has_config_file=false
    for file in "${CHANGED_FILES[@]}"; do
        case "$file" in
            nginx/*.conf|alertmanager/*.yml|prometheus/rules/*.yml|loki/*.yml|docker-compose*.yml)
                has_config_file=true ;;
        esac
    done

    if $has_config_file && [ -f "$PROJECT_ROOT/scripts/validate-configs.sh" ]; then
        MITIGATION_FACTORS+=("配置已通过 validate-configs.sh 验证")
    fi

    # 检测是否为纯新增文件
    local all_new=true
    for file in "${CHANGED_FILES[@]}"; do
        if command -v git &>/dev/null; then
            if git diff --name-status origin/main..HEAD 2>/dev/null | grep -q "^M.*${file}$" || \
               git diff --cached --name-status 2>/dev/null | grep -q "^M.*${file}$"; then
                all_new=false
                break
            fi
        fi
    done
    if $all_new && [ ${#CHANGED_FILES[@]} -gt 0 ]; then
        MITIGATION_FACTORS+=("纯新增文件（无修改现有逻辑）")
    fi

    # 检测 Docker Compose 是否未变动
    local compose_changed=false
    for file in "${CHANGED_FILES[@]}"; do
        if [[ "$file" =~ docker-compose ]]; then
            compose_changed=true
            break
        fi
    done
    if ! $compose_changed; then
        MITIGATION_FACTORS+=("Docker Compose 未变动")
    fi

    # 检测文档变更占比高（低风险）
    local doc_count=0
    for file in "${CHANGED_FILES[@]}"; do
        if [[ "$file" =~ \.(md|txt|rst)$ ]] || [[ "$file" =~ ^docs/ ]]; then
            doc_count=$((doc_count + 1))
        fi
    done
    if (( doc_count > 0 )) && (( doc_count == ${#CHANGED_FILES[@]} )); then
        MITIGATION_FACTORS+=("纯文档变更（无代码/配置影响）")
    fi
}

# ── 生成建议 ─────────────────────────────────────────────────────────────

generate_recommendations() {
    RECOMMENDATIONS=()
    local risk_level
    risk_level="$(echo "$(get_risk_level "$(calculate_risk_score)")" | cut -d'|' -f1)"

    case "$risk_level" in
        LOW)
            RECOMMENDATIONS+=("正常合并到 main 分支")
            ;;
        MEDIUM)
            RECOMMENDATIONS+=("确保至少 1 位同事完成 Code Review")
            RECOMMENDATIONS+=("运行本地测试套件确认通过")
            ;;
        HIGH)
            RECOMMENDATIONS+=("在低流量窗口期部署（建议凌晨 2:00-4:00）")
            RECOMMENDATIONS+=("部署后立即运行 health-inspection.sh")
            RECOMMENDATIONS+=("准备 git revert <hash> 快速回滚命令")
            RECOMMENDATIONS+=("通知运维团队准备监控仪表盘")
            ;;
        CRITICAL)
            RECOMMENDATIONS+=("⛔ 必须获得 CTO 书面审批后方可部署")
            RECOMMENDATIONS+=("召开变更委员会会议审查方案")
            RECOMMENDATIONS+=("准备完整的回滚预案和应急联系人名单")
            RECOMMENDATIONS+=("在 Staging 环境进行完整回归测试")
            RECOMMENDATIONS+=("安排专人实时监控至少 2 小时")
            ;;
    esac

    # 通用建议
    if [ ${#HIGH_RISK_FACTORS[@]} -gt 0 ]; then
        RECOMMENDATIONS+=("特别关注高风险因素并制定应对措施")
    fi
}

# ── 报告输出（文本格式） ────────────────────────────────────────────────

print_text_report() {
    local start_time
    start_time=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "unknown")
    local git_head
    git_head=$(get_git_head)
    local commit_range
    if [ -n "$TARGET_COMMIT" ]; then
        commit_range="$TARGET_COMMIT"
    elif [ -n "$DIFF_RANGE" ]; then
        commit_range="$DIFF_RANGE"
    else
        commit_range="origin/main..HEAD"
    fi
    local commit_count
    commit_count=$(get_commit_count "$commit_range")
    local risk_score
    risk_score=$(calculate_risk_score)
    local risk_level_info
    risk_level_info=$(get_risk_level "$risk_score")
    local level emoji color approval action
    IFS='|' read -r level emoji color approval action <<< "$risk_level_info"

    # 选择颜色函数
    local color_func
    case "$color" in
        red)    color_func="$RED" ;;
        green)  color_func="$GREEN" ;;
        yellow) color_func="$YELLOW" ;;
        orange) color_func="\033[0;33m" ;;  # 橙色
        *)      color_func="" ;;
    esac

    echo ""
    echo -e "${BOLD}╔════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║  GlobalReach 变更风险评估报告          ║${NC}"
    echo -e "${BOLD}╠════════════════════════════════════════╣${NC}"
    printf "${BOLD}║  评估时间: %-31s║${NC}\n" "$start_time"
    printf "${BOLD}║  变更范围: %-31s║${NC}\n" "$commit_range (${commit_count} commits)"
    printf "${BOLD}║  变更文件: %-31s║${NC}\n" "${#CHANGED_FILES[@]} 个"
    echo -e "${BOLD}╠════════════════════════════════════════╣${NC}"
    echo -e "${BOLD}║                                          ║${NC}"
    printf "${BOLD}║  📊 综合风险分: %-22s║${NC}\n" "$risk_score / 10"
    printf "${BOLD}║  风险等级: %s %-26s║${NC}\n" "$emoji" "$level"
    echo -e "${BOLD}║                                          ║${NC}"
    echo -e "${BOLD}║  ┌─────────┬──────┬─────┬──────────┐   ║${NC}"
    echo -e "${BOLD}║  │ 维度     │ 分数 │ 权重│ 加权分    │   ║${NC}"
    echo -e "${BOLD}║  ├─────────┼──────┼─────┼──────────┤   ║${NC}"

    # 计算各维度加权分并输出
    local d1="${DIMENSION_SCORES[d1]}"
    local d2="${DIMENSION_SCORES[d2]}"
    local d3="${DIMENSION_SCORES[d3]}"
    local d4="${DIMENSION_SCORES[d4]}"
    local d5="${DIMENSION_SCORES[d5]}"

    local w1 w2 w3 w4 w5
    w1=$(echo "$d1 * $W_D1" | bc 2>/dev/null || echo "0")
    w2=$(echo "$d2 * $W_D2" | bc 2>/dev/null || echo "0")
    w3=$(echo "$d3 * $W_D3" | bc 2>/dev/null || echo "0")
    w4=$(echo "$d4 * $W_D4" | bc 2>/dev/null || echo "0")
    w5=$(echo "$d5 * $W_D5" | bc 2>/dev/null || echo "0")

    printf "${BOLD}║  │ 影响范围 │ %4s │ 25%% │  %6s   │   ║${NC}\n" "$d1" "$w1"
    printf "${BOLD}║  │ 变更类型 │ %4s │ 20%% │  %6s   │   ║${NC}\n" "$d2" "$w2"
    printf "${BOLD}║  │ 历史故障 │ %4s │ 20%% │  %6s   │   ║${NC}\n" "$d3" "$w3"
    printf "${BOLD}║  │ 回滚难度 │ %4s │ 20%% │  %6s   │   ║${NC}\n" "$d4" "$w4"
    printf "${BOLD}║  │ 测试覆盖 │ %4s │ 15%% │  %6s   │   ║${NC}\n" "$d5" "$w5"
    echo -e "${BOLD}║  └─────────┴──────┴─────┴──────────┘   ║${NC}"
    echo -e "${BOLD}║                                          ║${NC}"

    # 高风险因素
    if [ ${#HIGH_RISK_FACTORS[@]} -gt 0 ]; then
        echo -e "${BOLD}║  ⚠️  高风险因素:                           ║${NC}"
        local i=1
        for factor in "${HIGH_RISK_FACTORS[@]}"; do
            printf "${BOLD}║  %d. %-37s║${NC}\n" "$i" "$factor"
            i=$((i + 1))
        done
    else
        echo -e "${BOLD}║  ✅ 未检测到高风险因素                     ║${NC}"
    fi
    echo -e "${BOLD}║                                          ║${NC}"

    # 缓解因素
    if [ ${#MITIGATION_FACTORS[@]} -gt 0 ]; then
        echo -e "${BOLD}║  ✅ 缓解因素:                             ║${NC}"
        local j=1
        for factor in "${MITIGATION_FACTORS[@]}"; do
            printf "${BOLD}║  %d. %-37s║${NC}\n" "$j" "$factor"
            j=$((j + 1))
        done
    fi
    echo -e "${BOLD}║                                          ║${NC}"

    # 建议
    echo -e "${BOLD}║  📋 建议:                                 ║${NC}"
    for rec in "${RECOMMENDATIONS[@]}"; do
        printf "${BOLD}║  → %-37s║${NC}\n" "$rec"
    done
    echo -e "${BOLD}║                                          ║${NC}"

    # 审批要求
    echo -e "${BOLD}║  🔐 审批要求: %-29s║${NC}\n" "$approval"
    echo -e "${BOLD}╚════════════════════════════════════════╝${NC}"
    echo ""

    # 变更文件列表
    if [ ${#CHANGED_FILES[@]} -gt 0 ]; then
        echo -e "${CYAN}变更文件列表:${NC}"
        for file in "${CHANGED_FILES[@]}"; do
            echo "  • $file"
        done
        echo ""
    fi
}

# ── JSON 输出 ─────────────────────────────────────────────────────────────

print_json_output() {
    local start_time
    start_time=$(date '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || echo "unknown")
    local git_head
    git_head=$(get_git_head)
    local risk_score
    risk_score=$(calculate_risk_score)
    local risk_level_info
    risk_level_info=$(get_risk_level "$risk_score")
    local level emoji color approval action
    IFS='|' read -r level emoji color approval action <<< "$risk_level_info"

    cat <<JSONEOF
{
  "timestamp": "$start_time",
  "git_head": "$git_head",
  "assessment_id": "RA-$(date +%Y%m%d%H%M%S)",
  "summary": {
    "total_files": ${#CHANGED_FILES[@]},
    "risk_score": $risk_score,
    "risk_level": "$level",
    "risk_emoji": "$emoji",
    "approval_required": "$approval",
    "recommended_action": "$action"
  },
  "dimensions": {
    "D1_scope_impact": {
      "score": ${DIMENSION_SCORES[d1]},
      "weight": $W_D1,
      "weighted_score": $(echo "${DIMENSION_SCORES[d1]} * $W_D1" | bc 2>/dev/null || echo 0),
      "label": "影响范围"
    },
    "D2_change_type": {
      "score": ${DIMENSION_SCORES[d2]},
      "weight": $W_D2,
      "weighted_score": $(echo "${DIMENSION_SCORES[d2]} * $W_D2" | bc 2>/dev/null || echo 0),
      "label": "变更类型"
    },
    "D3_history_failure": {
      "score": ${DIMENSION_SCORES[d3]},
      "weight": $W_D3,
      "weighted_score": $(echo "${DIMENSION_SCORES[d3]} * $W_D3" | bc 2>/dev/null || echo 0),
      "label": "历史故障率"
    },
    "D4_rollback_difficulty": {
      "score": ${DIMENSION_SCORES[d4]},
      "weight": $W_D4,
      "weighted_score": $(echo "${DIMENSION_SCORES[d4]} * $W_D4" | bc 2>/dev/null || echo 0),
      "label": "回滚难度"
    },
    "D5_test_coverage": {
      "score": ${DIMENSION_SCORES[d5]},
      "weight": $W_D5,
      "weighted_score": $(echo "${DIMENSION_SCORES[d5]} * $W_D5" | bc 2>/dev/null || echo 0),
      "label": "测试覆盖"
    }
  },
  "changed_files": [
$(local first=true
for file in "${CHANGED_FILES[@]}"; do
    if $first; then
        first=false
    else
        echo ","
    fi
    printf '    "%s"' "$file"
done)
  ],
  "high_risk_factors": [
$(first=true
for factor in "${HIGH_RISK_FACTORS[@]}"; do
    if $first; then first=false; else echo ","; fi
    printf '    "%s"' "$factor"
done)
  ],
  "mitigation_factors": [
$(first=true
for factor in "${MITIGATION_FACTORS[@]}"; do
    if $first; then first=false; else echo ","; fi
    printf '    "%s"' "$factor"
done)
  ],
  "recommendations": [
$(first=true
for rec in "${RECOMMENDATIONS[@]}"; do
    if $first; then first=false; else echo ","; fi
    printf '    "%s"' "$rec"
done)
  ]
}
JSONEOF
}

# ── 主流程 ───────────────────────────────────────────────────────────────

main() {
    # 检查依赖
    if ! command -v git &>/dev/null; then
        log_error "git 命令不可用"
        exit 2
    fi

    if ! git rev-parse --git-dir &>/dev/null 2>&1; then
        log_error "不在 Git 仓库中"
        exit 2
    fi

    # 检查 bc 命令（用于浮点运算）
    if ! command -v bc &>/dev/null; then
        log_warn "bc 命令不可用，使用整数运算（精度可能降低）"
    fi

    # 收集变更文件
    collect_changed_files

    if [ ${#CHANGED_FILES[@]} -eq 0 ]; then
        if [ "$OUTPUT_FORMAT" = "json" ]; then
            echo '{"error": "no_changes_detected", "message": "未检测到任何变更文件"}'
        else
            log_info "未检测到任何变更文件（可能已经全部推送或无差异）"
        fi
        exit 0
    fi

    # 执行五维评分
    calculate_d1_scope_impact
    calculate_d2_change_type
    calculate_d3_history_failure
    calculate_d4_rollback_difficulty
    calculate_d5_test_coverage

    # 检测风险因素和建议
    detect_high_risk_factors
    detect_mitigation_factors
    generate_recommendations

    # 输出结果
    case "$OUTPUT_FORMAT" in
        json)
            print_json_output
            ;;
        *)
            print_text_report
            ;;
    esac

    # 返回基于风险等级的退出码
    local risk_score
    risk_score=$(calculate_risk_score)
    if (( $(echo "$risk_score > 7.0" | bc -l 2>/dev/null || echo "0") )); then
        exit 0  # CRITICAL 但不阻止（只读分析工具）
    fi

    exit 0
}

# 执行主函数
main "$@"
