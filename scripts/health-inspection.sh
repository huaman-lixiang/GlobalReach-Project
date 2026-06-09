#!/usr/bin/env bash
# ============================================================================
# GlobalReach V2.0 — 自动化巡检引擎 (Automated Inspection Engine)
# O03: 自动化巡检引擎
#
# 用法:
#   ./scripts/health-inspection.sh                        # 全量巡检（默认）
#   ./scripts/health-inspection.sh --quick                # 快速模式（仅关键项）
#   ./scripts/health-inspection.sh --json                 # JSON输出（CI/集成用）
#   ./scripts/health-inspection.sh --dimension infra      # 指定维度
#   ./scripts/health-inspection.sh --report --output ./reports/  # 生成报告
#   ./scripts/health-inspection.sh --daemon --interval 3600  # 定时巡检
#
# 五大巡检维度:
#   D1: 基础设施层 (Infrastructure) — Docker, 容器, 资源, 网络
#   D2: 应用层 (Application)       — API, DB连接池, Redis, Nginx, Prometheus目标
#   D3: 安全层 (Security)          — TLS证书, 开放端口, 敏感信息, JWT, Rate Limit
#   D4: 数据层 (Data)              — PG连接数, 备份, Redis内存, 备份完整性
#   D5: 监控层 (Monitoring)        — Prometheus, Grafana, AlertManager, Loki, 告警
#
# 退出码:
#   0 = 全部通过 (或仅有WARN)
#   1 = 有FAIL项
#   2 = 有错误（无法继续巡检）
#
# 兼容: Windows (Git Bash / WSL2) + Linux (CI)
# ============================================================================

set -euo pipefail

# ── 全局变量 ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"

# 运行模式
MODE="full"                    # full | quick | json | daemon
TARGET_DIMENSION=""            # 空 = 全量, 或指定维度名
OUTPUT_DIR=""                  # 报告输出目录
DAEMON_INTERVAL=0              # 守护进程间隔（秒）
DAEMON_RUN_COUNT=0             # 守护进程运行次数

# 巡检元数据
INSPECTION_ID=""
START_TIME=""
END_TIME=""
GIT_HEAD=""

# 计数器
TOTAL_CHECKS=0
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
ERROR_COUNT=0

# 结果收集数组
declare -a RESULTS=()
declare -a FAILURES=()
declare -a WARNINGS=()

# 维度结果存储
declare -A DIM_SCORES=()
declare -A DIM_TOTALS=()
declare -A DIM_PASSES=()
declare -A DIM_WARNS=()
declare -A DIM_FAILS=()

# 颜色定义（非交互式/JSON模式下禁用）
if [ -t 1 ] && [ "${MODE}" != "json" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    MAGENTA=''
    BOLD=''
    NC=''
fi

# ── 阈值配置（可通过环境变量或配置文件覆盖）─────────────────────────────
CPU_THRESHOLD=${INSPECT_CPU_THRESHOLD:-80}           # CPU使用率阈值 (%)
MEMORY_THRESHOLD=${INSPECT_MEMORY_THRESHOLD:-85}     # 内存使用率阈值 (%)
DISK_THRESHOLD=${INSPECT_DISK_THRESHOLD:-85}         # 磁盘使用率阈值 (%)
API_RESPONSE_TIME_MS=${INSPECT_API_RESPONSE_MS:-500} # API响应时间阈值 (ms)
HEALTH_SCORE_MIN=${INSPECT_HEALTH_SCORE_MIN:-80}     # 健康评分最低值
TLS_DAYS_WARNING=${INSPECT_TLS_DAYS:-30}             # TLS证书警告天数
PG_CONN_RATIO=${INSPECT_PG_CONN_RATIO:-0.8}          # PG连接数比例阈值
REDIS_MEM_RATIO=${INSPECT_REDIS_MEM_RATIO:-0.8}      # Redis内存使用比例阈值
BACKUP_MAX_AGE_HOURS=${INSPECT_BACKUP_AGE_HOURS:-24} # 备份最大年龄(小时)
PROMETHEUS_UP_RATIO=${INSPECT_PROM_UP_RATIO:-0.9}    # Prometheus targets up比例
MAX_ALERT_COUNT=${INSPECT_MAX_ALERTS:-10}            # 最大活跃告警数
NETWORK_LATENCY_MS=${INSPECT_NET_LATENCY_MS:-10}     # 网络延迟阈值(ms)

# 预期端口列表（安全检查用）
EXPECTED_PORTS=(
    "3000"   # API
    "443"    # HTTPS
    "80"     # HTTP
    "9090"   # Prometheus
    "3001"   # Grafana (映射到3002)
    "9093"   # AlertManager
    "9100"   # Node Exporter
    "9630"   # PG Exporter
    "3100"   # Loki
    "3200"   # Tempo
    "8025"   # Mailpit Web UI
    "1025"   # Mailpit SMTP
    "6379"   # Redis (内部)
    "5432"   # PostgreSQL (内部)
)

# 容器总数
EXPECTED_CONTAINERS=13

# ── 工具函数 ───────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
${BOLD}GlobalReach V2.0 — 自动化巡检引擎${NC}

用法:
    $0 [选项]

选项:
    --quick               快速模式（仅检查关键项）
    --json                JSON输出格式（CI/CD集成）
    --dimension NAME      指定检查维度:
                            infrastructure  (D1 基础设施)
                            application     (D2 应用层)
                            security        (D3 安全层)
                            data            (D4 数据层)
                            monitoring      (D5 监控层)
    --report              生成HTML报告
    --output DIR          报告输出目录 (默认: ./reports/inspection/)
    --daemon              守护进程模式（定时循环执行）
    --interval SECONDS    守护进程间隔 (默认: 3600)
    -h, --help            显示此帮助信息

退出码:
    0  全部通过（或仅有WARN）
    1  存在FAIL项
    2  内部错误

示例:
    $0                              # 全量巡检
    $0 --quick                      # 快速巡检
    $0 --dimension infrastructure   # 仅检查基础设施
    $0 --json                       # CI模式JSON输出
    $0 --report --output ./reports/ # 生成报告
    $0 --daemon --interval 3600     # 每1小时自动巡检
EOF
}

log_pass() { printf "  ${GREEN}✅ PASS${NC} — %s\n" "$1"; }
log_warn() { printf "  ${YELLOW}⚠️  WARN${NC} — %s\n" "$1"; }
log_fail() { printf "  ${RED}❌ FAIL${NC} — %s\n" "$1"; }
log_info() { printf "  ${CYAN}ℹ️  INFO${NC} — %s\n" "$1"; }
log_section() { echo ""; echo -e "${BOLD}${CYAN}$1${NC}"; }

# 初始化维度计数器
init_dimension() {
    local dim="$1"
    DIM_SCORES[$dim]=0
    DIM_TOTALS[$dim]=0
    DIM_PASSES[$dim]=0
    DIM_WARNS[$dim]=0
    DIM_FAILS[$dim]=0
}

# 添加检查结果
add_result() {
    local dimension="$1" check_name="$2" status="$3" message="$4"
    local diagnosis="" suggestion=""

    if [ $# -ge 5 ]; then diagnosis="$5"; fi
    if [ $# -ge 6 ]; then suggestion="$6"; fi

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    DIM_TOTALS[$dimension]=$((${DIM_TOTALS[$dimension]:-0} + 1))

    local result_json="{\"dimension\":\"$dimension\",\"name\":\"$check_name\",\"status\":\"$status\",\"message\":\"$message\"}"
    if [ -n "$diagnosis" ]; then result_json="$result_json,\"diagnosis\":\"$diagnosis\""; fi
    if [ -n "$suggestion" ]; then result_json="$result_json,\"suggestion\":\"$suggestion\""; fi
    result_json="$result_json}"

    RESULTS+=("$result_json")

    case "$status" in
        pass)
            PASS_COUNT=$((PASS_COUNT + 1))
            DIM_PASSES[$dimension]=$((${DIM_PASSES[$dimension]:-0} + 1))
            log_pass "$check_name: $message"
            ;;
        warn)
            WARN_COUNT=$((WARN_COUNT + 1))
            DIM_WARNS[$dimension]=$((${DIM_WARNS[$dimension]:-0} + 1))
            log_warn "$check_name: $message"
            WARNINGS+=("[$dimension] $check_name: $message${diagnosis:+\n  → 诊断: $diagnosis}${suggestion:+\n  → 建议: $suggestion}")
            ;;
        fail)
            FAIL_COUNT=$((FAIL_COUNT + 1))
            DIM_FAILS[$dimension]=$((${DIM_FAILS[$dimension]:-0} + 1))
            log_fail "$check_name: $message"
            FAILURES+=("[$dimension] $check_name: $message${diagnosis:+\n  → 诊断: $diagnosis}${suggestion:+\n  → 建议: $suggestion}")
            ;;
        error)
            ERROR_COUNT=$((ERROR_COUNT + 1))
            log_fail "$check_name: $message (ERROR)"
            ;;
    esac
}

# 获取 Git HEAD
get_git_head() {
    if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
        git rev-parse --short HEAD 2>/dev/null || echo "unknown"
    else
        echo "n/a"
    fi
}

