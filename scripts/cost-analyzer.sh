#!/bin/bash

# ============================================================
# GlobalReach V2.0 — 成本优化分析脚本 (O06)
# Task: S132/O06 — Cost Optimization Dashboard
#
# 用法:
#   ./scripts/cost-analyzer.sh                          # 全量成本分析
#   ./scripts/cost-analyzer.sh --component api           # 单组件分析
#   ./scripts/cost-analyzer.sh --waste                  # 仅显示浪费项
#   ./scripts/cost-analyzer.sh --json                   # JSON输出
#   ./scripts/cost-analyzer.sh --monthly-report          # 月度成本报告
#
# 支持组件: api | postgres | redis | nginx | monitoring | all
# 模式: local(本地部署) | cloud(云端估算)
# ============================================================

set -euo pipefail

# ============================================
# 全局配置
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${PROJECT_ROOT}/data/cost"
REPORT_DIR="${PROJECT_ROOT}/docs/templates"

# 默认配置
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
API_URL="${API_URL:-http://localhost:3000}"
OUTPUT_FORMAT="text"           # text | json
TARGET_COMPONENT="all"         # api | postgres | redis | nginx | monitoring | all
SHOW_WASTE_ONLY=false
GENERATE_MONTHLY_REPORT=false
COST_MODE="local"              # local | cloud

# 本地部署成本参数（可按实际情况调整）
SERVER_POWER_WATTS=150         # 服务器额定功率 (瓦)
ELECTRICITY_PRICE=0.8          # 电价 (元/千瓦时)
SERVER_MONTHLY_DEPRECIATION=500  # 硬件月折旧 (元/月)
STORAGE_COST_PER_GB=0.5        # 存储成本 (元/GB/月)
NETWORK_COST_PER_GB=0.2        # 网络流量成本 (元/GB/月)

# 云端定价参考（2026年估算，基于公开定价）
# AWS
AWS_EC2_T3_MEDIUM_HOURLY=0.0416       # 2vCPU 4GB
AWS_RDS_PG_T3_MEDIUM_HOURLY=0.104     # 2vCPU 4GB PostgreSQL
AWS_ELASTICACHE_T3_MICRO_HOURLY=0.015 # 1vCPU 1GB Redis
AWS_S3_PER_GB_MONTH=0.023             # S3标准存储
AWS_CLOUDWATCH_PER_MILLION=0.03       # CloudWatch指标

# Azure
AZURE_B2MS_HOURLY=0.048               # 2vCPU 8GB VM
AZURE_SQL_BASIC_HOURLY=0.0065         # Basic SQL DB
AZURE_CACHE_C0_HOURLY=0.018          # 250MB Redis Cache
AZURE_BLOB_HOT_PER_GB=0.018          # Blob热存储
AZURE_APP_INSIGHTS_FREE=true          # App Insights免费层

# GCP
GCP_E2_MEDIUM_HOURLY=0.053            # 2vCPU 4GB CE
GCP_CLOUDSQL_DB_GSMALL_HOURLY=0.097  # 1vCPU 1.7GB
GCP_MEMORystore_M1_HOURLY=0.028      # 1GB Redis
GCP_STANDARD_STORAGE_PER_GB=0.02     # 标准存储
GCP_MONITORING_PER_INSTANCE=2.5      # Monitoring实例费

# 颜色定义（终端输出）
RED='\033[0;31m'
ORANGE='\033[0;33m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# 容器资源配置定义（来自 docker-compose.prod.yml）
declare -A CONTAINER_CPU_LIMIT=(
    ["globalreach-api-prod"]="1.0"
    ["globalreach-postgres"]="2.0"
    ["globalreach-redis"]="0.5"
    ["globalreach-nginx-prod"]="0.5"
    ["globalreach-prometheus"]="1.0"
    ["globalreach-grafana"]="0.5"
    ["globalreach-loki"]="1.0"
    ["globalreach-tempo"]="1.0"
    ["globalreach-alertmanager"]="0.25"
    ["globalreach-mailpit"]="0.25"
    ["globalreach-node-exporter"]="0.25"
    ["globalreach-pg-exporter"]="0.125"
    ["globalreach-promtail"]="0.25"
)

declare -A CONTAINER_MEM_LIMIT_MB=(
    ["globalreach-api-prod"]=512
    ["globalreach-postgres"]=2048
    ["globalreach-redis"]=512
    ["globalreach-nginx-prod"]=256
    ["globalreach-prometheus"]=2048
    ["globalreach-grafana"]=512
    ["globalreach-loki"]=1024
    ["globalreach-tempo"]=1024
    ["globalreach-alertmanager"]=128
    ["globalreach-mailpit"]=128
    ["globalreach-node-exporter"]=128
    ["globalreach-pg-exporter"]=128
    ["globalreach-promtail"]=64
)

# 容器分类
declare -A CONTAINER_CATEGORY=(
    ["globalreach-api-prod"]="core"
    ["globalreach-postgres"]="core"
    ["globalreach-redis"]="core"
    ["globalreach-nginx-prod"]="core"
    ["globalreach-prometheus"]="monitoring"
    ["globalreach-grafana"]="monitoring"
    ["globalreach-loki"]="monitoring"
    ["globalreach-tempo"]="monitoring"
    ["globalreach-alertmanager"]="monitoring"
    ["globalreach-mailpit"]="tool"
    ["globalreach-node-exporter"]="monitoring"
    ["globalreach-pg-exporter"]="monitoring"
    ["globalreach-promtail"]="monitoring"
)

# ============================================
# 参数解析
# ============================================

usage() {
    cat <<EOF
GlobalReach V2.0 成本优化分析器 (O06)

用法:
    $0 [选项]

选项:
    --component <name>   指定分析组件 (api|postgres|redis|nginx|monitoring|all)
                         默认: all
    --mode <mode>        成本模式 (local|cloud)
                         默认: local (本地部署)
    --waste              仅显示浪费检测结果
    --json               以JSON格式输出结果
    --monthly-report     生成月度成本报告到 docs/templates/
    --help               显示此帮助信息

示例:
    $0                                    # 全量文本分析
    $0 --component api --waste            # API组件浪费检测
    $0 --mode cloud --json                # 云端成本JSON输出
    $0 --monthly-report                   # 生成月度报告
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --component)
            TARGET_COMPONENT="$2"
            shift 2
            ;;
        --mode)
            COST_MODE="$2"
            shift 2
            ;;
        --waste)
            SHOW_WASTE_ONLY=true
            shift
            ;;
        --json)
            OUTPUT_FORMAT="json"
            shift
            ;;
        --monthly-report)
            GENERATE_MONTHLY_REPORT=true
            shift
            ;;
        --help|-h)
            usage
            ;;
        *)
            echo "未知参数: $1"
            usage
            ;;
    esac
done

# ============================================
# 工具函数
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# 确保数据目录存在
ensure_data_dir() {
    mkdir -p "$DATA_DIR/raw" "$DATA_DIR/aggregated"
}

# Prometheus查询辅助函数
query_prometheus() {
    local query="$1"
    local result
    result=$(curl -sf "${PROMETHEUS_URL}/api/v1/query?query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))")" 2>/dev/null \
        || echo '{"status":"error","data":{"result":[]}}')
    echo "$result"
}

