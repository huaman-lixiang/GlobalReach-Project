#!/bin/bash
# ============================================================================
# GlobalReach V2.0 — 性能基准测试一键运行脚本
# N06: Performance Benchmark Suite Runner
#
# 用法:
#   ./scripts/run-benchmark.sh [选项]
#
# 选项:
#   --scenario=<name>    测试场景: smoke|load|stress|spike|endpoints|auth-flow|email-pipeline|all (默认: smoke)
#   --vus=<number>       覆盖默认并发用户数
#   --duration=<time>    覆盖默认持续时间 (如: 30s, 2m, 5m)
#   --output=<format>    输出格式: json|prometheus|both (默认: json)
#   --base-url=<url>     API 基础 URL (默认: http://localhost:3000)
#   --env-file=<path>    环境变量文件路径
#   --no-precheck        跳过环境预检
#   --html-report        生成 HTML 报告 (需要 k6-tools)
#   --dry-run             仅显示将要执行的命令，不实际运行
#   --help               显示帮助信息
#
# 示例:
#   ./scripts/run-benchmark.sh                          # 运行冒烟测试
#   ./scripts/run-benchmark.sh --scenario=load           # 运行负载测试
#   ./scripts/run-benchmark.sh --scenario=all --html     # 全套测试 + HTML 报告
#   ./scripts/run-benchmark.sh --scenario=load --vus=100 --duration=5m
# ============================================================================

set -euo pipefail

# ============================================
# 颜色定义
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ============================================
# 默认配置
# ============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PERF_DIR="$PROJECT_ROOT/tests/performance"
RESULTS_DIR="$PROJECT_ROOT/tests/performance/results"

SCENARIO="smoke"
VUS_OVERRIDE=""
DURATION_OVERRIDE=""
OUTPUT_FORMAT="json"
BASE_URL="${BASE_URL:-http://localhost:3000}"
ENV_FILE=""
SKIP_PRECHECK=false
HTML_REPORT=false
DRY_RUN=false
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# k6 可执行文件路径 (优先使用全局安装的)
K6_CMD="${K6_CMD:-k6}"

# ============================================
# 场景配置映射
# ============================================
declare -A SCENARIO_SCRIPTS=(
    ["smoke"]="smoke.js"
    ["load"]="load.js"
    ["stress"]="stress.js"
    ["spike"]="spike.js"
    ["endpoints"]="endpoints.js"
    ["auth-flow"]="auth-flow.js"
    ["email-pipeline"]="email-pipeline.js"
)

declare -A SCENARIO_DESCS=(
    ["smoke"]="冒烟测试 (10VU, 30s, P95<50ms)"
    ["load"]="标准负载 (50VU, 2min, P95<100ms)"
    ["stress"]="压力测试 (200→500VU, 5min, P95<500ms)"
    ["spike"]="突发流量 (10→1000VU, 3min, P95<1000ms)"
    ["endpoints"]="端点基准 (20VU/端点, ~4min)"
    ["auth-flow"]="认证链路 (30VU, 1min, 全链路<400ms)"
    ["email-pipeline"]="邮件流水线 (10VU, 2min, P95<800ms)"
)

# ============================================
# 帮助信息
# ============================================
show_help() {
    cat << EOF
${BOLD}GlobalReach V2.0 — 性能基准测试运行器${NC}

${CYAN}用法:${NC}
    $0 [选项]

${CYAN}场景:${NC}
    ${GREEN}smoke${NC}         冒烟测试 (CI 门控)
    ${GREEN}load${NC}          标准负载测试
    ${GREEN}stress${NC}        压力测试 (阶梯加压)
    ${GREEN}spike${NC}         突发流量测试
    ${GREEN}endpoints${NC}     端点逐一基准
    ${GREEN}auth-flow${NC}     认证全链路测试
    ${GREEN}email-pipeline${NC} 邮件发送流水线
    ${GREEN}all${NC}           运行全部场景

${CYAN}选项:${NC}
    --scenario=<name>     选择测试场景 (默认: smoke)
    --vus=<number>        覆盖并发用户数
    --duration=<time>     覆盖持续时间 (如: 30s, 2m)
    --output=<format>     输出格式: json|prometheus|both
    --base-url=<url>      API 地址 (默认: http://localhost:3000)
    --env-file=<path>     环境变量文件
    --no-precheck         跳过环境预检
    --html-report         生成 HTML 报告
    --dry-run             仅显示命令，不执行
    --help                显示此帮助

${CYAN}示例:${NC}
    $0                                    # 快速冒烟测试
    $0 --scenario=load                   # 标准负载
    $0 --scenario=all --html-report      # 完整套件 + HTML
    $0 --scenario=load --vus=100 --duration=5m  # 自定义参数
EOF
    exit 0
}

# ============================================
# 日志函数
# ============================================
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${BOLD}${BLUE}━━━ $* ━━━${NC}"; }

# ============================================
# 参数解析
# ============================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --scenario=*)
                SCENARIO="${1#*=}"
                ;;
            --vus=*)
                VUS_OVERRIDE="${1#*=}"
                ;;
            --duration=*)
                DURATION_OVERRIDE="${1#*=}"
                ;;
            --output=*)
                OUTPUT_FORMAT="${1#*=}"
                ;;
            --base-url=*)
                BASE_URL="${1#*=}"
                ;;
            --env-file=*)
                ENV_FILE="${1#*=}"
                ;;
            --no-precheck)
                SKIP_PRECHECK=true
                ;;
            --html-report)
                HTML_REPORT=true
                ;;
            --dry-run)
                DRY_RUN=true
                ;;
            --help|-h)
                show_help
                ;;
            *)
                log_error "未知参数: $1"
                show_help
                ;;
        esac
        shift
    done
}

