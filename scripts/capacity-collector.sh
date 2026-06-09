#!/bin/bash

# ============================================================
# GlobalReach V2.0 — 容量数据收集器 (O04)
# Task: S132/O04 — Capacity Planning Automation
#
# 定时数据采集脚本，配合 cron/scheduler 使用
# 从多个数据源采集容量指标，存储为 CSV/JSON
#
# 用法:
#   ./scripts/capacity-collector.sh                    # 单次采集
#   ./scripts/capacity-collector.sh --daemon           # 守护进程模式（持续运行）
#   ./scripts/capacity-collector.sh --interval 300     # 自定义采样间隔（秒）
#   ./scripts/capacity-collector.sh --cleanup          # 清理过期数据
#   ./scripts/capacity-collector.sh --status           # 查看收集状态
#
# 数据保留策略:
#   - 原始数据 (raw/): 90 天
#   - 聚合数据 (aggregated/): 1 年 (每小时聚合)
# ============================================================

set -euo pipefail

# ============================================
# 全局配置
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${PROJECT_ROOT}/data/capacity"
RAW_DIR="${DATA_DIR}/raw"
AGGREGATED_DIR="${DATA_DIR}/aggregated"

# 数据源配置
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
API_URL="${API_URL:-http://localhost:3000}"

# 采样配置
DEFAULT_INTERVAL=300  # 默认5分钟
INTERVAL=$DEFAULT_INTERVAL

# 数据保留期（天）
RAW_RETENTION_DAYS=90
AGGREGATED_RETENTION_DAYS=365

# PID文件（守护进程模式）
PID_FILE="${DATA_DIR}/collector.pid"
LOG_FILE="${DATA_DIR}/collector.log"

# 运行模式
DAEMON_MODE=false
CLEANUP_MODE=false
STATUS_MODE=false

# ============================================
# 参数解析
# ============================================

usage() {
    cat <<EOF
GlobalReach V2.0 容量数据收集器

用法:
    $0 [选项]

选项:
    --daemon             以守护进程模式持续运行（默认间隔 ${DEFAULT_INTERVAL}s）
    --interval <秒>      设置采样间隔（默认: ${DEFAULT_INTERVAL}，即5分钟）
    --cleanup            清理过期的原始数据和聚合数据
    --status             查看收集状态和数据统计
    --help               显示此帮助信息

数据目录: ${DATA_DIR}
  ├── raw/              原始采样数据（CSV，保留 ${RAW_RETENTION_DAYS} 天）
  │   ├── api_metrics.csv
  │   ├── postgresql_metrics.csv
  │   ├── redis_metrics.csv
  │   ├── nginx_metrics.csv
  │   ├── monitoring_metrics.csv
  │   └── disk_metrics.csv
  └── aggregated/       聚合数据（JSON，保留 ${AGGREGATED_RETENTION_DAYS} 天）
      └── hourly/

Cron 配置示例（每5分钟执行一次）:
  */5 * * * * /path/to/scripts/capacity-collector.sh >> /var/log/capacity-collector.log 2>&1

EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --daemon)
            DAEMON_MODE=true
            shift
            ;;
        --interval)
            INTERVAL="$2"
            shift 2
            ;;
        --cleanup)
            CLEANUP_MODE=true
            shift
            ;;
        --status)
            STATUS_MODE=true
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

log() {
    local level="$1"
    shift
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
    
    if [[ "$DAEMON_MODE" == true ]]; then
        echo "$msg" >> "$LOG_FILE"
    else
        echo "$msg"
    fi
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }

# 确保目录结构存在
ensure_dirs() {
    mkdir -p "$RAW_DIR" "$AGGREGATED_DIR/hourly"
}

# 获取当前时间戳（ISO格式）
get_timestamp() {
    date '+%Y-%m-%dT%H:%M:%S'
}