# 从Prometheus结果中提取数值
extract_value() {
    local json="$1"
    echo "$json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('status') == 'success' and data['data']['result']:
        val = float(data['data']['result'][0]['value'][1])
        print(f'{val:.2f}')
    else:
        print('N/A')
except:
    print('N/A')
" 2>/dev/null || echo "N/A"
}

# Docker stats 解析
get_docker_stats() {
    local container_name="$1"
    docker stats --no-stream --format "{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" "$container_name" 2>/dev/null || echo "N/A\tN/A\tN/A\tN/A"
}

# 解析内存使用值（如 "128MiB / 512MiB" → 128）
parse_mem_value() {
    local mem_str="$1"
    echo "$mem_str" | awk -F'/' '{print $1}' | sed 's/[[:space:]]//g' | awk '
        /GiB/{gsub(/GiB/,""); printf "%.0f", $1 * 1024}
        /MiB/{gsub(/MiB/,""); print int($1)}
        /KiB/{gsub(/KiB/,""); printf "%.1f", $1 / 1024}
        /B$/{print int($1)/1048576}
    '
}

# 解析内存限制值（如 "128MiB / 512MiB" → 512）
parse_mem_limit() {
    local mem_str="$1"
    echo "$mem_str" | awk -F'/' '{print $2}' | sed 's/[[:space:]]//g' | awk '
        /GiB/{gsub(/GiB/,""); printf "%.0f", $1 * 1024}
        /MiB/{gsub(/MiB/,""); print int($1)}
        /KiB/{gsub(/KiB/,""); printf "%.1f", $1 / 1024}
        /B$/{print int($1)/1048576}
    '
}

# 解析CPU百分比（如 "12.34%" → 12.34）
parse_cpu_pct() {
    local cpu_str="$1"
    echo "$cpu_str" | tr -d '%'
}

# 获取所有运行中的GlobalReach容器列表
get_running_containers() {
    docker ps --format "{{.Names}}" 2>/dev/null | grep "^globalreach-" || echo ""
}

# 获取容器运行时长（小时）
get_container_uptime_hours() {
    local container_name="$1"
    docker inspect -f '{{.State.StartedAt}}' "$container_name" 2>/dev/null | python3 -c "
import sys, datetime
try:
    started_str = sys.stdin.read().strip()
    if not started_str or started_str == '<no value>':
        print('0')
        sys.exit()
    started = datetime.datetime.fromisoformat(started_str.replace('Z', '+00:00'))
    now = datetime.datetime.now(datetime.timezone.utc)
    hours = (now - started).total_seconds() / 3600
    print(f'{hours:.1f}')
except:
    print('0')
" 2>/dev/null || echo "0"
}

# 获取Docker镜像未使用空间
get_unused_images_size() {
    docker images -f "dangling=true" -q 2>/dev/null | xargs -r docker inspect -f '{{.Size}}' 2>/dev/null \
        | awk '{sum+=$1} END {printf "%.0f", sum/1048576}' || echo "0"
}

# 获取日志目录大小
get_log_dir_size_mb() {
    local log_path="${PROJECT_ROOT}/logs"
    if [[ -d "$log_path" ]]; then
        du -sm "$log_path" 2>/dev/null | cut -f1 || echo "0"
    else
        echo "0"
    fi
}

# 获取备份目录大小
get_backup_size_gb() {
    local backup_path="${PROJECT_ROOT}/backups"
    if [[ -d "$backup_path" ]]; then
        du -sh "$backup_path" 2>/dev/null | awk '{print $1}' | sed 's/G//;s/M//' | awk '/M/{printf "%.2f", $1/1024}; !/M/{print $1}' || echo "0"
    else
        echo "0"
    fi
}

# 获取备份保留天数
get_backup_retention_days() {
    local backup_path="${PROJECT_ROOT}/backups"
    if [[ -d "$backup_path" ]]; then
        find "$backup_path" -maxdepth 1 -type f -mtime +30 2>/dev/null | wc -l
    else
        echo "0"
    fi
}

# ============================================
# 浪费检测引擎
# ============================================

# 存储所有检测到的浪费项
WASTE_ITEMS=()
WASTE_COUNTER=0

# 添加浪费项
add_waste_item() {
    local type="$1"
    local description="$2"
    local impact="$3"
    local saving_cny="$4"
    local recommendation="$5"

    WASTE_COUNTER=$((WASTE_COUNTER + 1))
    WASTE_ITEMS+=("W${WASTE_COUNTER}|${type}|${description}|${impact}|${saving_cny}|${recommendation}")
}

# CPU过配检测：容器CPU limit > 2x 实际峰值
detect_cpu_overprovision() {
    local container_name="$1"
    local cpu_pct_actual="$2"
    local cpu_limit="$3"

    # 将实际使用率转换为相对于limit的比值
    # cpu_limit 是核数，cpu_pct 是百分比
    local actual_cores
    actual_cores=$(echo "$cpu_pct_actual $cpu_limit" | awk '{printf "%.4f", ($1/100) * $2}')

    # 如果实际使用 < limit的50%，判定为过配
    if (( $(echo "$cpu_pct_actual < 10 && $cpu_limit >= 0.5" | bc -l) )); then
        local recommended_limit
        recommended_limit=$(echo "$cpu_limit" | awk '{printf "%.2f", $1 * 0.5}')
        local saving
        saving=$(echo "$cpu_limit $recommended_limit" | awk '{printf "%.2f", ($1-$2)*24*30*0.01}')
        add_waste_item "CPU_OVERPROVISION" \
            "${container_name} CPU过配 (${cpu_limit}→${recommended_limit}核)" \
            "${actual_cores}/${cpu_limit} 核实际使用" \
            "¥${saving}" \
            "降低docker-compose中deploy.resources.limits.cpus至 ${recommended_limit}"
    fi
}

# 内存过配检测：容器MEM limit > 3x 实际RSS
detect_memory_overprovision() {
    local container_name="$1"
    local mem_used_mb="$2"
    local mem_limit_mb="$3"

    if [[ "$mem_used_mb" == "N/A" ]] || [[ "$mem_limit_mb" == "N/A" ]]; then
        return
    fi

    local ratio
    ratio=$(echo "$mem_limit_mb $mem_used_mb" | awk '{if($2>0) printf "%.1f", $1/$2; else print "999"}')

    # 内存使用率低于30%且分配大于128MB，判定为过配
    if (( $(echo "$ratio > 3.0 && $mem_used_mb < 100" | bc -l) )); then
        local recommended_mem
        recommended_mem=$(echo "$mem_used_mb" | awk '{printf "%.0f", $1 * 2}')
        if (( recommended_mem < 64 )); then recommended_mem=64; fi
        local waste_mb=$((mem_limit_mb - recommended_mem))
        local saving
        saving=$(echo "$waste_mb" | awk '{printf "%.1f", $1*0.001*30}')  # 简化估算
        add_waste_item "MEMORY_OVERPROVISION" \
            "${container_name} 内存过配 (${mem_limit_mb}MB→${recommended_mem}MB)" \
            "${waste_mb}MB 浪费空间" \
            "¥${saving}" \
            "降低memory limit至 ${recommended_mem}MB，或调整reservation"
    fi
}