# ============================================
# 环境预检
# ============================================
precheck() {
    log_step "环境预检"

    local errors=0

    # 检查 k6 是否可用
    if ! command -v "$K6_CMD" &>/dev/null; then
        log_error "k6 未找到。请先安装: https://k6.io/docs/getting-started/installation/"
        log_info "或设置 K6_CMD 环境变量指向 k6 二进制路径"
        errors=$((errors + 1))
    else
        local k6_version=$($K6_CMD version 2>/dev/null | head -1 || echo "unknown")
        log_info "k6 版本: $k6_version"
    fi

    # 检查 Docker 是否运行 (如果使用 Docker 化的 API)
    if command -v docker &>/dev/null; then
        if docker info &>/dev/null 2>&1; then
            log_info "Docker: 运行中"
        else
            log_warn "Docker: 未运行 (如果 API 在 Docker 中运行，需要启动 Docker)"
        fi
    else
        log_warn "Docker: 未安装"
    fi

    # 检查 API 可达性
    if [[ "$SKIP_PRECHECK" != "true" ]]; then
        log_info "检查 API 可达性: $BASE_URL ..."
        if curl -sf --max-time 5 "$BASE_URL/api/v1/health/live" > /dev/null 2>&1; then
            log_info "API: ✅ 可达 ($BASE_URL)"
        else
            log_error "API: ❌ 不可达 ($BASE_URL)"
            log_info "请确保 API 服务已启动: cd api && node server.js"
            errors=$((errors + 1))
        fi
    else
        log_info "跳过 API 可达性检查 (--no-precheck)"
    fi

    # 检查性能测试目录
    if [[ -d "$PERF_DIR" ]]; then
        local script_count=$(find "$PERF_DIR" -name "*.js" -not -path "*/lib/*" | wc -l)
        log_info "测试脚本目录: $PERF_DIR ($script_count 个脚本)"
    else
        log_error "测试脚本目录不存在: $PERF_DIR"
        errors=$((errors + 1))
    fi

    # 创建结果目录
    mkdir -p "$RESULTS_DIR"
    log_info "结果目录: $RESULTS_DIR"

    if [[ $errors -gt 0 ]]; then
        log_error "预检发现 $errors 个问题！使用 --no-precheck 强制跳过"
        if [[ "$SKIP_PRECHECK" != "true" ]]; then
            exit 1
        fi
    fi

    log_info "预检通过 ✅"
}

# ============================================
# 加载环境变量
# ============================================
load_env() {
    if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
        log_info "加载环境变量文件: $ENV_FILE"
        set -a
        source "$ENV_FILE"
        set +a
    elif [[ -f "$PROJECT_ROOT/.env.performance" ]]; then
        log_info "加载 .env.performance"
        set -a
        source "$PROJECT_ROOT/.env.performance"
        set +a
    fi

    # 导出关键环境变量供 k6 使用
    export BASE_URL
    export TEST_USER_EMAIL="${TEST_USER_EMAIL:-admin@globalreach.com}"
    export TEST_USER_PASSWORD="${TEST_USER_PASSWORD:-admin123456}"
}

# ============================================
# 构建运行命令
# ============================================
build_k6_command() {
    local script="$1"
    local scenario_name="$2"

    local cmd="$K6_CMD run \"$PERF_DIR/$script\""
    
    # 基础 URL
    cmd="$cmd --no-color"

    # 输出格式
    local summary_file="$RESULTS_DIR/${scenario_name}_${TIMESTAMP}.json"
    cmd="$cmd --summary-export=\"$summary_file\""

    case "$OUTPUT_FORMAT" in
        json)
            cmd="$cmd --out json=\"$RESULTS_DIR/${scenario_name}_${TIMESTAMP}-raw.json\""
            ;;
        prometheus)
            cmd="$cmd --out prometheus-remote-write=http://localhost:9090/api/v1/write"
            cmd="$cmd --out prometheus-remote-write-prefix=globalreach_perf_${scenario_name}"
            ;;
        both)
            cmd="$cmd --out json=\"$RESULTS_DIR/${scenario_name}_${TIMESTAMP}-raw.json\""
            cmd="$cmd --out prometheus-remote-write=http://localhost:9090/api/v1/write"
            ;;
    esac

    # VUs 和 Duration 覆盖
    if [[ -n "$VUS_OVERRIDE" ]]; then
        cmd="$cmd -e OVERRIDDEN_VUS=$VUS_OVERRIDE"
    fi
    if [[ -n "$DURATION_OVERRIDE" ]]; then
        cmd="$cmd -e OVERRIDDEN_DURATION='$DURATION_OVERRIDE'"
    fi

    echo "$cmd"
}