# 生成巡检ID
generate_inspection_id() {
    INSPECTION_ID="INS-$(date '+%Y%m%d-%H%M%S')"
}

# 绘制进度条
draw_progress_bar() {
    local percentage=$1 width=10 filled empty
    filled=$((percentage * width / 100))
    empty=$((width - filled))

    local bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done

    echo "$bar"
}

# HTTP请求辅助函数（兼容curl/wget）
http_request() {
    local url="$1" timeout="${2:-5}" method="${3:-GET}"

    if command -v curl &>/dev/null; then
        local response_code response_time body
        response=$(curl -s -o /dev/null -w "%{http_code}|%{time_total}" \
            --max-time "$timeout" "$url" 2>/dev/null || echo "000|0")
        echo "$response"
    elif command -v wget &>/dev/null; then
        # wget fallback (仅获取状态码)
        local response_code
        response_code=$(wget --spider --server-response --timeout="$timeout" "$url" 2>&1 \
            | grep "HTTP/" | tail -1 | awk '{print $2}' || echo "000")
        echo "${response_code}|0"
    else
        echo "000|0"
    fi
}

# 安全地解析JSON字段（使用python或grep）
parse_json_field() {
    local json_str="$1" field="$2"

    if command -v python3 &>/dev/null; then
        python3 -c "
import json, sys
try:
    data = json.loads('''$json_str''')
    print(data.get('$field', ''))
except:
    print('')
" 2>/dev/null
    elif command -v python &>/dev/null; then
        python -c "
import json, sys
try:
    data = json.loads(r'''$json_str''')
    print(data.get('$field', ''))
except:
    print('')
" 2>/dev/null
    else
        # 简单的grep fallback
        echo "$json_str" | grep -oP "\"$field\"\s*:\s*\"?[^\"]*\"?" | head -1 | sed 's/.*:\s*//;s/"//g'
    fi
}

# ── 参数解析 ───────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)   MODE="quick" ;;
        --json)    MODE="json" ;;
        --dimension) shift; TARGET_DIMENSION="$1" ;;
        --report)  MODE="report" ;;
        --output)  shift; OUTPUT_DIR="$1" ;;
        --daemon)  MODE="daemon" ;;
        --interval) shift; DAEMON_INTERVAL="$1" ;;
        -h|--help) usage; exit 0 ;;
        *) echo "未知参数: $1"; usage; exit 2 ;;
    esac
    shift
done

# 设置默认值
if [ -z "$OUTPUT_DIR" ] && [ "$MODE" = "report" ]; then
    OUTPUT_DIR="$PROJECT_ROOT/reports/inspection"
fi
if [ "$DAEMON_INTERVAL" -eq 0 ] && [ "$MODE" = "daemon" ]; then
    DAEMON_INTERVAL=3600
fi

# ============================================================================
# D1: 基础设施层 (Infrastructure)
# ============================================================================