# 空闲容器检测：运行但无请求 > 24h
detect_idle_container() {
    local container_name="$1"
    local category="$2"
    local net_io="$3"
    local uptime_hours="$4"

    # 监控类和工具类容器更容易空闲
    if [[ "$category" == "monitoring" ]] || [[ "$category" == "tool" ]]; then
        # 如果网络IO极低且运行超过48小时
        local io_bytes
        io_bytes=$(echo "$net_io" | awk -F'/' '{print $1}' | tr -d ' B' | numfmt --from=si 2>/dev/null || echo "0")
        if (( $(echo "$uptime_hours > 48" | bc -l) )) && (( $(echo "$io_bytes < 10485760" | bc -l) )); then  # <10MB
            local monthly_cost
            monthly_cost=$(echo "$uptime_hours" | awk '{printf "%.0f", 5}')  # 估算该容器月成本约¥5
            add_waste_item "IDLE_CONTAINER" \
                "${container_name} 空闲(无活跃请求>${uptime_hours}h)" \
                "100% 该容器资源闲置" \
                "¥${monthly_cost}" \
                "考虑按需启动(docker compose up --profile monitoring)或合并部署"
        fi
    fi
}

# 冗余日志检测
detect_redundant_logs() {
    local log_size_mb="$1"

    if (( $(echo "$log_size_mb > 500" | bc -l) )); then
        local extra_mb=$((log_size_mb - 200))
        local saving
        saving=$(echo "$extra_mb" | awk '{printf "%.1f", $1*$STORAGE_COST_PER_GB/1024*12}')
        add_waste_item "REDUNDANT_LOGS" \
            "日志目录过大 (${log_size_mb}MB > 500MB阈值)" \
            "${extra_mb}MB 可清理" \
            "¥${saving}" \
            "减少日志保留时间、启用压缩(logrotate)、设置max-size/max-file"
    fi
}

# 备份冗余检测
detect_redundant_backups() {
    local backup_gb="$1"
    local old_backups_count="$2"

    if (( old_backups_count > 0 )) && (( $(echo "$backup_gb > 5" | bc -l) )); then
        local saving
        saving=$(echo "$backup_gb" | awk '{printf "%.1f", $1*$STORAGE_COST_PER_GB*0.5}')
        add_waste_item "REDUNDANT_BACKUPS" \
            "备份保留过多 (${old_backups_count}个文件>30天, 共${backup_gb}GB)" \
            "${backup_gb}GB 备份存储" \
            "¥${saving}" \
            "调整备份保留策略为30天增量+每周全量"
    fi
}

# 未使用镜像检测
detect_unused_images() {
    local unused_mb="$1"

    if (( unused_mb > 100 )); then
        local saving
        saving=$(echo "$unused_mb" | awk '{printf "%.1f", $1*$STORAGE_COST_PER_GB/1024}')
        add_waste_item "UNUSED_IMAGES" \
            "未使用的Docker镜像 (${unused_mb}MB悬空镜像)" \
            "${unused_mb}MB 磁盘占用" \
            "¥${saving}" \
            "执行 docker image prune -a 或设置cron weekly清理"
    fi
}

# ============================================
# 成本计算模型
# ============================================

# 计算本地模式下的月度成本
calculate_local_monthly_cost() {
    local total_cpu_alloc=0
    local total_mem_alloc_mb=0
    local total_disk_gb=0

    for container in $(get_running_containers); do
        local cpu_limit="${CONTAINER_CPU_LIMIT[$container]:-0.25}"
        local mem_limit="${CONTAINER_MEM_LIMIT_MB[$container]:-128}"

        total_cpu_alloc=$(echo "$total_cpu_alloc $cpu_limit" | awk '{printf "%.2f", $1+$2}')
        total_mem_alloc_mb=$((total_mem_alloc_mb + mem_limit))
    done

    # 磁盘使用
    local disk_output
    disk_output=$(df -h / 2>/dev/null | tail -1 || echo "")
    if [[ -n "$disk_output" ]]; then
        total_disk_gb=$(echo "$disk_output" | awk '{gsub(/G/,"",$2); print $1}')
    fi

    # 计算各项成本
    # 1. 电力成本: 功率(W) × 运行时间(h) × 电价(元/kWh) × 30天
    local power_cost
    power_cost=$(echo "$SERVER_POWER_WATTS $ELECTRICITY_PRICE" | awk '{printf "%.2f", ($1/1000)*24*30*$2}')

    # 2. 硬件折旧
    local depreciation=$SERVER_MONTHLY_DEPRECIATION

    # 3. 存储成本
    local storage_cost
    storage_cost=$(echo "$total_disk_gb $STORAGE_COST_PER_GB" | awk '{printf "%.2f", $1*$2}')

    # 4. 带宽成本（估算）
    local network_cost=$NETWORK_COST_PER_GB

    local total_cost
    total_cost=$(echo "$power_cost $depreciation $storage_cost $network_cost" | awk '{printf "%.2f", $1+$2+$3+$4}')

    echo "{\"power\":${power_cost},\"depreciation\":${depreciation},\"storage\":${storage_cost},\"network\":${network_cost},\"total\":${total_cost},\"cpu_alloc\":${total_cpu_alloc},\"mem_alloc_mb\":${total_mem_alloc_mb},\"disk_gb\":${total_disk_gb}}"
}