# ============================================
# 执行单个场景
# ============================================
run_scenario() {
    local scenario="$1"
    local script="${SCENARIO_SCRIPTS[$scenario]}"
    local desc="${SCENARIO_DESCS[$scenario]}"

    if [[ -z "$script" ]]; then
        log_error "未知场景: $scenario"
        return 1
    fi

    if [[ ! -f "$PERF_DIR/$script" ]]; then
        log_error "脚本不存在: $PERF_DIR/$script"
        return 1
    fi

    log_step "运行: $desc"

    local cmd=$(build_k6_command "$script" "$scenario")

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] $cmd"
        return 0
    fi

    log_info "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
    local start_time=$(date +%s)

    # 执行 k6 测试
    local exit_code=0
    eval $cmd || exit_code=$?

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log_info "结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
    log_info "耗时: ${duration}s"

    # 结果判定
    if [[ $exit_code -eq 0 ]]; then
        log_info "结果: ✅ PASS — 所有阈值满足"
    elif [[ $exit_code -eq 1 ]]; then
        log_warn "结果: ⚠️ WARN — 部分阈值未通过"
    else
        log_error "结果: ❌ FAIL — 运行错误 (exit code: $exit_code)"
    fi

    return $exit_code
}

# ============================================
# 生成汇总报告
# ============================================
generate_summary() {
    log_step "生成汇总报告"

    local summary_file="$RESULTS_DIR/benchmark_summary_${TIMESTAMP}.md"

    cat > "$summary_file" << EOF
# GlobalReach V2.0 — 性能基准测试报告

**测试时间**: $(date '+%Y-%m-%d %H:%M:%S')
**目标地址**: $BASE_URL
**场景**: $SCENARIO

## 结果摘要

| 场景 | 状态 | 说明 |
|------|------|------|
$(for s in "${!SCENARIO_DESCS[@]}"; do echo "| $s | 待分析 | ${SCENARIO_DESCS[$s]} |"; done)

## 详细结果

详见各场景 JSON 文件。

---
*由 GlobalReach N06 Performance Benchmark Suite 自动生成*
EOF

    log_info "汇总报告: $summary_file"
}

# ============================================
# 主流程
# ============================================
main() {
    echo ""
    echo -e "${BOLD}${BLUE}╔════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║  GlobalReach V2.0 — 性能基准测试套件       ║${NC}"
    echo -e "${BOLD}${BLUE}║  N06 Performance Benchmark Suite v1.0       ║${NC}"
    echo -e "${BOLD}${BLUE}╚════════════════════════════════════════════╝${NC}"
    echo ""

    # 解析参数
    parse_args "$@"

    # 加载环境变量
    load_env

    # 显示配置
    log_info "配置:"
    log_info "  场景:       $SCENARIO"
    log_info "  API 地址:   $BASE_URL"
    log_info "  输出格式:   $OUTPUT_FORMAT"
    log_info "  结果目录:   $RESULTS_DIR"
    [[ -n "$VUS_OVERRIDE" ]] && log_info "  并发覆盖:   $VUS_OVERRIDE"
    [[ -n "$DURATION_OVERRIDE" ]] && log_info "  时长覆盖:   $DURATION_OVERRIDE"
    [[ "$HTML_REPORT" == "true" ]] && log_info "  HTML 报告:  启用"
    [[ "$DRY_RUN" == "true" ]] && log_info "  模式:       DRY RUN"

    # 环境预检
    precheck

    # 执行场景
    local overall_exit=0
    local results_table=""

    if [[ "$SCENARIO" == "all" ]]; then
        # 运行全部场景
        log_step "执行全部测试场景"

        for scenario in smoke load stress spike endpoints auth-flow email-pipeline; do
            if ! run_scenario "$scenario"; then
                overall_exit=1
            fi
        done
    else
        # 运行单个场景
        if ! run_scenario "$SCENARIO"; then
            overall_exit=1
        fi
    fi

    # 生成汇总
    generate_summary

    # 最终状态
    echo ""
    if [[ $overall_exit -eq 0 ]]; then
        echo -e "${GREEN}════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  ✅ 所有测试完成 — 结果保存在 $RESULTS_DIR${NC}"
        echo -e "${GREEN}════════════════════════════════════════════${NC}"
    else
        echo -e "${RED}════════════════════════════════════════════${NC}"
        echo -e "${RED}  ⚠️  部分测试存在警告或失败 — 请查看详细日志${NC}"
        echo -e "${RED}════════════════════════════════════════════${NC}"
    fi

    exit $overall_exit
}

# ============================================
# 入口
# ============================================
main "$@"