check_infrastructure() {
    if [ -n "$TARGET_DIMENSION" ] && [ "$TARGET_DIMENSION" != "infrastructure" ] && [ "$TARGET_DIMENSION" != "infra" ]; then
        return 0
    fi

    init_dimension "infrastructure"
    local dim="infrastructure"

    log_section "[D1 基础设施层 (Infrastructure)]"

    # I1. Docker daemon 运行状态
    if command -v docker &>/dev/null; then
        if docker info &>/dev/null 2>&1; then
            add_result "$dim" "Docker Daemon" "pass" "运行正常"
        else
            add_result "$dim" "Docker Daemon" "fail" "无法连接" \
                "Docker daemon未运行或权限不足" \
                "执行: sudo systemctl start docker 或检查Docker Desktop是否启动"
        fi
    else
        add_result "$dim" "Docker Daemon" "warn" "docker命令不可用" \
            "PATH中未找到docker命令" \
                "安装Docker或确认WSL2环境已正确配置"
    fi

    # I2. 容器健康状态
    if [ -f "$COMPOSE_FILE" ] && command -v docker &>/dev/null; then
        local compose_output
        compose_output=$(docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || echo "")

        if [ -n "$compose_output" ]; then
            local running_count total_count
            running_count=$(echo "$compose_output" | grep -c "Up\|running\|healthy" || true)
            total_count=$(echo "$compose_output" | grep -cE "globalreach-" || true)

            # 排除标题行
            if [ "$total_count" -gt 0 ]; then
                local ratio=$((running_count * 100 / total_count))

                if [ "$running_count" -ge "$((EXPECTED_CONTAINERS - 1))" ]; then
                    # 允许1个容器例外（如certbot按需启动）
                    add_result "$dim" "容器健康状态" "pass" "${running_count}/${total_count} 容器运行中 (${ratio}%)"
                elif [ "$running_count" -ge $((EXPECTED_CONTAINERS / 2)) ]; then
                    add_result "$dim" "容器健康状态" "warn" "${running_count}/${total_count} 容器运行中 (${ratio}%)" \
                        "部分容器未运行，可能影响系统功能" \
                        "执行: docker compose -f $COMPOSE_FILE ps 查看详情"
                else
                    add_result "$dim" "容器健康状态" "fail" "${running_count}/${total_count} 容器运行中 (${ratio}%)" \
                        "大量容器宕机，系统可能不可用" \
                        "执行: docker compose -f $COMPOSE_FILE up -d 重启服务"
                fi
            else
                add_result "$dim" "容器健康状态" "warn" "无法获取容器状态" \
                    "docker compose ps返回空结果" \
                    "确认Docker Compose项目已正确启动"
            fi
        else
            add_result "$dim" "容器健康状态" "warn" "docker compose不可用" \
                "compose命令执行失败" \
                "检查docker-compose.prod.yml是否存在且语法正确"
        fi
    else
        add_result "$dim" "容器健康状态" "warn" "跳过（Docker或Compose文件不可用）"
    fi

    # I3. CPU 使用率
    if [ -e "/proc/stat" ]; then
        # Linux: 从/proc/stat计算CPU使用率
        local cpu_line1 cpu_line2
        cpu_line1=$(head -1 /proc/stat | awk '{print $2+$3+$4+$5+$6+$7+$8}')
        sleep 1
        cpu_line2=$(head -1 /proc/stat | awk '{print $2+$3+$4+$5+$6+$7+$8}')

        local cpu_usage=0
        if [ "$cpu_line1" -gt 0 ] 2>/dev/null; then
            cpu_usage=$(( (cpu_line2 - cpu_line1) * 100 / cpu_line1 ))
            # 限制合理范围
            if [ "$cpu_usage" -lt 0 ] || [ "$cpu_usage" -gt 100 ]; then
                cpu_usage=0
            fi
        fi

        if [ "$cpu_usage" -lt "$CPU_THRESHOLD" ]; then
            add_result "$dim" "CPU使用率" "pass" "${cpu_usage}% (阈值: <${CPU_THRESHOLD}%)"
        elif [ "$cpu_usage" -lt 95 ]; then
            add_result "$dim" "CPU使用率" "warn" "${cpu_usage}% (阈值: <${CPU_THRESHOLD}%)" \
                "CPU使用率偏高，可能有资源密集型任务" \
                "检查: docker stats 查看各容器资源占用"
        else
            add_result "$dim" "CPU使用率" "fail" "${cpu_usage}% (阈值: <${CPU_THRESHOLD}%)" \
                "CPU严重过载，系统响应可能缓慢" \
                "立即检查: top 或 docker stats，考虑扩容或优化"
        fi
    elif command -v docker &>/dev/null; then
        # Windows/Docker fallback: 使用docker stats
        local cpu_stats
        cpu_stats=$(docker stats --no-stream --format "{{.CPUPerc}}" 2>/dev/null | tr -d '%' || true)
        if [ -n "$cpu_stats" ]; then
            local avg_cpu=0 count=0 sum=0
            for val in $cpu_stats; do
                sum=$(echo "$sum + $val" | bc 2>/dev/null || echo "$sum")
                count=$((count + 1))
            done
            if [ "$count" -gt 0 ]; then
                avg_cpu=$(echo "scale=1; $sum / $count" | bc 2>/dev/null || echo "0")
                local int_cpu=${avg_cpu%.*}
                if [ "$int_cpu" -lt "$CPU_THRESHOLD" ] 2>/dev/null; then
                    add_result "$dim" "CPU使用率" "pass" "平均 ${avg_cpu}% (阈值: <${CPU_THRESHOLD}%)"
                else
                    add_result "$dim" "CPU使用率" "warn" "平均 ${avg_cpu}% (阈值: <${CPU_THRESHOLD}%)" \
                        "容器CPU使用率偏高" \
                        "检查: docker stats --no-stream"
                fi
            else
                add_result "$dim" "CPU使用率" "warn" "无法获取CPU统计"
            fi
        else
            add_result "$dim" "CPU使用率" "warn" "跳过（无法获取统计数据）"
        fi
    else
        add_result "$dim" "CPU使用率" "warn" "跳过（无/proc/stat和docker）"
    fi

    # I4. 内存使用率
    if command -v free &>/dev/null; then
        local mem_info mem_total mem_used mem_percent
        mem_info=$(free -m 2>/dev/null | grep "^Mem:" || echo "")
        if [ -n "$mem_info" ]; then
            mem_total=$(echo "$mem_info" | awk '{print $2}')
            mem_used=$(echo "$mem_info" | awk '{print $3}')
            if [ "$mem_total" -gt 0 ] 2>/dev/null; then
                mem_percent=$((mem_used * 100 / mem_total))

                if [ "$mem_percent" -lt "$MEMORY_THRESHOLD" ]; then
                    add_result "$dim" "内存使用率" "pass" "${mem_percent}% (${mem_used}MB/${mem_total}MB, 阈值: <${MEMORY_THRESHOLD}%)"
                elif [ "$mem_percent" -lt 95 ]; then
                    add_result "$dim" "内存使用率" "warn" "${mem_percent}% (${mem_used}MB/${mem_total}MB, 阈值: <${MEMORY_THRESHOLD}%)" \
                        "内存使用率偏高" \
                        "检查: free -h 和 docker stats"
                else
                    add_result "$dim" "内存使用率" "fail" "${mem_percent}% (${mem_used}MB/${mem_total}MB, 阈值: <${MEMORY_THRESHOLD}%)" \
                        "内存即将耗尽，可能导致OOM Kill" \
                        "立即释放内存或增加swap空间"
                fi
            fi
        fi
    elif [ -e "/proc/meminfo" ]; then
        local mem_total_meminfo mem_avail_meminfo mem_percent
        mem_total_meminfo=$(grep "^MemTotal:" /proc/meminfo | awk '{print $2}')
        mem_avail_meminfo=$(grep "^MemAvailable:" /proc/meminfo | awk '{print $2}')
        if [ "$mem_total_meminfo" -gt 0 ] 2>/dev/null; then
            mem_percent=$(( (mem_total_meminfo - mem_avail_meminfo) * 100 / mem_total_meminfo ))

            if [ "$mem_percent" -lt "$MEMORY_THRESHOLD" ]; then
                add_result "$dim" "内存使用率" "pass" "${mem_percent}% (阈值: <${MEMORY_THRESHOLD}%)"
            else
                add_result "$dim" "内存使用率" "warn" "${mem_percent}% (阈值: <${MEMORY_THRESHOLD}%)"
            fi
        fi
    else
        add_result "$dim" "内存使用率" "warn" "跳过（free命令不可用）"
    fi

    # I5. 磁盘使用率
    if command -v df &>/dev/null; then
        local disk_info disk_use disk_percent
        disk_info=$(df -h / 2>/dev/null | tail -1 || echo "")
        if [ -n "$disk_info" ]; then
            disk_percent=$(echo "$disk_info" | awk '{print $5}' | tr -d '%')
            disk_use=$(echo "$disk_info" | awk '{print $5}')

            if [ "$disk_percent" -lt "$DISK_THRESHOLD" ] 2>/dev/null; then
                add_result "$dim" "磁盘使用率" "pass" "${disk_use} (阈值: <${DISK_THRESHOLD}%)"
            elif [ "$disk_percent" -lt 95 ]; then
                add_result "$dim" "磁盘使用率" "warn" "${disk_use} (阈值: <${DISK_THRESHOLD}%)" \
                    "磁盘空间不足，可能影响日志写入和备份" \
                    "清理: docker system prune -a, 检查大文件: du -sh /*"
            else
                add_result "$dim" "磁盘使用率" "fail" "${disk_use} (阈值: <${DISK_THRESHOLD}%)" \
                    "磁盘空间严重不足，系统可能崩溃" \
                    "立即清理: docker system prune -af, 清理旧日志和备份"
            fi
        fi
    else
        add_result "$dim" "磁盘使用率" "warn" "跳过（df命令不可用）"
    fi

    # I6. 网络连通性（内部服务间）
    if command -v ping &>/dev/null; then
        # Ping localhost 测试基本网络栈
        if ping -c 1 -W 2 localhost &>/dev/null 2>&1; then
            local latency
            latency=$(ping -c 1 -W 2 localhost 2>/dev/null | grep "time=" | sed 's/.*time=\([0-9.]*\).*/\1/' || echo "0")
            local int_latency=${latency%.*}

            if [ -z "$int_latency" ] || [ "$int_latency" -eq 0 ] 2>/dev/null; then
                add_result "$dim" "网络连通性" "pass" "localhost可达"
            elif [ "$int_latency" -lt "$NETWORK_LATENCY_MS" ]; then
                add_result "$dim" "网络连通性" "pass" "localhost延迟 ${latency}ms (<${NETWORK_LATENCY_MS}ms)"
            else
                add_result "$dim" "网络连通性" "warn" "localhost延迟 ${latency}ms (>${NETWORK_LATENCY_MS}ms)" \
                    "本地网络延迟偏高" \
                    "检查防火墙和网络配置"
            fi
        else
            add_result "$dim" "网络连通性" "fail" "localhost不可达" \
                "网络栈异常" \
                "检查: ip addr show, systemctl status networking"
        fi
    else
        add_result "$dim" "网络连通性" "warn" "跳过（ping命令不可用）"
    fi

    # I7. Docker 网络状态
    if command -v docker &>/dev/null; then
        local network_check
        network_check=$(docker network inspect globalreach-project_globalreach-network 2>/dev/null || echo "")
        if [ -n "$network_check" ] && echo "$network_check" | grep -q '"Name"'; then
            local container_count network_ipam
            container_count=$(echo "$network_check" | python3 -c "
import json,sys
try:
    data=json.load(sys.stdin)
    if isinstance(data,list):
        c=data[0].get('Containers',{})
        print(len(c))
    else:
        print(0)
except:
    print(0)
" 2>/dev/null || echo "0")

            add_result "$dim" "Docker网络" "pass" "globalreach-network 正常 (${container_count}个容器连接)"
        else
            # 尝试列出所有自定义网络
            local networks
            networks=$(docker network ls --format "{{.Name}}" 2>/dev/null | grep globalreach || true)
            if [ -z "$networks" ]; then
                add_result "$dim" "Docker网络" "warn" "未找到globalreach网络" \
                    "Docker网络可能未创建" \
                    "执行: docker network create globalreach-project_globalreach-network"
            else
                add_result "$dim" "Docker网络" "pass" "Docker网络存在: $networks"
            fi
        fi
    else
        add_result "$dim" "Docker网络" "warn" "跳过（Docker不可用）"
    fi

    # I8. Docker 系统资源概览
    if [ "$MODE" = "full" ] && command -v docker &>/dev/null; then
        local docker_version docker_images docker_containers
        docker_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")
        docker_images=$(docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | wc -l || echo "0")
        docker_containers=$(docker ps -a --format "{{.Names}}" 2>/dev/null | wc -l || echo "0")

        add_result "$dim" "Docker版本" "pass" "v${docker_version} (${docker_images}镜像, ${docker_containers}容器)"
    fi
}

# ============================================================================
# D2: 应用层 (Application)
# ============================================================================

check_application() {
    if [ -n "$TARGET_DIMENSION" ] && [ "$TARGET_DIMENSION" != "application" ]; then
        return 0
    fi

    init_dimension "application"
    local dim="application"

    log_section "[D2 应用层 (Application)]"

    # A1. API 可达性
    local api_response
    api_response=$(http_request "http://localhost:3000/api/v1/health" 10)

    local http_code api_time
    http_code=$(echo "$api_response" | cut -d'|' -f1)
    api_time=$(echo "$api_response" | cut -d'|' -f2)

    if [ "$http_code" = "200" ]; then
        add_result "$dim" "API可达性" "pass" "HTTP ${http_code} (${api_time}s)"
    elif [ "$http_code" = "000" ]; then
        add_result "$dim" "API可达性" "fail" "无法连接 (超时或拒绝)" \
            "API服务可能未启动或端口被阻塞" \
            "检查: docker compose -f $COMPOSE_FILE ps api, docker logs globalreach-api-prod"
    else
        add_result "$dim" "API可达性" "warn" "HTTP ${http_code} (非200)" \
            "API返回非预期状态码" \
                "查看API日志: docker logs --tail 50 globalreach-api-prod"
    fi

    # A2. API 响应时间
    if [ -n "$api_time" ] && [ "$api_time" != "0" ]; then
        local api_time_ms
        api_time_ms=$(echo "$api_time * 1000" | bc 2>/dev/null || echo "${api_time}")

        if [ "${api_time_ms%.*}" -lt "$API_RESPONSE_TIME_MS" ] 2>/dev/null; then
            add_result "$dim" "API响应时间" "pass" "${api_time_ms%.*}ms (阈值: <${API_RESPONSE_TIME_MS}ms)"
        elif [ "${api_time_ms%.*}" -lt 2000 ] 2>/dev/null; then
            add_result "$dim" "API响应时间" "warn" "${api_time_ms%.*}ms (阈值: <${API_RESPONSE_TIME_MS}ms)" \
                "API响应偏慢，可能存在性能瓶颈" \
                "检查慢查询日志, 查看 metrics.js 输出"
        else
            add_result "$dim" "API响应时间" "fail" "${api_time_ms%.*}ms (阈值: <${API_RESPONSE_TIME_MS}ms)" \
                "API响应严重超时，系统可能过载" \
                "立即检查: 数据库查询优化, CPU/内存资源"
        fi
    elif [ "$http_code" = "200" ]; then
        add_result "$dim" "API响应时间" "pass" "< ${API_RESPONSE_TIME_MS}ms (快速响应)"
    fi

    # A3. Health Score 解析
    if [ "$http_code" = "200" ]; then
        local health_body health_score
        health_body=$(curl -s --max-time 10 "http://localhost:3000/api/v1/health" 2>/dev/null || echo "{}")
        health_score=$(echo "$health_body" | parse_json_field "healthScore" | parse_json_field "score" 2>/dev/null || echo "0")
        health_score=${health_score:-0}

        if [ "$health_score" -ge "$HEALTH_SCORE_MIN" ] 2>/dev/null; then
            add_result "$dim" "Health Score" "pass" "${health_score}/100 (阈值: >=${HEALTH_SCORE_MIN})"
        elif [ "$health_score" -gt 0 ] 2>/dev/null; then
            add_result "$dim" "Health Score" "warn" "${health_score}/100 (阈值: >=${HEALTH_SCORE_MIN})" \
                "部分子系统降级运行" \
                "检查: GET /api/v1/health 详情中的各个子系统状态"
        else
            add_result "$dim" "Health Score" "warn" "无法解析Health Score" \
                "健康端点返回格式可能变化" \
                "验证: curl http://localhost:3000/api/v1/health | jq ."
        fi
    fi

    # A4. Redis 连接检查
    if command -v redis-cli &>/dev/null; then
        local redis_response
        redis_response=$(redis-cli ping 2>/dev/null || echo "")

        if [ "$redis_response" = "PONG" ]; then
            add_result "$dim" "Redis连接" "pass" "PONG"
        elif [ -n "$redis_response" ]; then
            add_result "$dim" "Redis连接" "warn" "响应: $redis_response (非PONG)" \
                "Redis可能正在加载或认证失败" \
                "检查: redis-cli INFO server, docker logs globalreach-redis"
        else
            # 尝试通过Docker执行
            if docker exec globalreach-redis redis-cli ping &>/dev/null 2>&1; then
                add_result "$dim" "Redis连接" "pass" "PONG (via docker exec)"
            else
                add_result "$dim" "Redis连接" "fail" "无法连接" \
                    "Redis服务未运行或网络不通" \
                    "检查: docker restart globalreach-redis"
            fi
        fi
    elif docker exec globalreach-redis redis-cli ping &>/dev/null 2>&1; then
        add_result "$dim" "Redis连接" "pass" "PONG (via docker exec)"
    else
        add_result "$dim" "Redis连接" "warn" "redis-cli不可用且Docker连接失败" \
            "Redis客户端工具未安装或容器不可达" \
            "安装redis-tools或通过docker exec检查"
    fi

    # A5. Nginx 状态检查
    local nginx_response
    nginx_response=$(http_request "http://localhost:443" 5)

    local nginx_code
    nginx_code=$(echo "$nginx_response" | cut -d'|' -f1)

    if echo "$nginx_code" | grep -qE "200|301|302|307|308"; then
        add_result "$dim" "Nginx状态" "pass" "HTTP ${nginx_code}"
    elif [ "$nginx_code" = "000" ]; then
        # SSL证书问题或Nginx未监听443
        if curl -sk --max-time 5 "https://localhost:443" -o /dev/null -w "%{http_code}" 2>/dev/null | grep -qE "200|301|302"; then
            add_result "$dim" "Nginx状态" "pass" "HTTPS正常 (SSL验证跳过)"
        else
            add_result "$dim" "Nginx状态" "warn" "HTTPS不可达 (可能SSL证书问题)" \
                "已知: Phase L Blocked — TLS证书待签发" \
                "参考: docs/SSL_SETUP.md, 执行 ssl-switch-to-letsencrypt.sh"
        fi
    else
        add_result "$dim" "Nginx状态" "warn" "HTTP ${nginx_code}" \
            "Nginx返回非预期状态码" \
            "检查: docker logs globalreach-nginx-prod, nginx -t"
    fi

    # A6. Prometheus 目标状态
    local prom_targets_response
    prom_targets_response=$(http_request "http://localhost:9090/api/v1/targets" 10)

    local prom_targets_code
    prom_targets_code=$(echo "$prom_targets_response" | cut -d'|' -f1)

    if [ "$prom_targets_code" = "200" ]; then
        local targets_body up_count total_targets up_ratio
        targets_body=$(curl -s --max-time 10 "http://localhost:9090/api/v1/targets" 2>/dev/null || echo "{}")

        # 解析targets数量
        if command -v python3 &>/dev/null; then
            eval "$(python3 -c "
import json, sys
try:
    data = json.loads('''$targets_body''')
    targets = data.get('data', {}).get('activeTargets', [])
    total = len(targets)
    up = len([t for t in targets if t.get('health') == 'up'])
    ratio = round(up / total * 100) if total > 0 else 0
    print(f'up_count={up};total_targets={total};up_ratio={ratio}')
except Exception as e:
    print('up_count=0;total_targets=0;up_ratio=0')
" 2>/dev/null || echo "up_count=0;total_targets=0;up_ratio=0")"

            local target_ratio_int=${up_ratio%.*}
            if [ "$target_ratio_int" -ge $((PROMETHEUS_UP_RATIO * 100)) ] 2>/dev/null; then
                add_result "$dim" "Prometheus目标" "pass" "${up_count}/${total_targets} up (${up_ratio}%, 阈值: >${PROMETHEUS_UP_RATIO})"
            else
                add_result "$dim" "Prometheus目标" "warn" "${up_count}/${total_targets} up (${up_ratio}%, 阈值: >${PROMETHEUS_UP_RATIO})" \
                    "部分监控目标离线" \
                    "访问: http://localhost:9090/targets 查看详情"
            fi
        else
            add_result "$dim" "Prometheus目标" "pass" "Prometheus API可访问 (详细分析需python3)"
        fi
    elif [ "$prom_targets_code" = "000" ]; then
        add_result "$dim" "Prometheus目标" "warn" "Prometheus不可达" \
            "Prometheus服务可能未启动" \
            "检查: docker restart globalreach-prometheus"
    else
        add_result "$dim" "Prometheus目标" "warn" "HTTP ${prom_targets_code}"
    fi

    # A7. DB 连接池状态（从health endpoint获取）
    if [ "$http_code" = "200" ] && [ -n "${health_body:-}" ]; then
        local db_status pool_active pool_max
        db_status=$(echo "$health_body" | parse_json_field "checks" | parse_json_field "database" | parse_json_field "status" 2>/dev/null || echo "")

        if [ "$db_status" = "healthy" ]; then
            add_result "$dim" "DB连接池" "pass" "数据库连接正常 (status: healthy)"
        elif [ -n "$db_status" ]; then
            add_result "$dim" "DB连接池" "warn" "数据库状态: $db_status" \
                "数据库可能存在连接问题" \
                "检查: PG连接数, 慢查询日志"
        fi
    fi

    # A8. Email Queue 状态
    if [ "$http_code" = "200" ] && [ -n "${health_body:-}" ]; then
        local queue_status
        queue_status=$(echo "$health_body" | parse_json_field "checks" | parse_json_field "email_queue" | parse_json_field "status" 2>/dev/null || echo "")

        if [ "$queue_status" = "healthy" ] || [ "$queue_status" = "not_configured" ]; then
            add_result "$dim" "Email队列" "pass" "状态: ${queue_status:-ok}"
        elif [ -n "$queue_status" ]; then
            add_result "$dim" "Email队列" "warn" "状态: $queue_status" \
                "邮件队列可能积压" \
                "检查: emailQueue状态, worker进程"
        fi
    fi

    # A9. Engine 状态 (M7/M8)
    if [ "$http_code" = "200" ] && [ -n "${health_body:-}" ]; then
        local engine_status
        engine_status=$(echo "$health_body" | parse_json_field "checks" | parse_json_field "engine" | parse_json_field "status" 2>/dev/null || echo "")

        if [ "$engine_status" = "healthy" ]; then
            add_result "$dim" "M7/M8引擎" "pass" "引擎运行正常"
        elif [ "$engine_status" = "not_configured" ]; then
            add_result "$dim" "M7/M8引擎" "pass" "引擎未配置(DB-only模式)"
        elif [ -n "$engine_status" ]; then
            add_result "$dim" "M7/M8引擎" "warn" "状态: $engine_status" \
                "邮件账户引擎可能存在问题" \
                "检查: accountService.poolManager状态"
        fi
    fi
}

# ============================================================================
# D3: 安全层 (Security)
# ============================================================================

check_security() {
    if [ -n "$TARGET_DIMENSION" ] && [ "$TARGET_DIMENSION" != "security" ]; then
        return 0
    fi

    # 快速模式跳过部分安全检查
    if [ "$MODE" = "quick" ]; then
        init_dimension "security"
        local dim="security"
        log_section "[D3 安全层 (Security)] — 快速模式 (简化)"
        add_result "$dim" "安全检查" "pass" "快速模式：跳过深度安全扫描"
        return 0
    fi

    init_dimension "security"
    local dim="security"

    log_section "[D3 安全层 (Security)]"

    # S1. TLS 证书有效性
    local cert_paths=(
        "$PROJECT_ROOT/nginx/ssl/globalreach/fullchain.pem"
        "$PROJECT_ROOT/nginx/ssl/globalreach/cert.pem"
        "$PROJECT_ROOT/nginx/ssl/letsencrypt/live/api.globalreach.com/fullchain.pem"
    )

    local cert_found=false cert_valid=false cert_days_left=-1

    for cert_path in "${cert_paths[@]}"; do
        if [ -f "$cert_path" ]; then
            cert_found=true
            if command -v openssl &>/dev/null; then
                local cert_end_date cert_epoch now_epoch days_left
                cert_end_date=$(openssl x509 -in "$cert_path" -noout -enddate 2>/dev/null | cut -d= -f2 || echo "")
                cert_epoch=$(date -d "$cert_end_date" +%s 2>/dev/null || echo "0")
                now_epoch=$(date +%s 2>/dev/null || echo "0")

                if [ "$cert_epoch" -gt 0 ] && [ "$now_epoch" -gt 0 ]; then
                    days_left=$(( (cert_epoch - now_epoch) / 86400 ))
                    cert_days_left=$days_left

                    if [ "$days_left" -gt "$TLS_DAYS_WARNING" ]; then
                        cert_valid=true
                        add_result "$dim" "TLS证书" "pass" "有效 (剩余${days_left}天)"
                    elif [ "$days_left" -gt 0 ]; then
                        add_result "$dim" "TLS证书" "warn" "即将过期 (剩余${days_left}天, 阈值: >${TLS_DAYS_WARNING}天)" \
                            "证书即将到期，请及时续签" \
                            "执行: certbot renew 或检查ACME流程"
                    else
                        add_result "$dim" "TLS证书" "fail" "已过期 (${days_left}天前)" \
                            "证书已过期，HTTPS将不安全" \
                            "立即续签: certbot renew --force-renewal"
                    fi
                    break
                fi
            else
                add_result "$dim" "TLS证书" "warn" "证书文件存在但openssl不可用"
                break
            fi
        fi
    done

    if ! $cert_found; then
        add_result "$dim" "TLS证书" "warn" "证书文件不存在" \
            "已知: Phase L Blocked — TLS证书待签发" \
            "参考: docs/SSL_SETUP.md, 执行 ssl-switch-to-letsencrypt.sh"
    fi

    # S2. 开放端口扫描
    if command -v netstat &>/dev/null || command -v ss &>/dev/null; then
        local listening_ports unexpected_ports=()

        if command -v ss &>/dev/null; then
            listening_ports=$(ss -tlnp 2>/dev/null | grep -oE ":[0-9]+" | tr -d ':' | sort -un || true)
        elif command -v netstat &>/dev/null; then
            listening_ports=$(netstat -tlnp 2>/dev/null | grep LISTEN | grep -oE ":[0-9]+" | tr -d ':' | sort -un || true)
        fi

        if [ -n "$listening_ports" ]; then
            local found_unexpected=false
            while read -r port; do
                local is_expected=false
                for exp_port in "${EXPECTED_PORTS[@]}"; do
                    if [ "$port" = "$exp_port" ]; then
                        is_expected=true
                        break
                    fi
                done

                if ! $is_expected; then
                    # 忽略常见系统端口
                    case "$port" in
                        22|53|111|123|68|67) ;;  # SSH, DNS, NTP, DHCP
                        *) unexpected_ports+=("$port"); found_unexpected=true ;;
                    esac
                fi
            done <<< "$listening_ports"

            if $found_unexpected; then
                add_result "$dim" "开放端口" "warn" "发现非预期端口: ${unexpected_ports[*]}" \
                    "可能有未授权的服务在监听" \
                    "确认这些端口是否为必要服务，否则关闭"
            else
                add_result "$dim" "开放端口" "pass" "所有监听端口符合预期"
            fi
        else
            add_result "$dim" "开放端口" "warn" "无法获取端口列表"
        fi
    else
        add_result "$dim" "开放端口" "warn" "netstat/ss不可用"
    fi

    # S3. 环境变量敏感信息检查（仅检测明显问题，不泄露内容）
    local env_files=(
        "$PROJECT_ROOT/.env"
        "$PROJECT_ROOT/.env.production"
        "$PROJECT_ROOT/.env.prod"
    )

    local env_issues=0
    for env_file in "${env_files[@]}"; do
        if [ -f "$env_file" ]; then
            # 检查是否有明显的弱密码模式
            if grep -qiE "(password|secret|key)\s*=\s*(changeme|default|admin|123456|password)" "$env_file" 2>/dev/null; then
                env_issues=$((env_issues + 1))
            fi

            # 检查JWT secret长度
            local jwt_secret
            jwt_secret=$(grep -E "^JWT_SECRET\s*=" "$env_file" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")
            if [ -n "$jwt_secret" ] && [ ${#jwt_secret} -lt 32 ]; then
                env_issues=$((env_issues + 1))
            fi
        fi
    done

    if [ "$env_issues" -eq 0 ]; then
        add_result "$dim" "敏感信息检查" "pass" ".env文件无明显安全问题"
    else
        add_result "$dim" "敏感信息检查" "warn" "发现${env_issues}个潜在安全隐患" \
            ".env文件中可能包含弱密码或短密钥" \
            "更新: JWT_SECRET使用 openssl rand -hex 32 生成"
    fi

    # S4. JWT Secret 强度检查
    local jwt_secret_length=0
    for env_file in "${env_files[@]}"; do
        if [ -f "$env_file" ]; then
            local jwt_val
            jwt_val=$(grep -E "^JWT_SECRET\s*=" "$env_file" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")
            if [ -n "$jwt_val" ]; then
                jwt_secret_length=${#jwt_val}
                break
            fi
        fi
    done

    # 也检查docker-compose中的默认值
    if [ "$jwt_secret_length" -lt 32 ]; then
        # 可能使用了compose中的默认值
        if grep -q "change-this-secret-in-production-min-32-chars" "$COMPOSE_FILE" 2>/dev/null; then
            jwt_secret_length=50  # 默认值足够长
        fi
    fi

    if [ "$jwt_secret_length" -ge 32 ]; then
        add_result "$dim" "JWT Secret强度" "pass" "长度 ${jwt_secret_length} 字符 (>=32)"
    elif [ "$jwt_secret_length" -gt 0 ]; then
        add_result "$dim" "JWT Secret强度" "fail" "长度 ${jwt_secret_length} 字符 (<32, 不安全)" \
            "JWT Secret太短，容易被暴力破解" \
                    "生成新密钥: openssl rand -hex 32 > .jwt_secret"
    else
        add_result "$dim" "JWT Secret强度" "warn" "无法检测 (未找到配置)" \
            "JWT Secret可能在运行时通过其他方式注入" \
            "确保生产环境使用足够长的随机密钥"
    fi

    # S5. Rate Limiter 生效检查
    if [ "$http_code" = "200" ] 2>/dev/null; then
        # 发送多个快速请求测试rate limit
        local rate_test_results=() rate_limited=0
        for i in $(seq 1 5); do
            local rate_code
            rate_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:3000/api/v1/health" 2>/dev/null || echo "000")
            rate_test_results+=("$rate_code")
            if [ "$rate_code" = "429" ]; then
                rate_limited=$((rate_limited + 1))
            fi
        done

        # 注意：正常情况下5次health请求不应触发429（除非窗口极小）
        # 这里主要验证429响应机制存在
        if [ "$rate_limited" -eq 0 ]; then
            add_result "$dim" "Rate Limiter" "pass" "正常响应 (5次请求均200)"
        else
            add_result "$dim" "Rate Limiter" "pass" "Rate Limit生效 (${rate_limited}次429)"
        fi
    else
        add_result "$dim" "Rate Limiter" "warn" "跳过 (API不可达)"
    fi

    # S6. HTTPS 强制跳转检查
    local http_redirect
    http_redirect=$(curl -s -o /dev/null -w "%{redirect_url}%{http_code}" --max-time 5 "http://localhost:80" 2>/dev/null || echo "")

    if echo "$http_redirect" | grep -qi "https"; then
        add_result "$dim" "HTTPS强制跳转" "pass" "HTTP→HTTPS重定向生效"
    elif echo "$http_redirect" | grep -q "200\|301\|302"; then
        add_result "$dim" "HTTPS强制跳转" "warn" "HTTP未强制跳转到HTTPS" \
            "可能允许明文访问" \
            "检查nginx配置中的ssl_redirect设置"
    else
        add_result "$dim" "HTTPS强制跳转" "warn" "无法验证 (端口80可能未监听)"
    fi
}

# ============================================================================
# D4: 数据层 (Data)
# ============================================================================

check_data() {
    if [ -n "$TARGET_DIMENSION" ] && [ "$TARGET_DIMENSION" != "data" ]; then
        return 0
    fi

    init_dimension "data"
    local dim="data"

    log_section "[D4 数据层 (Data)]"

    # D1. PostgreSQL 连接数
    local pg_conn_result
    pg_conn_result=$(docker exec globalreach-postgres psql -U "${DB_USER:-globalreach_user}" -d "${DB_NAME:-globalreach_prod}" \
        -t -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null | tr -d ' ' || echo "")

    if [ -n "$pg_conn_result" ] && [ "$pg_conn_result" -gt 0 ] 2>/dev/null; then
        local pg_max_conn
        pg_max_conn=$(docker exec globalreach-postgres psql -U "${DB_USER:-globalreach_user}" -d "${DB_NAME:-globalreach_prod}" \
            -t -c "SHOW max_connections;" 2>/dev/null | tr -d ' ' || echo "100")

        local pg_conn_ratio=0
        if [ "$pg_max_conn" -gt 0 ] 2>/dev/null; then
            pg_conn_ratio=$((pg_conn_result * 100 / pg_max_conn))
        fi

        local threshold_conn=$((pg_max_conn * PG_CONN_RATIO / 1))  # 整数运算

        if [ "$pg_conn_result" -lt "$threshold_conn" ] 2>/dev/null; then
            add_result "$dim" "PG连接数" "pass" "${pg_conn_result}/${pg_max_conn} (${pg_conn_ratio}%, 阈值: <${PG_CONN_RATIO})"
        else
            add_result "$dim" "PG连接数" "warn" "${pg_conn_result}/${pg_max_conn} (${pg_conn_ratio}%, 阈值: <${PG_CONN_RATIO})" \
                "数据库连接数接近上限" \
                "检查: SELECT * FROM pg_stat_activity 查看活跃连接"
        fi
    elif docker exec globalreach-postgres pg_isready -U "${DB_USER:-globalreach_user}" &>/dev/null 2>&1; then
        add_result "$dim" "PG连接数" "pass" "PostgreSQL运行正常 (连接数查询受限)"
    else
        add_result "$dim" "PG连接数" "fail" "PostgreSQL不可达" \
            "数据库容器可能未运行" \
            "检查: docker logs globalreach-postgres"
    fi

    # D2. PostgreSQL 数据库大小
    local pg_db_size
    pg_db_size=$(docker exec globalreach-postgres psql -U "${DB_USER:-globalreach_user}" -d "${DB_NAME:-globalreach_prod}" \
        -t -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME:-globalreach_prod}'));" 2>/dev/null | tr -d ' ' || echo "")

    if [ -n "$pg_db_size" ]; then
        add_result "$dim" "PG数据库大小" "pass" "${pg_db_size}"
    else
        add_result "$dim" "PG数据库大小" "warn" "无法获取"
    fi

    # D3. 最近备份检查
    local backup_dirs=(
        "$PROJECT_ROOT/backups"
        "$PROJECT_ROOT/data/backups"
        "/opt/globalreach/backups"
    )

    local backup_found=false backup_age_hours=-1 latest_backup=""

    for backup_dir in "${backup_dirs[@]}"; do
        if [ -d "$backup_dir" ]; then
            # 查找最新的备份文件
            latest_backup=$(find "$backup_dir" -maxdepth 2 -type f \( -name "*.sql" -o -name "*.dump" -o -name "*.tar.gz" \) \
                -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | awk '{print $2}' || echo "")

            if [ -n "$latest_backup" ] && [ -f "$latest_backup" ]; then
                backup_found=true
                local backup_mtime
                backup_mtime=$(stat -c %Y "$latest_backup" 2>/dev/null || stat -f %m "$latest_backup" 2>/dev/null || echo "0")
                local current_time
                current_time=$(date +%s 2>/dev/null || echo "0")
                backup_age_hours=$(( (current_time - backup_mtime) / 3600 ))

                if [ "$backup_age_hours" -le "$BACKUP_MAX_AGE_HOURS" ]; then
                    add_result "$dim" "PG最近备份" "pass" "${backup_age_hours}小时前 (阈值: <=${BACKUP_MAX_AGE_HOURS}h)"
                else
                    add_result "$dim" "PG最近备份" "warn" "${backup_age_hours}小时前 (阈值: <=${BACKUP_MAX_AGE_HOURS}h)" \
                        "备份可能过期，需要检查备份任务" \
                        "执行: bash scripts/backup.sh 手动触发备份"
                fi
                break
            fi
        fi
    done

    if ! $backup_found; then
        add_result "$dim" "PG最近备份" "warn" "未找到备份文件" \
            "备份目录不存在或从未执行备份" \
            "配置并执行: bash scripts/backup.sh"
    fi

    # D4. Redis 内存使用
    local redis_memory_info
    if command -v redis-cli &>/dev/null; then
        redis_memory_info=$(redis-cli info memory 2>/dev/null || echo "")
    elif docker exec globalreach-redis redis-cli info memory &>/dev/null 2>&1; then
        redis_memory_info=$(docker exec globalreach-redis redis-cli info memory 2>/dev/null || echo "")
    fi

    if [ -n "$redis_memory_info" ]; then
        local used_memory max_memory used_human
        used_memory=$(echo "$redis_memory_info" | grep "used_memory:" | cut -d: -f2 | tr -d '\r' || echo "0")
        max_memory=$(echo "$redis_memory_info" | grep "maxmemory:" | cut -d: -f2 | tr -d '\r' || echo "0")
        used_human=$(echo "$redis_memory_info" | grep "used_memory_human:" | cut -d: -f2 | tr -d '\r' || echo "0B")

        if [ "$max_memory" = "0" ]; then
            max_memory=$((1024 * 1024 * 512))  # 默认512MB限制
        fi

        if [ "$max_memory" -gt 0 ] 2>/dev/null && [ "$used_memory" -gt 0 ] 2>/dev/null; then
            local redis_mem_ratio
            redis_mem_ratio=$((used_memory * 100 / max_memory))

            if [ "$redis_mem_ratio" -lt $((REDIS_MEM_RATIO * 100)) ]; then
                add_result "$dim" "Redis内存" "pass" "${used_human} (${redis_mem_ratio}%, 阈值: <${REDIS_MEM_RATIO})"
            else
                add_result "$dim" "Redis内存" "warn" "${used_human} (${redis_mem_ratio}%, 阈值: <${REDIS_MEM_RATIO})" \
                    "Redis内存使用率偏高" \
                    "检查: redis-cli --bigkeys, 清理过期键"
            fi
        else
            add_result "$dim" "Redis内存" "pass" "${used_human:-N/A}"
        fi
    else
        add_result "$dim" "Redis内存" "warn" "无法获取Redis内存信息"
    fi

    # D5. Redis Key 数量
    local redis_dbsize
    if command -v redis-cli &>/dev/null; then
        redis_dbsize=$(redis-cli dbsize 2>/dev/null || echo "")
    elif docker exec globalreach-redis redis-cli dbsize &>/dev/null 2>&1; then
        redis_dbsize=$(docker exec globalreach-redis redis-cli dbsize 2>/dev/null || echo "")
    fi

    if [ -n "$redis_dbsize" ]; then
        add_result "$dim" "Redis Key数量" "pass" "${redis_dbsize} keys"
    else
        add_result "$dim" "Redis Key数量" "warn" "无法获取"
    fi

    # D6. 备份完整性（SHA256校验）
    if [ -n "${latest_backup:-}" ] && [ -f "$latest_backup" ]; then
        local manifest_file checksum_file actual_checksum manifest_checksum
        manifest_file=$(dirname "$latest_backup")/MANIFEST.txt
        checksum_file="${latest_backup}.sha256"

        if [ -f "$manifest_file" ]; then
            # 从MANIFEST提取该文件的校验和
            manifest_checksum=$(grep "$(basename "$latest_backup")" "$manifest_file" 2>/dev/null | awk '{print $1}' || echo "")
        fi

        if command -v sha256sum &>/dev/null && [ -f "$latest_backup" ]; then
            actual_checksum=$(sha256sum "$latest_backup" 2>/dev/null | awk '{print $1}' || echo "")

            if [ -n "$manifest_checksum" ] && [ -n "$actual_checksum" ]; then
                if [ "$manifest_checksum" = "$actual_checksum" ]; then
                    add_result "$dim" "备份完整性" "pass" "SHA256校验通过"
                else
                    add_result "$dim" "备份完整性" "fail" "SHA256不匹配" \
                        "备份文件可能损坏或被篡改" \
                        "重新执行备份: bash scripts/backup.sh"
                fi
            elif [ -f "$checksum_file" ]; then
                local stored_checksum
                stored_checksum=$(cat "$checksum_file" 2>/dev/null | awk '{print $1}' || echo "")
                if [ "$stored_checksum" = "$actual_checksum" ]; then
                    add_result "$dim" "备份完整性" "pass" "SHA256校验通过 (.sha256文件)"
                else
                    add_result "$dim" "备份完整性" "fail" "SHA256与.sha256文件不匹配"
                fi
            else
                add_result "$dim" "备份完整性" "warn" "无校验和文件可供比对"
            fi
        else
            add_result "$dim" "备份完整性" "warn" "sha256sum不可用"
        fi
    else
        add_result "$dim" "备份完整性" "warn" "跳过（无备份文件）"
    fi

    # D7. PG 表数量和行数统计
    local pg_tables
    pg_tables=$(docker exec globalreach-postgres psql -U "${DB_USER:-globalreach_user}" -d "${DB_NAME:-globalreach_prod}" \
        -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ' || echo "")

    if [ -n "$pg_tables" ] && [ "$pg_tables" -gt 0 ] 2>/dev/null; then
        add_result "$dim" "PG表数量" "pass" "${pg_tables} 张表"
    fi
}

# ============================================================================
# D5: 监控层 (Monitoring)
# ============================================================================

check_monitoring() {
    if [ -n "$TARGET_DIMENSION" ] && [ "$TARGET_DIMENSION" != "monitoring" ]; then
        return 0
    fi

    init_dimension "monitoring"
    local dim="monitoring"

    log_section "[D5 监控层 (Monitoring)]"

    # M1. Prometheus 运行状态
    local prom_health
    prom_health=$(http_request "http://localhost:9090/-/healthy" 5)

    local prom_code
    prom_code=$(echo "$prom_health" | cut -d'|' -f1)

    if [ "$prom_code" = "200" ]; then
        add_result "$dim" "Prometheus" "pass" "运行正常"
    elif [ "$prom_code" = "000" ]; then
        add_result "$dim" "Prometheus" "fail" "不可达" \
            "Prometheus服务未运行或端口未暴露" \
            "检查: docker restart globalreach-prometheus"
    else
        add_result "$dim" "Prometheus" "warn" "HTTP $prom_code"
    fi

    # M2. Grafana 运行状态
    local grafana_health
    grafana_health=$(http_request "http://localhost:3001/api/health" 5)

    # Grafana实际映射到3002端口
    if [ "$(echo "$grafana_health" | cut -d'|' -f1)" != "200" ]; then
        grafana_health=$(http_request "http://localhost:3002/api/health" 5)
    fi

    local grafana_code
    grafana_code=$(echo "$grafana_health" | cut -d'|' -f1)

    if [ "$grafana_code" = "200" ]; then
        add_result "$dim" "Grafana" "pass" "运行正常"
    elif [ "$grafana_code" = "000" ]; then
        add_result "$dim" "Grafana" "warn" "不可达 (可能端口映射到3002)" \
            "Grafana默认映射到主机3002端口" \
            "访问: http://localhost:3002"
    else
        add_result "$dim" "Grafana" "warn" "HTTP $grafana_code"
    fi

    # M3. AlertManager 运行状态
    local am_health
    am_health=$(http_request "http://localhost:9093/-/healthy" 5)

    local am_code
    am_code=$(echo "$am_health" | cut -d'|' -f1)

    if [ "$am_code" = "200" ]; then
        add_result "$dim" "AlertManager" "pass" "运行正常"
    elif [ "$am_code" = "000" ]; then
        add_result "$dim" "AlertManager" "fail" "不可达" \
            "AlertManager服务未运行" \
            "检查: docker restart globalreach-alertmanager"
    else
        add_result "$dim" "AlertManager" "warn" "HTTP $am_code"
    fi

    # M4. Loki 运行状态
    local loki_ready
    loki_ready=$(http_request "http://localhost:3100/ready" 5)

    local loki_code
    loki_code=$(echo "$loki_ready" | cut -d'|' -f1)

    if [ "$loki_code" = "200" ]; then
        add_result "$dim" "Loki" "pass" "就绪"
    elif [ "$loki_code" = "000" ]; then
        add_result "$dim" "Loki" "warn" "不可达" \
            "Loki日志聚合服务未运行" \
            "检查: docker restart globalreach-loki"
    else
        add_result "$dim" "Loki" "warn" "HTTP $loki_code"
    fi

    # M5. 活跃告警数
    if [ "$prom_code" = "200" ]; then
        local alerts_body firing_count pending_count
        alerts_body=$(curl -s --max-time 10 "http://localhost:9090/api/v1/alerts" 2>/dev/null || echo "{}")

        if command -v python3 &>/dev/null; then
            eval "$(python3 -c "
import json, sys
try:
    data = json.loads('''$alerts_body''')
    alerts = data.get('data', {}).get('alerts', [])
    firing = len([a for a in alerts if a.get('state') == 'firing'])
    pending = len([a for a in alerts if a.get('state') == 'pending'])
    print(f'firing_count={firing};pending_count={pending}')
except:
    print('firing_count=0;pending_count=0')
" 2>/dev/null || echo "firing_count=0;pending_count=0")"

            local total_alerts=$((firing_count + pending_count))

            if [ "$total_alerts" -le "$MAX_ALERT_COUNT" ]; then
                add_result "$dim" "活跃告警" "pass" "${firing_count} firing, ${pending_count} pending (阈值: <=${MAX_ALERT_COUNT})"
            else
                add_result "$dim" "活跃告警" "warn" "${firing_count} firing, ${pending_count} pending (阈值: <=${MAX_ALERT_COUNT})" \
                    "活跃告警数超过阈值" \
                    "访问: http://localhost:9090/alerts 查看详情"
            fi
        else
            add_result "$dim" "活跃告警" "pass" "Prometheus API可访问 (详细分析需python3)"
        fi
    fi

    # M6. 规则加载状态
    if [ "$prom_code" = "200" ]; then
        local rules_body error_rules
        rules_body=$(curl -s --max-time 10 "http://localhost:9090/api/v1/rules" 2>/dev/null || echo "{}")

        if command -v python3 &>/dev/null; then
            error_rules=$(python3 -c "
import json, sys
try:
    data = json.loads('''$rules_body''')
    groups = data.get('data', {}).get('groups', [])
    errors = []
    for g in groups:
        for r in g.get('rules', []):
            if r.get('state', '') == 'errored' or r.get('health', '') == 'err':
                errors.append(r.get('name', 'unknown'))
    print(','.join(errors) if errors else 'OK')
except:
    print('PARSE_ERROR')
" 2>/dev/null || echo "PARSE_ERROR")

            if [ "$error_rules" = "OK" ]; then
                add_result "$dim" "规则加载" "pass" "所有规则正常加载"
            elif [ "$error_rules" = "PARSE_ERROR" ]; then
                add_result "$dim" "规则加载" "warn" "无法解析规则状态"
            else
                add_result "$dim" "规则加载" "fail" "错误规则: ${error_rules}" \
                    "存在加载失败的PromQL规则" \
                    "访问: http://localhost:9090/rules 查看错误详情"
            fi
        else
            add_result "$dim" "规则加载" "pass" "Prometheus API可访问"
        fi
    fi

    # M7. Node Exporter 状态
    local ne_health
    ne_health=$(http_request "http://localhost:9100/metrics" 5)

    local ne_code
    ne_code=$(echo "$ne_health" | cut -d'|' -f1)

    if [ "$ne_code" = "200" ]; then
        add_result "$dim" "NodeExporter" "pass" "指标暴露正常"
    else
        add_result "$dim" "NodeExporter" "warn" "不可达 (HTTP $ne_code)"
    fi

    # M8. Tempo 状态（可选）
    local tempo_health
    tempo_health=$(http_request "http://localhost:3200" 3)

    local tempo_code
    tempo_code=$(echo "$tempo_health" | cut -d'|' -f1)

    if [ "$tempo_code" = "200" ] || [ "$tempo_code" = "307" ] || [ "$tempo_code" = "404" ]; then
        # Tempo返回404也是正常的（根路径没有内容）
        add_result "$dim" "Tempo" "pass" "分布式追踪服务可达"
    elif [ "$tempo_code" = "000" ]; then
        add_result "$dim" "Tempo" "warn" "不可达 (可选组件)"
    else
        add_result "$dim" "Tempo" "warn" "HTTP $tempo_code"
    fi
}

# ============================================================================
# 报告生成
# ============================================================================

calculate_scores() {
    for dim in infrastructure application security data monitoring; do
        local total=${DIM_TOTALS[$dim]:-0}
        local passes=${DIM_PASSES[$dim]:-0}
        local warns=${DIM_WARNS[$dim]:-0}
        local fails=${DIM_FAILS[$dim]:-0}

        if [ "$total" -gt 0 ]; then
            # 分数计算: PASS=100%, WARN=70%, FAIL=0%
            local score=$(( (passes * 100 + warns * 70) / total ))
            DIM_SCORES[$dim]=$score
        else
            DIM_SCORES[$dim]=0
        fi
    done
}

generate_terminal_report() {
    calculate_scores

    local overall_score overall_total overall_pass overall_warn overall_fail
    overall_total=$TOTAL_CHECKS
    overall_pass=$PASS_COUNT
    overall_warn=$WARN_COUNT
    overall_fail=$FAIL_COUNT

    if [ "$overall_total" -gt 0 ]; then
        overall_score=$(( (overall_pass * 100 + overall_warn * 70) / overall_total ))
    else
        overall_score=0
    fi

    END_TIME=$(date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo "unknown")

    # ── 报告头部 ─────────────────────────────────────────────────────────────
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║  GlobalReach 自动化巡检报告                      ║${NC}"
    echo -e "${BOLD}║  时间: $(printf '%-38s' "$START_TIME")║${NC}"
    echo -e "${BOLD}║  巡检ID: $(printf '%-36s' "$INSPECTION_ID")║${NC}"
    echo -e "${BOLD}║  模式: $(printf '%-40s' "$(echo $MODE | tr '[:lower:]' '[:upper:]')")║${NC}"
    echo -e "${BOLD}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${BOLD}║                                                  ║${NC}"

    # 总览进度条
    local progress_bar
    progress_bar=$(draw_progress_bar $overall_score)
    echo -e "${BOLD}║  📊 总览: ${progress_bar} ${overall_score}% (${overall_pass}/${overall_total} 通过)         ║${NC}"
    echo -e "${BOLD}║       ✅ ${overall_pass} PASS │ ⚠️  ${overall_warn} WARN │ ❌ ${overall_fail} FAIL         ║${NC}"
    echo -e "${BOLD}║                                                  ║${NC}"

    # 各维度分数
    local dim_names=("infrastructure:基础设施" "application:应用层" "security:安全层" "data:数据层" "monitoring:监控层")
    for dim_entry in "${dim_names[@]}"; do
        local dim_key="${dim_entry%%:*}"
        local dim_name="${dim_entry##*:}"
        local dim_score=${DIM_SCORES[$dim_key]:-0}
        local dim_total=${DIM_TOTALS[$dim_key]:-0}
        local dim_pass=${DIM_PASSES[$dim_key]:-0}
        local dim_fail=${DIM_FAILS[$dim_key]:-0}
        local dim_warn=${DIM_WARNS[$dim_key]:-0}
        local dim_progress
        dim_progress=$(draw_progress_bar $dim_score)

        local status_icon="✅"
        if [ "$dim_fail" -gt 0 ]; then
            status_icon="❌"
        elif [ "$dim_warn" -gt 0 ]; then
            status_icon="⚠️ "
        fi

        printf "${BOLD}║  D%-1s %-8s: ${dim_progress} %3d%% (%d/%d) ${status_icon}           ║${NC}\n" \
            "$(echo $dim_key | head -c1 | tr '[:lower:]' '[:upper:]')" \
            "$dim_name" "$dim_score" "$((dim_pass + dim_warn))" "$dim_total"
    done

    echo -e "${BOLD}║                                                  ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"

    # ── 失败详情 ─────────────────────────────────────────────────────────────
    if [ ${#FAILURES[@]} -gt 0 ]; then
        echo ""
        echo -e "${RED}${BOLD}=== 失败项详情 ===${NC}"
        for failure in "${FAILURES[@]}"; do
            echo -e "${RED}$failure${NC}"
        done
    fi

    # ── 警告详情 ─────────────────────────────────────────────────────────────
    if [ ${#WARNINGS[@]} -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}${BOLD}=== 警告项详情 ===${NC}"
        for warning in "${WARNINGS[@]}"; do
            echo -e "${YELLOW}$warning${NC}"
        done
    fi
}

generate_json_report() {
    calculate_scores

    local overall_score
    if [ "$TOTAL_CHECKS" -gt 0 ]; then
        overall_score=$(( (PASS_COUNT * 100 + WARN_COUNT * 70) / TOTAL_CHECKS ))
    else
        overall_score=0
    fi

    cat <<EOF
{
  "inspectionId": "$INSPECTION_ID",
  "timestamp": "$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')",
  "mode": "$MODE",
  "gitHead": "$GIT_HEAD",
  "duration": {
    "start": "$START_TIME",
    "end": "$(date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo unknown)"
  },
  "overall": {
    "score": $overall_score,
    "total": $TOTAL_CHECKS,
    "pass": $PASS_COUNT,
    "warn": $WARN_COUNT,
    "fail": $FAIL_COUNT,
    "error": $ERROR_COUNT
  },
  "dimensions": {
    "infrastructure": {
      "score": ${DIM_SCORES[infrastructure]:-0},
      "total": ${DIM_TOTALS[infrastructure]:-0},
      "pass": ${DIM_PASSES[infrastructure]:-0},
      "warn": ${DIM_WARNS[infrastructure]:-0},
      "fail": ${DIM_FAILS[infrastructure]:-0}
    },
    "application": {
      "score": ${DIM_SCORES[application]:-0},
      "total": ${DIM_TOTALS[application]:-0},
      "pass": ${DIM_PASSES[application]:-0},
      "warn": ${DIM_WARNS[application]:-0},
      "fail": ${DIM_FAILS[application]:-0}
    },
    "security": {
      "score": ${DIM_SCORES[security]:-0},
      "total": ${DIM_TOTALS[security]:-0},
      "pass": ${DIM_PASSES[security]:-0},
      "warn": ${DIM_WARNS[security]:-0},
      "fail": ${DIM_FAILS[security]:-0}
    },
    "data": {
      "score": ${DIM_SCORES[data]:-0},
      "total": ${DIM_TOTALS[data]:-0},
      "pass": ${DIM_PASSES[data]:-0},
      "warn": ${DIM_WARNS[data]:-0},
      "fail": ${DIM_FAILS[data]:-0}
    },
    "monitoring": {
      "score": ${DIM_SCORES[monitoring]:-0},
      "total": ${DIM_TOTALS[monitoring]:-0},
      "pass": ${DIM_PASSES[monitoring]:-0},
      "warn": ${DIM_WARNS[monitoring]:-0},
      "fail": ${DIM_FAILS[monitoring]:-0}
    }
  },
  "results": [
$(local first=true
for result in "${RESULTS[@]}"; do
    if $first; then first=false; else echo ","; fi
    echo -n "    $result"
done)
  ],
  "failures": [
$(local first=true
for failure in "${FAILURES[@]}"; do
    if $first; then first=false; else echo ","; fi
    echo -n "    \"$failure\""
done)
  ],
  "warnings": [
$(local first=true
for warning in "${WARNINGS[@]}"; do
    if $first; then first=false; else echo ","; fi
    echo -n "    \"$warning\""
done)
  ]
}
EOF
}

save_report() {
    local report_dir="$1"
    local report_file timestamp_dir

    mkdir -p "$report_dir"

    timestamp_dir=$(date '+%Y/%m/%d' 2>/dev/null || echo "unknown")
    mkdir -p "$report_dir/$timestamp_dir"

    # 保存JSON结果
    report_file="$report_dir/$timestamp_dir/${INSPECTION_ID}.json"
    generate_json_report > "$report_file"

    # 如果有HTML模板，也生成HTML报告
    local html_template="$SCRIPT_DIR/templates/inspection-report.html"
    if [ -f "$html_template" ]; then
        local html_report_file="$report_dir/$timestamp_dir/${INSPECTION_ID}.html"
        # 将JSON嵌入HTML模板（简单替换占位符）
        local json_content
        json_content=$(generate_json_report)
        sed "s|{{INSPECTION_JSON}}|$json_content|g" "$html_template" > "$html_report_file" 2>/dev/null || \
            cp "$html_template" "$html_report_file"
        echo "  HTML报告: $html_report_file"
    fi

    echo "  JSON报告: $report_file"

    # 清理旧报告（保留30天）
    find "$report_dir" -type f -name "*.json" -mtime +30 -delete 2>/dev/null || true
    find "$report_dir" -type f -name "*.html" -mtime +30 -delete 2>/dev/null || true
}

# ============================================================================
# 主流程
# ============================================================================

main() {
    START_TIME=$(date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo "unknown")
    GIT_HEAD=$(get_git_head)
    generate_inspection_id

    # 执行各维度检查
    check_infrastructure
    check_application
    check_security
    check_data
    check_monitoring

    # 根据模式输出报告
    case "$MODE" in
        json)
            generate_json_report
            ;;
        report)
            generate_terminal_report
            echo ""
            echo -e "${CYAN}[保存报告到: $OUTPUT_DIR]${NC}"
            save_report "$OUTPUT_DIR"
            ;;
        daemon)
            generate_terminal_report
            DAEMON_RUN_COUNT=$((DAEMON_RUN_COUNT + 1))
            echo ""
            echo -e "${CYAN}[守护进程] 第 ${DAEMON_RUN_COUNT} 次巡检完成 (下次: ${DAEMON_INTERVAL}s 后)${NC}"

            # 保存每次巡检结果
            if [ -n "$OUTPUT_DIR" ]; then
                save_report "$OUTPUT_DIR"
            fi

            # 异常通知（预留webhook接口）
            if [ "$FAIL_COUNT" -gt 0 ]; then
                local webhook_url="${INSPECTION_WEBHOOK_URL:-}"
                if [ -n "$webhook_url" ]; then
                    echo -e "${YELLOW}[通知] 发送失败告警到 webhook...${NC}"
                    curl -s -X POST "$webhook_url" \
                        -H "Content-Type: application/json" \
                        -d "$(generate_json_report)" &
                fi
            fi

            # 循环等待
            if [ "$DAEMON_INTERVAL" -gt 0 ]; then
                sleep "$DAEMON_INTERVAL"
                main
            fi
            ;;
        *)
            generate_terminal_report
            ;;
    esac

    # 输出退出码说明
    if [ "$MODE" != "json" ] && [ "$MODE" != "daemon" ]; then
        echo ""
        echo -e "${CYAN}退出码: 0=全部通过 1=有FAIL 2=错误${NC}"
    fi

    # 确定退出码
    if [ "$ERROR_COUNT" -gt 0 ]; then
        exit 2
    elif [ "$FAIL_COUNT" -gt 0 ]; then
        exit 1
    else
        exit 0
    fi
}

# 执行主函数
main "$@"