# 计算云模式下的月度成本（AWS）
calculate_aws_monthly_cost() {
    local ec2_cost=0
    local rds_cost=0
    local elasticache_cost=0
    local s3_cost=0
    local monitoring_cost=0
    local other_cost=0

    # EC2: API + Nginx + 监控栈 ≈ t3.medium (2vCPU 4GB) × 几个实例
    # API: t3.medium × 744h
    ec2_cost=$(echo "$AWS_EC2_T3_MEDIUM_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # Nginx可以合入EC2或单独t3.small
    local nginx_ec2
    nginx_ec2=$(echo "$AWS_EC2_T3_MEDIUM_HOURLY 744" | awk '{printf "%.2f", $1*$2*0.5}')
    ec2_cost=$(echo "$ec2_cost $nginx_ec2" | awk '{printf "%.2f", $1+$2}')

    # RDS PostgreSQL: db.t3.medium
    rds_cost=$(echo "$AWS_RDS_PG_T3_MEDIUM_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # ElastiCache Redis: cache.t3.micro
    elasticache_cost=$(echo "$AWS_ELASTICACHE_T3_MICRO_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # S3: 备份存储 ~20GB
    s3_cost=$(echo "$AWS_S3_PER_GB_MONTH 20" | awk '{printf "%.2f", $1*$2}')

    # CloudWatch: ~50个指标
    monitoring_cost=$(echo "$AWS_CLOUDWATCH_PER_MILLION 50" | awk '{printf "%.2f", $1*$2/1000000*744}')

    # 其他: ALB, Route53 等
    other_cost=30  # 固定费用估算

    local total
    total=$(echo "$ec2_cost $rds_cost $elasticache_cost $s3_cost $monitoring_cost $other_cost" | awk '{printf "%.2f", $1+$2+$3+$4+$5+$6}')

    echo "{\"ec2\":${ec2_cost},\"rds\":${rds_cost},\"elasticache\":${elasticache_cost},\"s3\":${s3_cost},\"monitoring\":${monitoring_cost},\"other\":${other_cost},\"total_usd\":${total}}"
}

# 计算云模式下的月度成本（Azure）
calculate_azure_monthly_cost() {
    local vm_cost=0
    local sql_cost=0
    local cache_cost=0
    local storage_cost=0
    local other_cost=0

    # VM: B2ms (2vCPU 8GB) — API+Nginx
    vm_cost=$(echo "$AZURE_B2MS_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # SQL Database: Basic tier
    sql_cost=$(echo "$AZURE_SQL_BASIC_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # Redis Cache: C0 basic
    cache_cost=$(echo "$AZURE_CACHE_C0_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # Blob Storage: ~20GB hot
    storage_cost=$(echo "$AZURE_BLOB_HOT_PER_GB 20" | awk '{printf "%.2f", $1*$2}')

    # 其他: Application Gateway等
    other_cost=25

    local total
    total=$(echo "$vm_cost $sql_cost $cache_cost $storage_cost $other_cost" | awk '{printf "%.2f", $1+$2+$3+$4+$5}')

    echo "{\"vm\":${vm_cost},\"sql\":${sql_cost},\"cache\":${cache_cost},\"storage\":${storage_cost},\"other\":${other_cost},\"total_usd\":${total}}"
}

# 计算云模式下的月度成本（GCP）
calculate_gcp_monthly_cost() {
    local ce_cost=0
    local cloudsql_cost=0
    local memorystore_cost=0
    local storage_cost=0
    local monitoring_cost=0
    local other_cost=0

    # Compute Engine: e2-medium (2vCPU 4GB)
    ce_cost=$(echo "$GCP_E2_MEDIUM_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # Cloud SQL: db-g-small
    cloudsql_cost=$(echo "$GCP_CLOUDSQL_DB_GSMALL_HOURLY 744" | awk '{printf "%.2f', $1*$2}')

    # Memorystore: M1 (1GB)
    memorystore_cost=$(echo "$GCP_MEMORystore_M1_HOURLY 744" | awk '{printf "%.2f", $1*$2}')

    # Standard Storage: ~20GB
    storage_cost=$(echo "$GCP_STANDARD_STORAGE_PER_GB 20" | awk '{printf "%.2f", $1*$2}')

    # Cloud Monitoring: per-instance
    monitoring_cost=$GCP_MONITORING_PER_INSTANCE

    # 其他: Load Balancer等
    other_cost=22

    local total
    total=$(echo "$ce_cost $cloudsql_cost $memorystore_cost $storage_cost $monitoring_cost $other_cost" | awk '{printf "%.2f", $1+$2+$3+$4+$5+$6}')

    echo "{\"ce\":${ce_cost},\"cloudsql\":${cloudsql_cost},\"memorystore\":${memorystore_cost},\"storage\":${storage_cost},\"monitoring\":${monitoring_cost},\"other\":${other_cost},\"total_usd\":${total}}"
}

# ============================================
# 组件分析函数
# ============================================

# --- API Node 成本分析 ---
analyze_api_cost() {
    log_info "正在分析 API Node 成本..."

    local container_name="globalreach-api-prod"
    local cpu_pct="N/A"
    local mem_used_mb="N/A"
    local mem_limit_mb=${CONTAINER_MEM_LIMIT_MB[$container_name]:-512}
    local cpu_limit=${CONTAINER_CPU_LIMIT[$container_name]:-1.0}
    local net_io="0B/0B"
    local uptime_hrs=0

    # Docker stats采集
    local stats
    stats=$(get_docker_stats "$container_name" 2>/dev/null || echo "")

    if [[ -n "$stats" && "$stats" != "N/A"* ]]; then
        IFS=$'\t' read -r cpu_str mem_str net_str block_str <<< "$stats"
        cpu_pct=$(parse_cpu_pct "$cpu_str")
        mem_used_mb=$(parse_mem_value "$mem_str")
        net_io="$net_str"
    fi

    uptime_hrs=$(get_container_uptime_hours "$container_name")

    # 计算利用率
    local mem_util="N/A"
    if [[ "$mem_used_mb" != "N/A" ]]; then
        mem_util=$(echo "$mem_used_mb $mem_limit_mb" | awk '{printf "%.1f", ($1/$2)*100}')
    fi

    # 判定状态
    local status_icon="✅"
    if [[ "$cpu_pct" != "N/A" ]] && (( $(echo "$cpu_pct < 5" | bc -l) )); then
        status_icon="⚠️低效"
    elif [[ "$mem_util" != "N/A" ]] && (( $(echo "$mem_util < 30" | bc -l) )); then
        status_icon="⚠️低效"
    fi

    # 执行浪费检测
    detect_cpu_overprovision "$container_name" "$cpu_pct" "$cpu_limit"
    detect_memory_overprovision "$container_name" "$mem_used_mb" "$mem_limit_mb"
    detect_idle_container "$container_name" "core" "$net_io" "$uptime_hrs"

    # 计算该组件在本地模式下的成本占比
    local component_cost
    component_cost=$(echo "$cpu_limit $mem_limit_mb" | awk '{
        cpu_share = $1 / 10 * 86.4    # 电力成本按CPU比例分摊
        mem_share = $2 / 8192 * 500   # 折旧按内存比例分摊
        printf "%.2f", cpu_share + mem_share
    }')

    # JSON输出
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        python3 -c "
import json, datetime
print(json.dumps({
    'component': 'api',
    'container': '${container_name}',
    'category': 'core',
    'timestamp': datetime.datetime.now().isoformat(),
    'metrics': {
        'cpu_percent': ${cpu_pct:-0},
        'cpu_limit_cores': ${cpu_limit},
        'memory_used_mb': ${mem_used_mb:-0},
        'memory_limit_mb': ${mem_limit_mb},
        'memory_utilization_percent': ${mem_util:-0},
        'net_io': '${net_io}',
        'uptime_hours': ${uptime_hrs}
    },
    'cost': {
        'estimated_monthly_cny': ${component_cost},
        'cost_mode': '${COST_MODE}'
    },
    'status': '${status_icon}'
}, indent=2))"
        return
    fi

    # 文本输出
    printf "│ %-18s │ %6s │ %8s/%-5sMB │ %5s%% │ %5s │\n" \
        "api-prod" "${cpu_pct:-N/A}" "${mem_used_mb:-N/A}" "${mem_limit_mb}" "${mem_util:-N/A}" "$status_icon"
}

# --- PostgreSQL 成本分析 ---
analyze_postgres_cost() {
    log_info "正在分析 PostgreSQL 成本..."

    local container_name="globalreach-postgres"
    local cpu_pct="N/A"
    local mem_used_mb="N/A"
    local mem_limit_mb=${CONTAINER_MEM_LIMIT_MB[$container_name]:-2048}
    local cpu_limit=${CONTAINER_CPU_LIMIT[$container_name]:-2.0}
    local net_io="0B/0B"
    local uptime_hrs=0
    local connections="N/A"

    local stats
    stats=$(get_docker_stats "$container_name" 2>/dev/null || echo "")

    if [[ -n "$stats" && "$stats" != "N/A"* ]]; then
        IFS=$'\t' read -r cpu_str mem_str net_str block_str <<< "$stats"
        cpu_pct=$(parse_cpu_pct "$cpu_str")
        mem_used_mb=$(parse_mem_value "$mem_str")
        net_io="$net_str"
    fi

    uptime_hrs=$(get_container_uptime_hours "$container_name")

    # 从Prometheus获取连接数
    local prom_result
    prom_result=$(query_prometheus 'pg_stat_activity_count{datname=~".+"}')
    connections=$(extract_value "$prom_result")

    local mem_util="N/A"
    if [[ "$mem_used_mb" != "N/A" ]]; then
        mem_util=$(echo "$mem_used_mb $mem_limit_mb" | awk '{printf "%.1f", ($1/$2)*100}')
    fi

    local status_icon="✅"
    if [[ "$connections" != "N/A" ]] && (( $(echo "$connections < 10" | bc -l) 2>/dev/null ); then
        status_icon="⚠️低载"
    elif [[ "$cpu_pct" != "N/A" ]] && (( $(echo "$cpu_pct < 5" | bc -l) )); then
        status_icon="⚠️低效"
    fi

    detect_cpu_overprovision "$container_name" "$cpu_pct" "$cpu_limit"
    detect_memory_overprovision "$container_name" "$mem_used_mb" "$mem_limit_mb"
    detect_idle_container "$container_name" "core" "$net_io" "$uptime_hrs"

    local component_cost
    component_cost=$(echo "$cpu_limit $mem_limit_mb" | awk '{
        cpu_share = $1 / 10 * 86.4
        mem_share = $2 / 8192 * 500
        printf "%.2f", cpu_share + mem_share
    }')

    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        python3 -c "
import json, datetime
print(json.dumps({
    'component': 'postgres',
    'container': '${container_name}',
    'category': 'core',
    'timestamp': datetime.datetime.now().isoformat(),
    'metrics': {
        'cpu_percent': ${cpu_pct:-0},
        'cpu_limit_cores': ${cpu_limit},
        'memory_used_mb': ${mem_used_mb:-0},
        'memory_limit_mb': ${mem_limit_mb},
        'memory_utilization_percent': ${mem_util:-0},
        'active_connections': ${connections:-0},
        'net_io': '${net_io}',
        'uptime_hours': ${uptime_hrs}
    },
    'cost': {
        'estimated_monthly_cny': ${component_cost},
        'cost_mode': '${COST_MODE}'
    },
    'status': '${status_icon}'
}, indent=2))"
        return
    fi

    printf "│ %-18s │ %6s │ %8s/%-5sMB │ %5s%% │ %5s │\n" \
        "postgres" "${cpu_pct:-N/A}" "${mem_used_mb:-N/A}" "${mem_limit_mb}" "${mem_util:-N/A}" "$status_icon"
}

# --- Redis 成本分析 ---
analyze_redis_cost() {
    log_info "正在分析 Redis 成本..."

    local container_name="globalreach-redis"
    local cpu_pct="N/A"
    local mem_used_mb="N/A"
    local mem_limit_mb=${CONTAINER_MEM_LIMIT_MB[$container_name]:-512}
    local cpu_limit=${CONTAINER_CPU_LIMIT[$container_name]:-0.5}
    local net_io="0B/0B"
    local uptime_hrs=0
    local keys="N/A"

    local stats
    stats=$(get_docker_stats "$container_name" 2>/dev/null || echo "")

    if [[ -n "$stats" && "$stats" != "N/A"* ]]; then
        IFS=$'\t' read -r cpu_str mem_str net_str block_str <<< "$stats"
        cpu_pct=$(parse_cpu_pct "$cpu_str")
        mem_used_mb=$(parse_mem_value "$mem_str")
        net_io="$net_str"
    fi

    uptime_hrs=$(get_container_uptime_hours "$container_name")

    # Redis INFO获取keys数量
    local redis_info
    redis_info=$(docker exec globalreach-redis redis-cli INFO keyspace 2>/dev/null || echo "")
    if [[ -n "$redis_info" ]]; then
        keys=$(echo "$redis_info" | grep "^db" | awk -F'=' '{sum += $2} END {print sum+0}')
    fi

    local mem_util="N/A"
    if [[ "$mem_used_mb" != "N/A" ]]; then
        mem_util=$(echo "$mem_used_mb $mem_limit_mb" | awk '{printf "%.1f", ($1/$2)*100}')
    fi

    local status_icon="✅"
    if [[ "$keys" != "N/A" ]] && (( keys < 100 )); then
        status_icon="⚠️空闲"
    elif [[ "$cpu_pct" != "N/A" ]] && (( $(echo "$cpu_pct < 2" | bc -l) )); then
        status_icon="⚠️空闲"
    elif [[ "$mem_util" != "N/A" ]] && (( $(echo "$mem_util < 15" | bc -l) )); then
        status_icon="⚠️空闲"
    fi

    detect_cpu_overprovision "$container_name" "$cpu_pct" "$cpu_limit"
    detect_memory_overprovision "$container_name" "$mem_used_mb" "$mem_limit_mb"
    detect_idle_container "$container_name" "core" "$net_io" "$uptime_hrs"

    local component_cost
    component_cost=$(echo "$cpu_limit $mem_limit_mb" | awk '{
        cpu_share = $1 / 10 * 86.4
        mem_share = $2 / 8192 * 500
        printf "%.2f", cpu_share + mem_share
    }')

    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        python3 -c "
import json, datetime
print(json.dumps({
    'component': 'redis',
    'container': '${container_name}',
    'category': 'core',
    'timestamp': datetime.datetime.now().isoformat(),
    'metrics': {
        'cpu_percent': ${cpu_pct:-0},
        'cpu_limit_cores': ${cpu_limit},
        'memory_used_mb': ${mem_used_mb:-0},
        'memory_limit_mb': ${mem_limit_mb},
        'memory_utilization_percent': ${mem_util:-0},
        'key_count': ${keys:-0},
        'net_io': '${net_io}',
        'uptime_hours': ${uptime_hrs}
    },
    'cost': {
        'estimated_monthly_cny': ${component_cost},
        'cost_mode': '${COST_MODE}'
    },
    'status': '${status_icon}'
}, indent=2))"
        return
    fi

    printf "│ %-18s │ %6s │ %8s/%-5sMB │ %5s%% │ %5s │\n" \
        "redis" "${cpu_pct:-N/A}" "${mem_used_mb:-N/A}" "${mem_limit_mb}" "${mem_util:-N/A}" "$status_icon"
}

# --- Nginx 成本分析 ---
analyze_nginx_cost() {
    log_info "正在分析 Nginx 成本..."

    local container_name="globalreach-nginx-prod"
    local cpu_pct="N/A"
    local mem_used_mb="N/A"
    local mem_limit_mb=${CONTAINER_MEM_LIMIT_MB[$container_name]:-256}
    local cpu_limit=${CONTAINER_CPU_LIMIT[$container_name]:-0.5}
    local net_io="0B/0B"
    local uptime_hrs=0

    local stats
    stats=$(get_docker_stats "$container_name" 2>/dev/null || echo "")

    if [[ -n "$stats" && "$stats" != "N/A"* ]]; then
        IFS=$'\t' read -r cpu_str mem_str net_str block_str <<< "$stats"
        cpu_pct=$(parse_cpu_pct "$cpu_str")
        mem_used_mb=$(parse_mem_value "$mem_str")
        net_io="$net_str"
    fi

    uptime_hrs=$(get_container_uptime_hours "$container_name")

    local mem_util="N/A"
    if [[ "$mem_used_mb" != "N/A" ]]; then
        mem_util=$(echo "$mem_used_mb $mem_limit_mb" | awk '{printf "%.1f", ($1/$2)*100}')
    fi

    local status_icon="✅"
    if [[ "$cpu_pct" != "N/A" ]] && (( $(echo "$cpu_pct < 3" | bc -l) )); then
        status_icon="⚠️低效"
    fi

    detect_cpu_overprovision "$container_name" "$cpu_pct" "$cpu_limit"
    detect_memory_overprovision "$container_name" "$mem_used_mb" "$mem_limit_mb"

    local component_cost
    component_cost=$(echo "$cpu_limit $mem_limit_mb" | awk '{
        cpu_share = $1 / 10 * 86.4
        mem_share = $2 / 8192 * 500
        printf "%.2f", cpu_share + mem_share
    }')

    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        python3 -c "
import json, datetime
print(json.dumps({
    'component': 'nginx',
    'container': '${container_name}',
    'category': 'core',
    'timestamp': datetime.datetime.now().isoformat(),
    'metrics': {
        'cpu_percent': ${cpu_pct:-0},
        'cpu_limit_cores': ${cpu_limit},
        'memory_used_mb': ${mem_used_mb:-0},
        'memory_limit_mb': ${mem_limit_mb},
        'memory_utilization_percent': ${mem_util:-0},
        'net_io': '${net_io}',
        'uptime_hours': ${uptime_hrs}
    },
    'cost': {
        'estimated_monthly_cny': ${component_cost},
        'cost_mode': '${COST_MODE}'
    },
    'status': '${status_icon}'
}, indent=2))"
        return
    fi

    printf "│ %-18s │ %6s │ %8s/%-5sMB │ %5s%% │ %5s │\n" \
        "nginx" "${cpu_pct:-N/A}" "${mem_used_mb:-N/A}" "${mem_limit_mb}" "${mem_util:-N/A}" "$status_icon"
}

# --- Monitoring Stack 成本分析 ---
analyze_monitoring_cost() {
    log_info "正在分析 Monitoring Stack 成本..."

    local monitoring_containers=("globalreach-prometheus" "globalreach-grafana" "globalreach-loki" "globalreach-tempo" "globalreach-alertmanager" "globalreach-node-exporter" "globalreach-pg-exporter" "globalreach-promtail")
    local results=""

    for container in "${monitoring_containers[@]}"; do
        local cpu_pct="N/A"
        local mem_used_mb="N/A"
        local mem_limit_mb=${CONTAINER_MEM_LIMIT_MB[$container_name]:-256}
        local cpu_limit=${CONTAINER_CPU_LIMIT[$container_name]:-0.5}
        local net_io="0B/0B"
        local uptime_hrs=0

        local stats
        stats=$(get_docker_stats "$container" 2>/dev/null || echo "")

        if [[ -n "$stats" && "$stats" != "N/A"* ]]; then
            IFS=$'\t' read -r cpu_str mem_str net_str block_str <<< "$stats"
            cpu_pct=$(parse_cpu_pct "$cpu_str")
            mem_used_mb=$(parse_mem_value "$mem_str")
            net_io="$net_str"
        fi

        uptime_hrs=$(get_container_uptime_hours "$container")

        local mem_util="N/A"
        if [[ "$mem_used_mb" != "N/A" ]] && [[ "$mem_limit_mb" != "N/A" ]]; then
            mem_util=$(echo "$mem_used_mb $mem_limit_mb" | awk '{printf "%.1f", ($1/$2)*100}')
        fi

        local short_name="${container#globalreach-}"
        local status_icon="✅"
        if [[ "$cpu_pct" != "N/A" ]] && (( $(echo "$cpu_pct < 5" | bc -l) )); then
            status_icon="⚠️空闲"
        elif [[ "$mem_util" != "N/A" ]] && (( $(echo "$mem_util < 20" | bc -l) )); then
            status_icon="⚠️空闲"
        fi

        detect_cpu_overprovision "$container" "$cpu_pct" "${CONTAINER_CPU_LIMIT[$container]:-0.5}"
        detect_memory_overprovision "$container" "$mem_used_mb" "${CONTAINER_MEM_LIMIT_MB[$container]:-256}"
        detect_idle_container "$container" "monitoring" "$net_io" "$uptime_hrs"

        if [[ "$OUTPUT_FORMAT" == "json" ]]; then
            # JSON模式下逐个输出
            python3 -c "
import json, datetime
print(json.dumps({
    'component': '${short_name}',
    'container': '${container}',
    'category': 'monitoring',
    'timestamp': datetime.datetime.now().isoformat(),
    'metrics': {
        'cpu_percent': ${cpu_pct:-0},
        'cpu_limit_cores': ${CONTAINER_CPU_LIMIT[$container]:-0.5},
        'memory_used_mb': ${mem_used_mb:-0},
        'memory_limit_mb': ${CONTAINER_MEM_LIMIT_MB[$container]:-256},
        'memory_utilization_percent': ${mem_util:-0},
        'uptime_hours': ${uptime_hrs}
    },
    'status': '${status_icon}'
}, indent=2))"
        else
            printf "│ %-18s │ %6s │ %8s/%-5sMB │ %5s%% │ %5s │\n" \
                "$short_name" "${cpu_pct:-N/A}" "${mem_used_mb:-N/A}" "${mem_limit_mb:-N/A}" "${mem_util:-N/A}" "$status_icon"
        fi
    done
}

# ============================================
# 系统级浪费检测
# ============================================

detect_system_waste() {
    log_info "正在执行系统级浪费检测..."

    # 日志冗余
    local log_size
    log_size=$(get_log_dir_size_mb)
    detect_redundant_logs "$log_size"

    # 备份冗余
    local backup_size
    backup_size=$(get_backup_size_gb)
    local old_backups
    old_backups=$(get_backup_retention_days)
    detect_redundant_backups "$backup_size" "$old_backups"

    # 未使用镜像
    local unused_size
    unused_size=$(get_unused_images_size)
    detect_unused_images "$unused_size"
}

# ============================================
# 报告生成
# ============================================

generate_monthly_report() {
    log_info "正在生成月度成本报告..."

    local report_file="${REPORT_DIR}/cost-monthly-report.md"
    local report_date
    report_date=$(date '+%Y-%m-%d %H:%M:%S')

    # 先收集数据到临时文本模式
    local original_format="$OUTPUT_FORMAT"
    OUTPUT_FORMAT="text"

    # 收集所有浪费检测数据
    detect_system_waste

    # 收集各组件数据
    local api_data postgres_data redis_data nginx_data monitoring_data
    api_data=$(analyze_api_cost 2>&1) || true
    postgres_data=$(analyze_postgres_cost 2>&1) || true
    redis_data=$(analyze_redis_cost 2>&1) || true
    nginx_data=$(analyze_nginx_cost 2>&1) || true
    monitoring_data=$(analyze_monitoring_cost 2>&1) || true

    # 计算总成本
    local cost_json
    cost_json=$(calculate_local_monthly_cost)
    local monthly_total
    monthly_total=$(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"total\"]:.2f}')")

    # 计算总节省
    local total_saving=0
    for item in "${WASTE_ITEMS[@]}"; do
        IFS='|' read -r _id _type _desc _impact _saving _rec <<< "$item"
        local saving_val
        saving_val=$(echo "$_saving" | tr -d '¥')
        if [[ -n "$saving_val" ]]; then
            total_saving=$(echo "$total_saving $saving_val" | awk '{printf "%.2f", $1+$2}')
        fi
    done

    local saving_pct
    saving_pct=$(echo "$total_saving $monthly_total" | awk '{if($2>0) printf "%.1f", ($1/$2)*100; else print "0"}')

    OUTPUT_FORMAT="$original_format"

    # 写入报告
    cat > "$report_file" <<REPORT_EOF
# GlobalReach V2.0 月度成本优化报告

**报告日期**: ${report_date}
**分析工具**: scripts/cost-analyzer.sh (O06)
**成本模式**: 本地部署 (On-Premise)

---

## Executive Summary

### 月度成本概览

| 成本类别 | 月费用 (CNY) | 占比 |
|---------|-------------|------|
| 电力成本 | ¥$(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"power\"]:.2f}')") | $(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{(d[\"power\"]/d[\"total\"])*100:.1f}%')") |
| 硬件折旧 | ¥$(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"depreciation\"]:.2f}')") | $(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{(d[\"depreciation\"]/d[\"total\"])*100:.1f}%')") |
| 存储成本 | ¥$(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"storage\"]:.2f}')") | $(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{(d[\"storage\"]/d[\"total\"])*100:.1f}%')") |
| **总计** | **¥${monthly_total}** | 100% |

### 优化潜力

- **预估月节省**: ¥${total_saving} (≈ ${saving_pct}%)
- **浪费项数量**: ${#WASTE_ITEMS[@]}
- **最高优先级**: $(if [[ ${#WASTE_ITEMS[@]} -gt 0 ]]; then echo "${WASTE_ITEMS[0]}" | cut -d'|' -f3; else echo "无"; fi)

---

## 各组件资源利用率

| 容器 | CPU% | 内存(MB) | 利用率 | 状态 |
|------|------|---------|--------|------|
$(echo "$api_data" | head -1)
$(echo "$postgres_data" | head -1)
$(echo "$redis_data" | head -1)
$(echo "$nginx_data" | head -1)
$(echo "$monitoring_data" | head -5)

---

## 浪费检测结果详情

| 编号 | 类型 | 描述 | 影响 | 预估节省 | 建议 |
|------|------|------|------|---------|------|
$(for item in "${WASTE_ITEMS[@]}"; do
    IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
    echo "| ${w_id} | ${w_type} | ${w_desc} | ${w_impact} | ${w_saving} | ${w_rec} |"
done)

---

## 优化建议优先级排序

### P0 — 立即行动 (高ROI)

$(for item in "${WASTE_ITEMS[@]}"; do
    IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
    case "$w_type" in
        MEMORY_OVERPROVISION|IDLE_CONTAINER)
            echo "- [ ] **${w_desc}** — 可节省 ${w_siving}: ${w_rec}"
            ;;
    esac
done)

### P1 — 本周处理

$(for item in "${WASTE_ITEMS[@]}"; do
    IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
    case "$w_type" in
        CPU_OVERPROVISION|UNUSED_IMAGES)
            echo "- [ ] **${w_desc}** — 可节省 ${w_saving}: ${w_rec}"
            ;;
    esac
done)

### P2 — 下周规划

$(for item in "${WASTE_ITEMS[@]}"; do
    IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
    case "$w_type" in
        REDUNDANT_LOGS|REDUNDANT_BACKUPS)
            echo "- [ ] **${w_desc}** — 可节省 ${w_saving}: ${w_rec}"
            ;;
    esac
done)

---

## 云迁移成本参考

如需迁移至云端，请参考 \`cloud-cost-estimator.sh\` 输出的三云厂商对比。

---

## 附录

### 数据来源

- Docker Stats: \`docker stats --no-stream\`
- Prometheus: \`${PROMETHEUS_URL}\`
- 磁盘信息: \`df -h\`
- 日志目录: \`${PROJECT_ROOT}/logs/\`
- 备份目录: \`${PROJECT_ROOT}/backups/\`

### 分析参数

- 服务器功率: ${SERVER_POWER_WATTS}W
- 电价: ¥${ELECTRICITY_PRICE}/kWh
- 月硬件折旧: ¥${SERVER_MONTHLY_DEPRECIATION}
- 存储成本: ¥${STORAGE_COST_PER_GB}/GB/月

---

*报告由 GlobalReach O06 成本优化系统自动生成*
REPORT_EOF

    echo -e "${GREEN}✅ 月度报告已生成: ${report_file}${NC}"
}

# ============================================
# 主程序入口
# ============================================

main() {
    ensure_data_dir

    local report_time
    report_time=$(date '+%Y-%m-%d %H:%M:%S')
    local mode_label="本地部署"
    if [[ "$COST_MODE" == "cloud" ]]; then
        mode_label="云端估算"
    fi

    # 月度报告模式
    if [[ "$GENERATE_MONTHLY_REPORT" == true ]]; then
        generate_monthly_report
        exit 0
    fi

    # 仅显示浪费项模式
    if [[ "$SHOW_WASTE_ONLY" == true ]]; then
        detect_system_waste

        # 对每个组件也做浪费检测
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "api" ]]; then
            analyze_api_cost >/dev/null 2>&1 || true
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "postgres" ]]; then
            analyze_postgres_cost >/dev/null 2>&1 || true
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "redis" ]]; then
            analyze_redis_cost >/dev/null 2>&1 || true
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "nginx" ]]; then
            analyze_nginx_cost >/dev/null 2>&1 || true
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "monitoring" ]]; then
            analyze_monitoring_cost >/dev/null 2>&1 || true
        fi

        # 输出浪费结果
        if [[ "$OUTPUT_FORMAT" == "json" ]]; then
            echo "["
            local first=true
            for item in "${WASTE_ITEMS[@]}"; do
                [[ "$first" == false ]] && echo ","
                first=false
                IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
                python3 -c "
import json
print(json.dumps({
    'id': '${w_id}',
    'type': '${w_type}',
    'description': '${w_desc}',
    'impact': '${w_impact}',
    'estimated_saving_cny': '${w_saving}',
    'recommendation': '${w_rec}'
}, indent=2))"
            done
            echo ""
            echo "]"
        else
            if [[ ${#WASTE_ITEMS[@]} -eq 0 ]]; then
                echo -e "${GREEN}🎉 未检测到明显的资源浪费！系统运行效率良好。${NC}"
            else
                echo ""
                echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
                echo -e "${RED}║  🚨 GlobalReach 浪费检测结果 (#${#WASTE_ITEMS[@]}项)              ║${NC}"
                echo -e "${RED}╠══════════════════════════════════════════════════╣${NC}"
                echo -e "${RED}║  ┌────┬──────────────────┬────────┬───────┐    ║${NC}"
                echo -e "${RED}║  │ #  │ 浪费类型           │ 影响   │ 节省  │    ║${NC}"
                echo -e "${RED}║  ├────┼──────────────────┼────────┼───────┤    ║${NC}"
                for item in "${WASTE_ITEMS[@]}"; do
                    IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
                    echo -e "${RED}║  │ ${w_id} │ ${w_desc} │ ${w_impact} │ ${w_saving} │    ║${NC}"
                done
                echo -e "${RED}║  └────┴──────────────────┴────────┴───────┘    ║${NC}"
                echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
            fi
        fi
        exit 0
    fi

    # ===== 全量分析报告 =====

    # 计算成本
    local cost_json
    cost_json=$(calculate_local_monthly_cost)
    local monthly_total
    monthly_total=$(echo "$cost_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"total\"]:.2f}')")

    # 系统级浪费检测
    detect_system_waste

    # JSON模式输出
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        local json_components="["
        local first_comp=true

        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "api" ]]; then
            [[ "$first_comp" == false ]] && json_components+=","
            first_comp=false
            json_components+="$(analyze_api_cost)"
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "postgres" ]]; then
            [[ "$first_comp" == false ]] && json_components+=","
            first_comp=false
            json_components+="$(analyze_postgres_cost)"
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "redis" ]]; then
            [[ "$first_comp" == false ]] && json_components+=","
            first_comp=false
            json_components+="$(analyze_redis_cost)"
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "nginx" ]]; then
            [[ "$first_comp" == false ]] && json_components+=","
            first_comp=false
            json_components+="$(analyze_nginx_cost)"
        fi
        if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "monitoring" ]]; then
            [[ "$first_comp" == false ]] && json_components+=","
            first_comp=false
            # monitoring是多个容器
            json_components+=$(analyze_monitoring_cost | python3 -c "
import sys, json
lines = sys.stdin.read().strip().split('\n')
objs = [json.loads(l) for l in lines if l.strip().startswith('{')]
print(','.join(objs))
" 2>/dev/null || echo "")
        fi
        json_components+="]"

        # 构建浪费项JSON数组
        local waste_json="["
        local first_waste=true
        for item in "${WASTE_ITEMS[@]}"; do
            [[ "$first_waste" == false ]] && waste_json+=","
            first_waste=false
            IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
            waste_json+=$(python3 -c "
import json
print(json.dumps({
    'id': '${w_id}',
    'type': '${w_type}',
    'description': '${w_desc}',
    'impact': '${w_impact}',
    'estimated_saving_cny': '${w_saving}',
    'recommendation': '${w_rec}'
}))
")
        done
        waste_json+="]"

        # 总节省计算
        local total_saving=0
        for item in "${WASTE_ITEMS[@]}"; do
            IFS='|' read -r _id _type _desc _impact _saving _rec <<< "$item"
            local sv
            sv=$(echo "$_saving" | tr -d '¥' | grep -E '^[0-9.]+' || echo "0")
            total_saving=$(echo "$total_saving $sv" | awk '{printf "%.2f", $1+$2}')
        done

        python3 -c "
import json, datetime
print(json.dumps({
    'report_type': 'full_cost_analysis',
    'timestamp': datetime.datetime.now().isoformat(),
    'analysis_period': '近 7 天',
    'cost_mode': '${COST_MODE}',
    'monthly_cost_estimate': {
        'total_cny': ${monthly_total},
        'breakdown': ${cost_json}
    },
    'components': ${json_components},
    'waste_detection': {
        'total_items': ${#WASTE_ITEMS[@]},
        'items': ${waste_json},
        'total_estimated_saving_cny': ${total_saving}
    },
    'optimization_summary': {
        'potential_monthly_saving_cny': ${total_saving},
        'saving_percentage': f'{(${total_saving}/${monthly_total}*100):.1f}%' if ${monthly_total} > 0 else '0%'
    }
}, indent=2))"
        exit 0
    fi

    # ===== 文本模式输出 =====

    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  GlobalReach 成本优化分析报告                   ║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║  时间: ${report_time}                     ║${NC}"
    echo -e "${CYAN}║  分析周期: 近 7 天                              ║${NC}"
    echo -e "${CYAN}║  模式: ${mode_label}                                ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""

    # 月度成本
    echo -e "${PURPLE}💰 月度估算成本: ¥${monthly_total} (硬件+电力)${NC}"
    echo ""

    # 资源利用率表格
    echo -e "${BLUE}📊 资源利用率总览:${NC}"
    echo -e "┌──────────────────┬───────┬──────────────┬───────┬──────┐"
    echo -e "│ 容器              │ CPU%  │ MEM used/lim │ MEM%  │ 状态  │"
    echo -e "├──────────────────┼───────┼──────────────┼───────┼──────┤"

    if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "api" ]]; then
        analyze_api_cost
    fi
    if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "postgres" ]]; then
        analyze_postgres_cost
    fi
    if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "redis" ]]; then
        analyze_redis_cost
    fi
    if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "nginx" ]]; then
        analyze_nginx_cost
    fi
    if [[ "$TARGET_COMPONENT" == "all" || "$TARGET_COMPONENT" == "monitoring" ]]; then
        analyze_monitoring_cost
    fi

    echo -e "└──────────────────┴───────┴──────────────┴───────┴──────┘"
    echo ""

    # 浪费检测结果
    echo -e "${RED}🚨 浪费检测结果:${NC}"
    if [[ ${#WASTE_ITEMS[@]} -eq 0 ]]; then
        echo -e "  ${GREEN}未检测到明显浪费 ✨${NC}"
    else
        echo -e "  ┌────┬────────────────────────┬────────┬───────┐"
        echo -e "  │ #  │ 浪费类型               │ 影响   │ 节省  │"
        echo -e "  ├────┼────────────────────────┼────────┼───────┤"
        for item in "${WASTE_ITEMS[@]}"; do
            IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
            printf "  │ %-2s │ %-22s │ %-6s │ %-5s │\n" "$w_id" "$w_desc" "$w_impact" "$w_saving"
        done
        echo -e "  └────┴────────────────────────┴────────┴───────┘"
    fi
    echo ""

    # 优化建议
    local total_saving=0
    for item in "${WASTE_ITEMS[@]}"; do
        IFS='|' read -r _id _type _desc _impact _saving _rec <<< "$item"
        local sv
        sv=$(echo "$_saving" | tr -d '¥' | grep -E '^[0-9.]+' || echo "0")
        total_saving=$(echo "$total_saving $sv" | awk '{printf "%.2f", $1+$2}')
    done
    local saving_pct
    saving_pct=$(echo "$total_saving $monthly_total" | awk '{if($2>0) printf "%.1f", ($1/$2)*100; else print "0"}')

    echo -e "${YELLOW}💡 优化建议 (预估月节省: ¥${total_saving}/月 ≈ ${saving_pct}%):${NC}"
    local rec_num=1
    for item in "${WASTE_ITEMS[@]}"; do
        IFS='|' read -r w_id w_type w_desc w_impact w_saving w_rec <<< "$item"
        echo -e "  ${rec_num}. ${w_rec}"
        rec_num=$((rec_num + 1))
    done
    if [[ ${#WASTE_ITEMS[@]} -eq 0 ]]; then
        echo -e "  1. 当前资源配置合理，继续保持监控"
        echo -e "  2. 定期执行成本审查 (建议每周一次)"
    fi
    echo ""

    # 云端对比（如果本地模式）
    if [[ "$COST_MODE" == "local" ]]; then
        echo -e "${BLUE}☁️  云迁移参考: 运行 ./scripts/cloud-cost-estimator.sh 获取详细对比${NC}"
    fi

    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  分析完成 — $(date '+%Y-%m-%d %H:%M:%S')                    ║${NC}"
    echo -e "${CYAN}║  使用 --waste 仅查看浪费项                       ║${NC}"
    echo -e "${CYAN}║  使用 --monthly-report 生成完整月报               ║${NC}"
    echo -e "${CYAN}║  使用 --json 输出机器可读格式                    ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
}

main "$@"