# 获取当前Unix时间戳
get_unix_timestamp() {
    date +%s
# Prometheus查询辅助
query_prometheus() {
    local query="$1"
    local encoded_query
    encoded_query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$query'''))")
    curl -sf --connect-timeout 5 "${PROMETHEUS_URL}/api/v1/query?query=${encoded_query}" 2>/dev/null \
        || echo '{"status":"error","data":{"result":[]}}'
}

# 提取Prometheus查询结果中的数值
extract_prometheus_value() {
    local json="$1"
    echo "$json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('status') == 'success' and data['data']['result']:
        val = float(data['data']['result'][0]['value'][1])
        print(f'{val:.4f}')
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null || echo ""
}

# Docker stats 解析
get_docker_stats() {
    local container_name="$1"
    docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}" "$container_name" 2>/dev/null || echo ""
}

# 解析内存值（MiB/GiB → MB）
parse_mem_mb() {
    local mem_str="$1"
    echo "$mem_str" | awk -F'|' '{print $2}' | awk -F'/' '{print $1}' | sed 's/[[:space:]]//g' | awk '
        /GiB/{gsub(/GiB/,""); printf "%.0f", $1 * 1024}
        /MiB/{gsub(/MiB/,""); print int($1)}
        /KiB/{gsub(/KiB/,""); printf "%.1f", $1 / 1024}
        /B$/{printf "%.2f", $1/1048576}
        {print 0}
    '
}

# 解析CPU百分比
parse_cpu_pct() {
    local cpu_str="$1"
    echo "$cpu_str" | awk -F'|' '{print $1}' | tr -d '%'
}

# CSV安全转义（处理逗号和引号）
csv_escape() {
    local val="$1"
    # 如果包含逗号、引号或换行，用引号包裹并转义内部引号
    if [[ "$val" == *,* || "$val" == *\"* || "$val" == *$'\n'* ]]; then
        val=\"${val//\"/\"\"}\"
    fi
    echo "$val"
}

# 追加一行到CSV文件（如果不存在则创建表头）
append_csv() {
    local file="$1"
    local headers="$2"
    local data="$3"
    
    if [[ ! -f "$file" ]]; then
        echo "$headers" > "$file"
    fi
    
    echo "$data" >> "$file"
}

# ============================================
# 数据采集函数 — API Node
# ============================================

collect_api_metrics() {
    local timestamp
    timestamp=$(get_timestamp)
    local unix_ts
    unix_ts=$(get_unix_timestamp)
    
    # Docker资源使用
    local docker_stats
    docker_stats=$(get_docker_stats "globalreach-api-prod" 2>/dev/null || get_docker_stats "globalreach-api" 2>/dev/null || echo "")
    
    local cpu_pct="0"
    local mem_mb="0"
    
    if [[ -n "$docker_stats" ]]; then
        cpu_pct=$(parse_cpu_pct "$docker_stats")
        mem_mb=$(parse_mem_mb "$docker_stats")
    fi
    
    # Prometheus应用层指标
    local active_conn="0"
    local heap_pct="0"
    local process_mem_bytes="0"
    local event_loop_lag="0"
    local p95_latency="0"
    local qps="0"
    local error_rate="0"
    
    local prom_result
    
    prom_result=$(query_prometheus 'globalreach_active_connections')
    active_conn=$(extract_prometheus_value "$prom_result")
    active_conn="${active_conn:-0}"
    
    prom_result=$(query_prometheus 'globalreach_heap_usage_percent')
    heap_pct=$(extract_prometheus_value "$prom_result")
    heap_pct="${heap_pct:-0}"
    
    prom_result=$(query_prometheus 'globalreach_process_memory_bytes{type="rss"}')
    process_mem_bytes=$(extract_prometheus_value "$prom_result")
    process_mem_bytes="${process_mem_bytes:-0}"
    
    prom_result=$(query_prometheus 'histogram_quantile(0.95, sum(rate(globalreach_api_request_duration_seconds_bucket[5m])))')
    p95_latency=$(extract_prometheus_value "$prom_result")
    p95_latency="${p95_latency:-0}"
    
    prom_result=$(query_prometheus 'sum(rate(globalreach_api_requests_total[5m]))')
    qps=$(extract_prometheus_value "$prom_result")
    qps="${qps:-0}"
    
    # 写入CSV
    local csv_file="${RAW_DIR}/api_metrics.csv"
    local headers="timestamp,unix_timestamp,cpu_percent,memory_mb,active_connections,heap_usage_percent,rss_bytes,p95_latency_ms,qps,error_rate"
    local data="${timestamp},${unix_ts},${cpu_pct},${mem_mb},${active_conn},${heap_pct},${process_mem_bytes},${p95_latency},${qps},${error_rate}"
    
    append_csv "$csv_file" "$headers" "$data"
    log_info "API Node 指标已采集: CPU=${cpu_pct}%, Mem=${mem_mb}MB, Conn=${active_conn}, Heap=${heap_pct}%"
}

# ============================================
# 数据采集函数 — PostgreSQL
# ============================================

collect_postgresql_metrics() {
    local timestamp
    timestamp=$(get_timestamp)
    local unix_ts
    unix_ts=$(get_unix_timestamp)
    
    # Docker资源使用
    local docker_stats
    docker_stats=$(get_docker_stats "globalreach-postgres" 2>/dev/null || echo "")
    
    local cpu_pct="0"
    local mem_mb="0"
    
    if [[ -n "$docker_stats" ]]; then
        cpu_pct=$(parse_cpu_pct "$docker_stats")
        mem_mb=$(parse_mem_mb "$docker_stats")
    fi
    
    # PostgreSQL应用层指标
    local db_connections="0"
    local db_size_bytes="0"
    local db_dead_tuples="0"
    local db_cache_hit_ratio="0"
    local active_queries="0"
    
    # 通过PostgreSQL exporter获取Prometheus指标
    local prom_result
    
    prom_result=$(query_prometheus 'pg_stat_activity_count{datname=~".+"}')
    db_connections=$(extract_prometheus_value "$prom_result")
    db_connections="${db_connections:-0}"
    
    prom_result=$(query_prometheus 'pg_database_size_bytes{datname=~".+"}')
    db_size_bytes=$(extract_prometheus_value "$prom_result")
    db_size_bytes="${db_size_bytes:-0}"
    
    prom_result=$(query_prometheus 'pg_stat_user_tables_n_dead_tup{datname=~".+"}')
    dead_raw=$(extract_prometheus_value "$prom_result")
    db_dead_tuples="${dead_raw:-0}"
    
    # 磁盘使用
    local disk_used_gb="0"
    local disk_total_gb="0"
    local disk_used_pct="0"
    
    local df_output
    df_output=$(docker exec globalreach-postgres df -h /var/lib/postgresql/data 2>/dev/null | tail -1 || echo "")
    if [[ -n "$df_output" ]]; then
        disk_used_gb=$(echo "$df_output" | awk '{gsub(/G/,"",$3); gsub(/M/,"",$3); print $3}')
        disk_total_gb=$(echo "$df_output" | awk '{gsub(/G/,"",$2); gsub(/M/,"",$2); print $2}')
        disk_used_pct=$(echo "$df_output" | awk '{gsub(/%/,"",$5); print $5}')
    fi
    
    # 写入CSV
    local csv_file="${RAW_DIR}/postgresql_metrics.csv"
    local headers="timestamp,unix_timestamp,cpu_percent,memory_mb,active_connections,database_size_bytes,dead_tuples,disk_used_gb,disk_total_gb,disk_used_percent"
    local data="${timestamp},${unix_ts},${cpu_pct},${mem_mb},${db_connections},${db_size_bytes},${db_dead_tuples},${disk_used_gb:-0},${disk_total_gb:-0},${disk_used_pct:-0}"
    
    append_csv "$csv_file" "$headers" "$data"
    log_info "PostgreSQL 指标已采集: CPU=${cpu_pct}%, Mem=${mem_mb}MB, Conn=${db_connections}, Disk=${disk_used_pct}%"
}

# ============================================
# 数据采集函数 — Redis
# ============================================

collect_redis_metrics() {
    local timestamp
    timestamp=$(get_timestamp)
    local unix_ts
    unix_ts=$(get_unix_timestamp)
    
    # Docker资源使用
    local docker_stats
    docker_stats=$(get_docker_stats "globalreach-redis" 2>/dev/null || echo "")
    
    local cpu_pct="0"
    local mem_mb="0"
    
    if [[ -n "$docker_stats" ]]; then
        cpu_pct=$(parse_cpu_pct "$docker_stats")
        mem_mb=$(parse_mem_mb "$docker_stats")
    fi
    
    # Redis INFO命令
    local used_memory="0"
    used_memory_human=""
    local key_count="0"
    local connected_clients="0"
    local total_commands_per_sec="0"
    local evicted_keys="0"
    local expired_keys="0"
    local memory_fragmentation_ratio="0"
    
    local redis_info
    redis_info=$(docker exec globalreach-redis redis-cli INFO memory 2>/dev/null || echo "")
    
    if [[ -n "$redis_info" ]]; then
        used_memory=$(echo "$redis_info" | grep "^used_memory:" | cut -d: -f2 | tr -d '\r' || echo "0")
        used_memory_human=$(echo "$redis_info" | grep "^used_memory_human:" | cut -d: -f2 | tr -d '\r' || echo "0B")
        memory_fragmentation_ratio=$(echo "$redis_info" | grep "^mem_fragmentation_ratio:" | cut -d: -f2 | tr -d '\r' || echo "0")
    fi
    
    local redis_info_keyspace
    redis_info_keyspace=$(docker exec globalreach-redis redis-cli INFO keyspace 2>/dev/null || echo "")
    if [[ -n "$redis_info_keyspace" ]]; then
        key_count=$(echo "$redis_info_keyspace" | grep "^db" | awk -F'=' '{sum += $2} END {print sum+0}')
    fi
    
    local redis_info_clients
    redis_info_clients=$(docker exec globalreach-redis redis-cli INFO clients 2>/dev/null || echo "")
    if [[ -n "$redis_info_clients" ]]; then
        connected_clients=$(echo "$redis_info_clients" | grep "^connected_clients:" | cut -d: -f2 | tr -d '\r' || echo "0")
    fi
    
    local redis_info_stats
    redis_info_stats=$(docker exec globalreach-redis redis-cli INFO stats 2>/dev/null || echo "")
    if [[ -n "$redis_info_stats" ]]; then
        total_commands_per_sec=$(echo "$redis_info_stats" | grep "^instantaneous_ops_per_sec:" | cut -d: -f2 | tr -d '\r' || echo "0")
        evicted_keys=$(echo "$redis_info_stats" | grep "^evicted_keys:" | cut -d: -f2 | tr -d '\r' || echo "0")
        expired_keys=$(echo "$redis_info_stats" | grep "^expired_keys:" | cut -d: -f2 | tr -d '\r' || echo "0")
    fi
    
    # 写入CSV
    local csv_file="${RAW_DIR}/redis_metrics.csv"
    local headers="timestamp,unix_timestamp,cpu_percent,memory_mb,used_memory_bytes,used_memory_human,key_count,connected_clients,ops_per_sec,evicted_keys,expired_keys,fragmentation_ratio"
    local data="${timestamp},${unix_ts},${cpu_pct},${mem_mb},${used_memory},${used_memory_human},${key_count},${connected_clients},${total_commands_per_sec},${evicted_keys},${expired_keys},${memory_fragmentation_ratio}"
    
    append_csv "$csv_file" "$headers" "$data"
    log_info "Redis 指标已采集: CPU=${cpu_pct}%, Mem=${mem_mb}MB, Keys=${key_count}, Clients=${connected_clients}, OPS=${total_commands_per_sec}"
}

# ============================================
# 数据采集函数 — Nginx
# ============================================

collect_nginx_metrics() {
    local timestamp
    timestamp=$(get_timestamp)
    local unix_ts
    unix_ts=$(get_unix_timestamp)
    
    # Docker资源使用
    local docker_stats
    docker_stats=$(get_docker_stats "globalreach-nginx-prod" 2>/dev/null || get_docker_stats "globalreach-nginx" 2>/dev/null || echo "")
    
    local cpu_pct="0"
    local mem_mb="0"
    
    if [[ -n "$docker_stats" ]]; then
        cpu_pct=$(parse_cpu_pct "$docker_stats")
        mem_mb=$(parse_mem_mb "$docker_stats")
    fi
    
    # Nginx stub_status（如果启用）
    local active_connections="0"
    local accepts="0"
    local handled="0"
    local requests="0"
    local reading="0"
    local writing="0"
    local waiting="0"
    
    local stub_status
    stub_status=$(curl -sf http://localhost/nginx_status 2>/dev/null || curl -sf http://localhost:80/nginx_status 2>/dev/null || echo "")
    
    if [[ -n "$stub_status" ]]; then
        active_connections=$(echo "$stub_status" | grep "Active connections:" | awk '{print $3}' || echo "0")
        reads accepts handled requests reading writing waiting <<< "$(echo "$stub_status" | grep -E "^[0-9]" | head -1 || echo "0 0 0 0 0 0")"
    fi
    
    # 写入CSV
    local csv_file="${RAW_DIR}/nginx_metrics.csv"
    local headers="timestamp,unix_timestamp,cpu_percent,memory_mb,active_connections,accepts,handled,requests,reading,writing,waiting"
    local data="${timestamp},${unix_ts},${cpu_pct},${mem_mb},${active_connections},${accepts:-0},${handled:-0},${requests:-0},${reading:-0},${writing:-0},${waiting:-0}"
    
    append_csv "$csv_file" "$headers" "$data"
    log_info "Nginx 指标已采集: CPU=${cpu_pct}%, Mem=${mem_mb}MB, Conn=${active_connections}, Reqs=${requests}"
}

# ============================================
# 数据采集函数 — Monitoring Stack
# ============================================

collect_monitoring_metrics() {
    local timestamp
    timestamp=$(get_timestamp)
    local unix_ts
    unix_ts=$(get_unix_timestamp)
    
    local monitoring_containers=(
        "globalreach-prometheus"
        "globalreach-grafana"
        "globalreach-loki"
        "globalreach-promtail"
        "globalreach-tempo"
        "globalreach-alertmanager"
    )
    
    local total_cpu="0"
    local total_mem="0"
    local container_count=0
    local container_details=""
    
    for container in "${monitoring_containers[@]}"; do
        local stats
        stats=$(get_docker_stats "$container" 2>/dev/null || echo "")
        
        if [[ -n "$stats" ]]; then
            local c_cpu
            c_cpu=$(parse_cpu_pct "$stats")
            local c_mem
            c_mem=$(parse_mem_mb "$stats")
            
            total_cpu=$(python3 -c "print(f'{float('$total_cpu') + float('$c_cpu'):.2f}')")
            total_mem=$(python3 -c "print(f'{float('$total_mem') + float('$c_mem'):.1f}')")
            container_count=$((container_count + 1))
            container_details+="|${container}:${c_cpu}:${c_mem}"
        fi
    done
    
    # Prometheus TSDB大小
    local tsdb_size="0"
    tsdb_size=$(curl -sf "${PROMETHEUS_URL}/api/v1/status/tsdb" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('data', {}).get('headStats', {}).get('numBytes', 0))
except:
    print(0)
" 2>/dev/null || echo "0")
    
    # 写入CSV
    local csv_file="${RAW_DIR}/monitoring_metrics.csv"
    local headers="timestamp,unix_timestamp,total_cpu_percent,total_memory_mb,container_count,tsdb_size_bytes,container_details"
    local data="${timestamp},${unix_ts},${total_cpu},${total_mem},${container_count},${tsdb_size},${container_details}"
    
    append_csv "$csv_file" "$headers" "$data"
    log_info "Monitoring Stack 指标已采集: TotalCPU=${total_cpu}%, TotalMem=${total_mem}MB, Containers=${container_count}"
}

# ============================================
# 数据采集函数 — 全局磁盘
# ============================================

collect_disk_metrics() {
    local timestamp
    timestamp=$(get_timestamp)
    local unix_ts
    unix_ts=$(get_unix_timestamp)
    
    # 主分区信息
    local filesystem="N/A"
    local size_gb="0"
    local used_gb="0"
    local avail_gb="0"
    local used_pct="0"
    local mounted_on="/"
    
    local df_output
    df_output=$(df -h / 2>/dev/null | tail -1 || echo "")
    
    if [[ -n "$df_output" ]]; then
        read -r filesystem size used avail use_pct mounted <<< "$df_output"
        size_gb=$(echo "$size" | sed 's/G//;s/M//' | awk '/M/{printf "%.1f", $1/1024}; !/M/{print $1}')
        used_gb=$(echo "$used" | sed 's/G//;s/M//' | awk '/M/{printf "%.1f", $1/1024}; !/M/{print $1}')
        avail_gb=$(echo "$avail" | sed 's/G//;s/M//' | awk '/M/{printf "%.1f", $1/1024}; !/M/{print $1}')
        used_pct=$(echo "$use_pct" | tr -d '%')
    fi
    
    # Docker磁盘使用
    local docker_images_size="0"
    local docker_containers_size="0"
    local docker_volumes_size="0"
    local docker_cache_size="0"
    
    local docker_df
    docker_df=$(docker system df --format '{{.Size}}|{{.Type}}' 2>/dev/null || echo "")
    if [[ -n "$docker_df" ]]; then
        docker_images_size=$(echo "$docker_df" | grep "|Images$" | cut -d'|' -f1 | head -1 || echo "0")
        docker_containers_size=$(echo "$docker_df" | grep "|Containers$" | cut -d'|' -f1 | head -1 || echo "0")
        docker_volumes_size=$(echo "$docker_df" | grep "|Local Volumes$" | cut -d'|' -f1 | head -1 || echo "0")
        docker_cache_size=$(echo "$docker_df" | grep "|Build Cache$" | cut -d'|' -f1 | head -1 || echo "0")
    fi
    
    # Inode使用情况
    local inode_used_pct="0"
    local inode_df
    inode_df=$(df -i / 2>/dev/null | tail -1 || echo "")
    if [[ -n "$inode_df" ]]; then
        inode_used_pct=$(echo "$inode_df" | awk '{gsub(/%/,"",$5); print $5}')
    fi
    
    # 写入CSV
    local csv_file="${RAW_DIR}/disk_metrics.csv"
    local headers="timestamp,unix_timestamp,filesystem,size_gb,used_gb,avail_gb,used_percent,inodes_used_percent,docker_images,docker_containers,docker_volumes,docker_cache"
    local data="${timestamp},${unix_ts},${filesystem},${size_gb},${used_gb},${avail_gb},${used_pct},${inode_used_pct:-0},${docker_images_size},${docker_containers_size},${docker_volumes_size},${docker_cache_size}"
    
    append_csv "$csv_file" "$headers" "$data"
    log_info "Disk 指标已采集: Used=${used_gb}/${size_gb}GB (${used_pct}%), Inodes=${inode_used_pct}%"
}

# ============================================
# 数据聚合（每小时汇总）
# ============================================

aggregate_hourly() {
    local current_hour
    current_hour=$(date '+%Y-%m-%dT%H:00:00')
    local agg_file="${AGGREGATED_DIR/hourly/hourly_${current_hour}.json"
    
    # 如果当前小时的聚合文件已存在且不满1小时，跳过
    if [[ -f "$agg_file" ]]; then
        local file_age_min
        file_age_min=$(( ($(date +%s) - $(stat -c %Y "$agg_file" 2>/dev/null || echo "0")) / 60 ))
        if [[ "$file_age_min" -lt 55 ]]; then
            return 0  # 距离上次聚合不到55分钟
        fi
    fi
    
    log_info "正在生成小时聚合数据..."
    
    # 对每个组件进行聚合
    local aggregated_data="{"
    aggregated_data+="\"generated_at\":\"$(get_timestamp)\","
    aggregated_data+="\"hour\":\"${current_hour}\","
    aggregated_data+="\"components\":{"
    
    local first_component=true
    
    # API聚合
    local api_csv="${RAW_DIR}/api_metrics.csv"
    if [[ -f "$api_csv" ]] && [[ $(wc -l < "$api_csv") -gt 1 ]]; then
        [[ "$first_component" == false ]] && aggregated_data+=","
        first_component=false
        
        local api_agg
        api_agg=$(tail -12 "$api_csv" 2>/dev/null | awk -F',' '
        NR>1 {
            cpu_sum += $3; mem_sum += $4; conn_sum += $5; heap_sum += $6; rss_sum += $7; p95_sum += $8; qps_sum += $9; n++
        }
        END {
            if(n>0) printf "\"api\":{\"samples\":%d,\"avg_cpu\":%.2f,\"avg_memory\":%.2f,\"max_connections\":%.0f,\"avg_heap\":%.2f,\"avg_p95_latency\":%.4f,\"avg_qps\":%.2f}", n, cpu_sum/n, mem_sum/n, conn_sum, heap_sum/n, p95_sum/n, qps_sum/n
        }')
        
        aggregated_data+="$api_agg"
    fi
    
    # PostgreSQL聚合
    local pg_csv="${RAW_DIR}/postgresql_metrics.csv"
    if [[ -f "$pg_csv" ]] && [[ $(wc -l < "$pg_csv") -gt 1 ]]; then
        [[ "$first_component" == false ]] && aggregated_data+=","
        first_component=false
        
        local pg_agg
        pg_agg=$(tail -12 "$pg_csv" 2>/dev/null | awk -F',' '
        NR>1 {
            cpu_sum += $3; mem_sum += $4; conn_sum += $5; disk_pct_sum += $10; n++
        }
        END {
            if(n>0) printf "\"postgresql\":{\"samples\":%d,\"avg_cpu\":%.2f,\"avg_memory\":%.2f,\"avg_connections\":%.0f,\"avg_disk_pct\":%.2f}", n, cpu_sum/n, mem_sum/n, conn_sum, disk_pct_sum/n
        }')
        
        aggregated_data+="$pg_agg"
    fi
    
    # Redis聚合
    local redis_csv="${RAW_DIR}/redis_metrics.csv"
    if [[ -f "$redis_csv" ]] && [[ $(wc -l < "$redis_csv") -gt 1 ]]; then
        [[ "$first_component" == false ]] && aggregated_data+=","
        first_component=false
        
        local redis_agg
        redis_agg=$(tail -12 "$redis_csv" 2>/dev/null | awk -F',' '
        NR>1 {
            cpu_sum += $3; mem_sum += $4; keys_sum += $6; clients_sum += $7; ops_sum += $8; frag_sum += $12; n++
        }
        END {
            if(n>0) printf "\"redis\":{\"samples\":%d,\"avg_cpu\":%.2f,\"avg_memory\":%.2f,\"avg_keys\":%.0f,\"avg_clients\":%.0f,\"avg_ops\":%.2f,\"avg_frag_ratio\":%.2f}", n, cpu_sum/n, mem_sum/n, keys_sum, clients_sum, ops_sum/n, frag_sum/n
        }')
        
        aggregated_data+="$redis_agg"
    fi
    
    # 磁盘聚合
    local disk_csv="${RAW_DIR}/disk_metrics.csv"
    if [[ -f "$disk_csv" ]] && [[ $(wc -l < "$disk_csv") -gt 1 ]]; then
        [[ "$first_component" == false ]] && aggregated_data+=","
        first_component=false
        
        local disk_agg
        disk_agg=$(tail -12 "$disk_csv" 2>/dev/null | awk -F',' '
        NR>1 {
            used_sum += $5; pct_sum += $7; inode_sum += $8; n++
        }
        END {
            if(n>0) printf \"disk\\":{\"samples\\":%d,\\\"avg_used_gb\\\":%.2f,\\\"avg_used_pct\\\":%.2f,\\\"avg_inode_pct\\\":%.2f}\\", n, used_sum/n, pct_sum/n, inode_sum/n
        }')
        
        aggregated_data+="$disk_agg"
    fi
    
    aggregated_data+="}}"
    
    echo "$aggregated_data" | python3 -c "
import sys, json
try:
    raw = sys.stdin.read()
    # 修复可能的不完整JSON
    print(json.dumps(json.loads(raw), indent=2))
except Exception as e:
    print('{\"error\": str(e)}')
" > "$agg_file" 2>/dev/null || echo "{}" > "$agg_file"
    
    log_info "小时聚合完成: ${agg_file}"
}

# ============================================
# 数据清理
# ============================================

cleanup_old_data() {
    log_info "开始清理过期数据..."
    
    local cleaned_files=0
    local freed_space=0
    
    # 清理原始数据（超过保留期的）
    if [[ -d "$RAW_DIR" ]]; then
        while IFS= read -r -d '' file; do
            local file_age_days
            file_age_days=$(( ($(date +%s) - $(stat -c %Y "$file")) / 86400 ))
            
            if [[ "$file_age_days" -gt "$RAW_RETENTION_DAYS" ]]; then
                local file_size
                file_size=$(stat -c%s "$file" 2>/dev/null || echo "0")
                rm -f "$file"
                cleaned_files=$((cleaned_files + 1))
                freed_space=$((freed_space + file_size))
            fi
        done < <(find "$RAW_DIR" -name "*.csv" -type f -print0 2>/dev/null)
    fi
    
    # 清理聚合数据（超过保留期的）
    if [[ -d "${AGGREGATED_DIR}/hourly" ]]; then
        while IFS= read -r -d '' file; do
            local file_age_days
            file_age_days=$(( ($(date +%s) - $(stat -c %Y "$file")) / 86400 ))
            
            if [[ "$file_age_days" -gt "$AGGREGATED_RETENTION_DAYS" ]]; then
                local file_size
                file_size=$(stat -c%s "$file" 2>/dev/null || echo "0")
                rm -f "$file"
                cleaned_files=$((cleaned_files + 1))
                freed_space=$((freed_space + file_size))
            fi
        done < <(find "${AGGREGATED_DIR}/hourly" -name "*.json" -type f -print0 2>/dev/null)
    fi
    
    local freed_mb
    freed_mb=$((freed_space / 1048576))
    log_info "清理完成: 删除 ${cleaned_files} 个文件, 释放 ${freed_mb}MB 空间"
}

# ============================================
# 状态查看
# ============================================

show_status() {
    echo "================================================"
    echo "  GlobalReach 容量数据收集器状态"
    echo "================================================"
    echo ""
    echo "📁 数据目录: ${DATA_DIR}"
    echo "⏱️  采样间隔: ${INTERVAL}s"
    echo "📊 原始数据保留: ${RAW_RETENTION_DAYS} 天"
    echo "📈 聚合数据保留: ${AGGREGATED_RETENTION_DAYS} 天"
    echo ""
    
    # 各组件数据统计
    echo "--- 原始数据统计 ---"
    for component in api postgresql redis nginx monitoring disk; do
        local csv_file="${RAW_DIR}/${component}_metrics.csv"
        if [[ -f "$csv_file" ]]; then
            local line_count
            line_count=$(wc -l < "$csv_file")
            local first_line
            first_line=$(head -1 "$csv_file")
            local last_line
            last_line=$(tail -1 "$csv_file")
            local last_timestamp
            last_timestamp=$(echo "$last_line" | cut -d',' -f1)
            local file_size
            file_size=$(du -h "$csv_file" | cut -f1)
            
            echo "  ✅ ${component}: ${line_count} 条记录, 最后更新: ${last_timestamp}, 大小: ${file_size}"
        else
            echo "  ⚪ ${component}: 无数据"
        fi
    done
    
    echo ""
    echo "--- 聚合数据统计 ---"
    local hourly_count
    hourly_count=$(find "${AGGREGATED_DIR}/hourly" -name "*.json" -type f 2>/dev/null | wc -l)
    echo "  小时聚合文件: ${hourly_count} 个"
    
    # 守护进程状态
    echo ""
    echo "--- 守护进程状态 ---"
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null || echo "unknown")
        if kill -0 "$pid" 2>/dev/null; then
            echo "  🟢 运行中 (PID: ${pid})"
        else
            echo "  🔴 进程不存在 (残留PID文件)"
        fi
    else
        echo "  ⚪ 未运行"
    fi
    
    echo ""
    echo "--- 磁盘使用 ---"
    du -sh "$DATA_DIR" 2>/dev/null || echo "  无法访问"
}

# ============================================
# 单次全量采集
# ============================================

collect_all() {
    log_info "========== 开始容量数据采集 =========="
    
    collect_api_metrics
    collect_postgresql_metrics
    collect_redis_metrics
    collect_nginx_metrics
    collect_monitoring_metrics
    collect_disk_metrics
    
    # 尝试生成聚合（每小时的最后一次采集时触发）
    aggregate_hourly
    
    log_info "========== 容量数据采集完成 =========="
}

# ============================================
# 守护进程模式
# ============================================

run_daemon() {
    ensure_dirs
    
    log_info "启动容量数据收集器守护进程 (间隔: ${INTERVAL}s)"
    echo $$ > "$PID_FILE"
    
    # 注册退出处理
    trap 'log_info "收到终止信号，正在关闭..."; rm -f "$PID_FILE"; exit 0' SIGTERM SIGINT
    
    # 首次立即采集
    collect_all
    
    # 循环采集
    while true; do
        sleep "$INTERVAL"
        
        # 检查是否仍应运行
        if [[ ! -f "$PID_FILE" ]]; then
            log_info "PID文件已删除，退出守护进程"
            break
        fi
        
        collect_all
    done
}

# ============================================
# 主程序入口
# ============================================

main() {
    ensure_dirs
    
    # 处理特殊模式
    if [[ "$CLEANUP_MODE" == true ]]; then
        cleanup_old_data
        exit 0
    fi
    
    if [[ "$STATUS_MODE" == true ]]; then
        show_status
        exit 0
    fi
    
    if [[ "$DAEMON_MODE" == true ]]; then
        run_daemon
        exit 0
    fi
    
    # 默认：单次采集
    collect_all
}

main "$@"
