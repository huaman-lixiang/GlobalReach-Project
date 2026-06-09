#!/bin/bash

# ============================================================
# GlobalReach V2.0 — 云成本估算器 (O06)
# Task: S132/O06 — Cost Optimization Dashboard
#
# 将当前 GlobalReach 基础设施资源映射到三大云服务商定价模型
# 支持 AWS / Azure / GCP 三云对比
# 包含 Reserved Instance vs On-Demand 对比
# 含 Free Tier 利用度分析
#
# 用法:
#   ./scripts/cloud-cost-estimator.sh                    # 三云全量对比
#   ./scripts/cloud-cost-estimator.sh --provider aws      # 仅AWS
#   ./scripts/cloud-cost-estimator.sh --json              # JSON输出
#   ./scripts/cloud-cost-estimator.sh --reserved          # 包含RI对比
#   ./scripts/cloud-cost-estimator.sh --detailed          # 详细分解（含每个组件）
# ============================================================

set -euo pipefail

# ============================================
# 全局配置
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUTPUT_FORMAT="text"
TARGET_PROVIDER="all"       # all | aws | azure | gcp
SHOW_RESERVED=false
SHOW_DETAILED=false

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# ============================================
# 云定价数据 (2026年估算值, 基于公开定价API)
# 所有价格为 USD/月, 除非特别标注
# ============================================

# ---- AWS 定价 (us-east-1 区域) ----

# EC2 On-Demand 每小时价格
AWS_EC2_T3_NANO=0.0058        # 2vCPU 0.5GB
AWS_EC2_T3_MICRO=0.0116       # 2vCPU 1GB
AWS_EC2_T3_SMALL=0.023        # 2vCPU 2GB
AWS_EC2_T3_MEDIUM=0.0416      # 2vCPU 4GB
AWS_EC2_T3_LARGE=0.0832       # 2vCPU 8GB
AWS_EC2_T3_XLARGE=0.1664      # 4vCPU 16GB

# EC2 Reserved (1年无预付) 折扣率
AWS_RI_1Y_NOUPFRONT_DISCOUNT=0.30   # 30%折扣
AWS_RI_3Y_NOUPFRONT_DISCOUNT=0.58   # 58%折扣
AWS_RI_1Y_PARTIAL_DISCOUNT=0.40     # 40%折扣(部分预付)
AWS_RI_3Y_ALL_DISCOUNT=0.66         # 66%折扣(全预付)

# RDS PostgreSQL On-Demand
AWS_RDS_T3_MICRO=0.0175             # 2vCPU 1GB
AWS_RDS_T3_SMALL=0.035              # 2vCPU 2GB
AWS_RDS_T3_MEDIUM=0.07              # 2vCPU 4GB

# ElastiCache Redis
AWS_ELASTICACHE_T3_MICRO=0.015      # 1vCPU 1GB
AWS_ELASTICACHE_M6G_LARGE=0.22      # 2vCPU 13GB

# 存储
AWS_EBS_GP3_PER_GB_MONTH=0.08       # GP3 SSD
AWS_S3_STANDARD_PER_GB_MONTH=0.023  # S3标准
AWS_S3_IA_PER_GB_MONTH=0.0125       # S3 IA
AWS_BACKUP_PER_GB_MONTH=0.023       # AWS Backup to S3

# 网络
AWS_DATA_TRANSFER_OUT_PER_GB=0.09   # 出站流量(前100GB/月免费)

# 监控
AWS_CLOUDWATCH_METRICS_PER_MILLION=0.03
AWS_CLOUDWATCH_LOGS_INGEST_PER_GB=0.50
AWS_CLOUDWATCH_LOGS_STORAGE_PER_GB=0.03

# ALB
AWS_ALB_PER_LCU_HOUR=0.009         # Application Load Balancer
AWS_ALB_BASE_HOURS=745              # 月基础小时数

# ---- Azure 定价 (eastus 区域) ----

# VM On-Demand 每小时价格
AZURE_B1S=0.0104                    # 1vCPU 1GB
AZURE_B1MS=0.0208                   # 2vCPU 2GB
AZURE_B2S=0.04                      # 2vCPU 4GB
AZURE_B2MS=0.048                    # 2vCPU 8GB
AZURE_D2S_V3=0.134                  # 2vCPU 8GB
AZURE_D4S_V3=0.268                  # 4vCPU 16GB

# Azure Reserved Instance 折扣率
AZURE_RI_1Y_DISCOUNT=0.35           # 35%
AZURE_RI_3Y_DISCOUNT=0.55           # 55%

# Azure SQL Database
AZURE_SQL_BASIC=0.0065              # Basic: 2vCPU 250MB? 5DTU
AZURE_SQL_S0=0.015                  # Standard S0: 10 DTU
AZURE_SQL_S1=0.043                  # Standard S1: 20 DTU
AZURE_SQL_S2=0.09                   # Standard S2: 50 DTU

# Azure Cache for Redis
AZURE_CACHE_C0=0.018                # Basic C0: 250MB
AZURE_CACHE_C1=0.055                # Basic C1: 1GB
AZURE_CACHE_C2=0.11                 # Standard C2: 2.5GB
AZURE_CACHE_P1=0.295                # Premium P1: 6GB

# 存储
AZURE_MANAGED_DISK_P10=4.5          # 128GB Premium SSD/月
AZURE_MANAGED_DISK_P15=18.75        # 256GB Premium SSD/月
AZURE_MANAGED_DISK_P20=37.50        # 512GB Premium SSD/月
AZURE_BLOB_HOT_PER_GB=0.018         # Blob Hot
AZURE_BLOB_COOL_PER_GB=0.01         # Blob Cool

# 网络
AZURE_DATA_TRANSFER_FIRST_5TB_PER_GB=0.087

# 监控
AZURE_APP_INSIGHTS_FREE_QUOTA_GB=5  # 免费额度5GB
AZURE_LOG_ANALYTICS_PER_GB=1.10     # Log Analytics

# Application Gateway
AZURE_APPGW_CAPACITY_UNIT=0.155     # per vCPU-hour approx

# ---- GCP 定价 (us-central1 区域) ----

# Compute Engine On-Demand 每小时价格
GCP_E2_MICRO=0.00958               # 0.25vCPU 1GB (always free eligible)
GCP_E2_SMALL=0.01916               # 2vCPU 2GB
GCP_E2_MEDIUM=0.053                # 2vCPU 4GB
GCP_E2_LARGE=0.106                 # 4vCPU 8GB
GCP_E2_XLARGE=0.212                # 8vCPU 16GB

# Committed Use Discount (CUD) 折扣率
GCP_CUD_1Y_DISCOUNT=0.27            # 27%
GCP_CUD_3Y_DISCOUNT=0.54            # 54%

# Cloud SQL PostgreSQL
GCP_CLOUDSQL_DB_F1_MICRO=0.00762    # 1vCPU 0.614GB (free tier eligible)
GCP_CLOUDSQL_DB_G6_SMALL=0.095     # 1vCPU 3.75GB
GCP_CLOUDSQL_DB_G6_MEDIUM=0.19     # 2vCPU 7.5GB

# Memorystore (Redis)
GCP_MEMORystore_BASIC_1GB=0.028     # Basic tier 1GB
GCP_MEMORystore_STANDARD_5GB=0.143  # Standard tier 5GB

# 存储
GCP_PD_BALANCED_PER_GB=0.04         # PD-Balanced (SSD)
GCP_STANDARD_PER_GB=0.02            # Coldline/Nearline混合
GCP_CLOUD_STORAGE_STD=0.02          # Standard

# 网络
GCP_EGRESS_FIRST_1TB_PER_GB=0.12    # 标准出站流量

# 监控
GCP_MONITORING_FREE_METRICS=150     # 免费metric数量
GCP_MONITORING_PAID_PER_INSTANCE=2.5 # per instance/month
GCP_LOGGING_INGESTION_PER_GB=0.50   # Log ingestion
GCP_LOGGING_STORAGE_PER_GB=0.02     # Log storage

# Cloud Load Balancing
GCP_HTTP_LB_FREE=true               # HTTP(S) LB 免费(有条件)

# ---- Free Tier 汇总 ----

# 各云厂商Free Tier限额
declare -A FREE_TIER_AWS=(
    ["EC2"]="t2.micro/t3.micro 750h/月 (12个月)"
    ["RDS"]="750h/月 db.t2.micro (12个月)"
    ["ElastiCache"]="750h/月 cache.t2.micro (12个月)"
    ["CloudWatch"]="10个自定义指标 + 5GB日志"
    ["S3"]="5GB标准存储 + 20000 GET请求"
    ["DataTransfer"]="100GB/月出站"
)

declare -A FREE_TIER_AZURE=(
    ["VM"]="B1s 750h/月 (12个月)"
    ["SQL"]="Basic/S0 250h/月 (12个月)"
    ["Redis Cache"]="C0 basic 750h/月 (12个月)"
    ["AppInsights"]="5GB数据量/月 (永久免费)"
    ["Blob"]="5GB Hot LRS (12个月)"
    ["Bandwidth"]="100GB出站/月"
)

declare -A FREE_TIER_GCP=(
    ["CE"]="e2-micro (或等价) US区域 (始终免费)"
    ["CloudSQL"]="db-f1-micro (US区域, 始终免费)"
    ["Monitoring"]="150个metrics (每月免费配额)"
    ["Logging"]="10GB ingestion (每月免费)"
    ["Storage"]="5GB Regional Standard (US regions)"
    ["Egress"]="1GB/日 (北美区域)"
)

# ============================================
# 参数解析
# ============================================

usage() {
    cat <<EOF
GlobalReach V2.0 云成本估算器 (O06)

用法:
    $0 [选项]

选项:
    --provider <name>    目标云厂商 (aws|azure|gcp|all)
                         默认: all (三云对比)
    --reserved           显示 Reserved Instance / CUD 价格对比
    --detailed           显示每个组件的详细成本分解
    --json               以JSON格式输出结果
    --help               显示此帮助信息

示例:
    $0                              # 三云厂商总成本对比表
    $0 --provider aws --detailed    # AWS详细组件成本
    $0 --reserved                  # RI/CUD vs On-Demand对比
    $0 --json                      # JSON格式输出(供API调用)
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --provider)
            TARGET_PROVIDER="$2"
            shift 2
            ;;
        --reserved)
            SHOW_RESERVED=true
            shift
            ;;
        --detailed)
            SHOW_DETAILED=true
            shift
            ;;
        --json)
            OUTPUT_FORMAT="json"
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
# 资源映射函数
# ============================================

# 将当前容器资源映射为等效云实例规格
# 输入: cpu_cores, memory_mb
# 输出: 推荐实例类型和月费用计算

# --- AWS 资源映射 ---
map_to_aws_instance() {
    local cpu_cores="$1"
    local mem_mb="$2"

    local instance_type=""
    local hourly_rate=0
    local monthly_hours=744  # 平均每月小时数

    # 映射规则：基于CPU和内存选择最小满足需求的实例
    if (( $(echo "$cpu_cores <= 0.25 && $mem_mb <= 512" | bc -l) )); then
        instance_type="t3.nano"
        hourly_rate=$AWS_EC2_T3_NANO
    elif (( $(echo "$cpu_cores <= 0.5 && $mem_mb <= 1024" | bc -l) )); then
        instance_type="t3.micro"
        hourly_rate=$AWS_EC2_T3_MICRO
    elif (( $(echo "$cpu_cores <= 1 && $mem_mb <= 2048" | bc -l) )); then
        instance_type="t3.small"
        hourly_rate=$AWS_EC2_T3_SMALL
    elif (( $(echo "$cpu_cores <= 2 && $mem_mb <= 4096" | bc -l) )); then
        instance_type="t3.medium"
        hourly_rate=$AWS_EC2_T3_MEDIUM
    elif (( $(echo "$cpu_cores <= 2 && $mem_mb <= 8192" | bc -l) )); then
        instance_type="t3.large"
        hourly_rate=$AWS_EC2_T3_LARGE
    else
        instance_type="t3.xlarge"
        hourly_rate=$AWS_EC2_T3_XLARGE
    fi

    local monthly_od=$(echo "$hourly_rate $monthly_hours" | awk '{printf "%.2f", $1*$2}')
    local ri_1y=$(echo "$monthly_od" | awk '{printf "%.2f", $1*(1-'$AWS_RI_1Y_NOUPFRONT_DISCOUNT')}')
    local ri_3y=$(echo "$monthly_od" | awk '{printf "%.2f", $1*(1-'$AWS_RI_3Y_NOUPFRONT_DISCOUNT')}')

    echo "${instance_type}|${monthly_od}|${ri_1y}|${ri_3y}"
}

map_to_aws_rds() {
    local cpu_cores="$1"
    local mem_mb="$2"

    local instance_type=""
    local hourly_rate=0

    if (( $(echo "$cpu_cores <= 1 && $mem_mb <= 1024" | bc -l) )); then
        instance_type="db.t3.micro"
        hourly_rate=$AWS_RDS_T3_MICRO
    elif (( $(echo "$cpu_cores <= 1 && $mem_mb <= 2048" | bc -l) )); then
        instance_type="db.t3.small"
        hourly_rate=$AWS_RDS_T3_SMALL
    else
        instance_type="db.t3.medium"
        hourly_rate=$AWS_RDS_T3_MEDIUM
    fi

    local monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    echo "${instance_type}|${monthly}"
}

map_to_aws_elasticache() {
    local mem_mb="$1"

    local instance_type="cache.t3.micro"
    local hourly_rate=$AWS_ELASTICACHE_T3_MICRO
    local monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')

    echo "${instance_type}|${monthly}"
}

# --- Azure 资源映射 ---
map_to_azure_vm() {
    local cpu_cores="$1"
    local mem_mb="$2"

    local instance_type=""
    local hourly_rate=0

    if (( $(echo "$cpu_cores <= 1 && $mem_mb <= 1024" | bc -l) )); then
        instance_type="Standard_B1s"
        hourly_rate=$AZURE_B1S
    elif (( $(echo "$cpu_cores <= 2 && $mem_mb <= 2048" | bc -l) )); then
        instance_type="Standard_B1ms"
        hourly_rate=$AZURE_B1MS
    elif (( $(echo "$cpu_cores <= 2 && $mem_mb <= 4096" | bc -l) )); then
        instance_type="Standard_B2s"
        hourly_rate=$AZURE_B2S
    elif (( $(echo "$cpu_cores <= 2 && $mem_mb <= 8192" | bc -l) )); then
        instance_type="Standard_B2ms"
        hourly_rate=$AZURE_B2MS
    else
        instance_type="Standard_D2s_v3"
        hourly_rate=$AZURE_D2S_V3
    fi

    local monthly_od=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    local ri_1y=$(echo "$monthly_od" | awk '{printf "%.2f", $1*(1-'$AZURE_RI_1Y_DISCOUNT')}')
    local ri_3y=$(echo "$monthly_od" | awk '{printf "%.2f", $1*(1-'$AZURE_RI_3Y_DISCOUNT')}')

    echo "${instance_type}|${monthly_od}|${ri_1y}|${ri_3y}"
}

map_to_azure_sql() {
    local cpu_cores="$1"
    local mem_mb="$2"

    # Azure SQL按DTU/VCores计费，这里简化映射
    local tier="Basic"
    local hourly_rate=$AZURE_SQL_BASIC
    local monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')

    if (( $(echo "$cpu_cores >= 2 && $mem_mb >= 2048" | bc -l) )); then
        tier="Standard-S1"
        hourly_rate=$AZURE_SQL_S1
        monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    elif (( $(echo "$cpu_cores >= 1 && $mem_mb >= 1024" | bc -l) )); then
        tier="Standard-S0"
        hourly_rate=$AZURE_SQL_S0
        monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    fi

    echo "${tier}|${monthly}"
}

map_to_azure_redis() {
    local mem_mb="$1"

    local tier="Basic-C0"
    local hourly_rate=$AZURE_CACHE_C0
    local monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')

    if (( mem_mb > 1024 )); then
        tier="Basic-C1"
        hourly_rate=$AZURE_CACHE_C1
        monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    fi

    echo "${tier}|${monthly}"
}

# --- GCP 资源映射 ---
map_to_gcp_ce() {
    local cpu_cores="$1"
    local mem_mb="$2"

    local instance_type=""
    local hourly_rate=0

    if (( $(echo "$cpu_cores <= 0.25 && $mem_mb <= 1024" | bc -l) )); then
        instance_type="e2-micro"
        hourly_rate=$GCP_E2_MICRO
    elif (( $(echo "$cpu_cores <= 2 && $mem_mb <= 2048" | bc -l) )); then
        instance_type="e2-small"
        hourly_rate=$GCP_E2_SMALL
    elif (( $(echo "$cpu_cores <= 2 && $mem_mb <= 4096" | bc -l) )); then
        instance_type="e2-medium"
        hourly_rate=$GCP_E2_MEDIUM
    elif (( $(echo "$cpu_cores <= 4 && $mem_mb <= 8192" | bc -l) )); then
        instance_type="e2-large"
        hourly_rate=$GCP_E2_LARGE
    else
        instance_type="e2-xlarge"
        hourly_rate=$GCP_E2_XLARGE
    fi

    local monthly_od=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    local cud_1y=$(echo "$monthly_od" | awk '{printf "%.2f", $1*(1-'$GCP_CUD_1Y_DISCOUNT')}')
    local cud_3y=$(echo "$monthly_od" | awk '{printf "%.2f", $1*(1-'$GCP_CUD_3Y_DISCOUNT')}')

    echo "${instance_type}|${monthly_od}|${cud_1y}|${cud_3y}"
}

map_to_gcp_cloudsql() {
    local cpu_cores="$1"
    local mem_mb="$2"

    local instance_type="db-f1-micro"
    local hourly_rate=$GCP_CLOUDSQL_DB_F1_MICRO
    local monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')

    if (( $(echo "$cpu_cores >= 1 && $mem_mb >= 2048" | bc -l) )); then
        instance_type="db-g6-small"
        hourly_rate=$GCP_CLOUDSQL_DB_G6_SMALL
        monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    elif (( $(echo "$cpu_cores >= 2 && $mem_mb >= 4096" | bc -l) )); then
        instance_type="db-g6-medium"
        hourly_rate=$GCP_CLOUDSQL_DB_G6_MEDIUM
        monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    fi

    echo "${instance_type}|${monthly}"
}

map_to_gcp_memorystore() {
    local mem_mb="$1"

    local tier="basic-1gb"
    local hourly_rate=$GCP_MEMORystore_BASIC_1GB
    local monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')

    if (( mem_mb > 1024 )); then
        tier="standard-5gb"
        hourly_rate=$GCP_MEMORystore_STANDARD_5GB
        monthly=$(echo "$hourly_rate 744" | awk '{printf "%.2f", $1*$2}')
    fi

    echo "${tier}|${monthly}"
}

# ============================================
# 成本计算引擎
# ============================================

# 计算 AWS 总成本
calculate_aws_total() {
    # === 计算组件 ===
    # API Node: ~1核 512MB → t3.small
    local api_ec2
    api_ec2=$(map_to_aws_instance 1.0 512)
    local api_ec2_monthly=$(echo "$api_ec2" | cut -d'|' -f2)

    # Nginx: ~0.5核 256MB → t3.nano
    local nginx_ec2
    nginx_ec2=$(map_to_aws_instance 0.5 256)
    local nginx_ec2_monthly=$(echo "$nginx_ec2" | cut -d'|' -f2)

    # PostgreSQL: ~2核 2GB → db.t3.medium
    local pg_rds
    pg_rds=$(map_to_aws_rds 2.0 2048)
    local pg_rds_monthly=$(echo "$pg_rds" | cut -d'|' -f2)

    # Redis: ~0.5核 512MB → cache.t3.micro
    local redis_ec
    redis_ec=$(map_to_aws_elasticache 512)
    local redis_ec_monthly=$(echo "$redis_ec"" | cut -d'|' -f2")

    # Monitoring Stack (~5核 6GB):
    # Prometheus: t3.small
    local prom_ec2
    prom_ec2=$(map_to_aws_instance 1.0 2048)
    local prom_ec2_monthly=$(echo "$prom_ec2" | cut -d'|' -f2)

    # Grafana: t3.nano
    local grafana_ec2
    grafana_ec2=$(map_to_aws_instance 0.5 512)
    local grafana_ec2_monthly=$(echo "$grafana_ec2" | cut -d'|' -f2)

    # Loki: t3.small
    local loki_ec2
    loki_ec2=$(map_to_aws_instance 1.0 1024)
    local loki_ec2_monthly=$(echo "$loki_ec2" | cut -d'|' -f2)

    # Tempo: t3.small
    local tempo_ec2
    tempo_ec2=$(map_to_aws_instance 1.0 1024)
    local tempo_ec2_monthly=$(echo "$tempo_ec2" | cut -d'|' -f2)

    # AlertManager: t3.nano
    local am_ec2
    am_ec2=$(map_to_aws_instance 0.25 128)
    local am_ec2_monthly=$(echo "$am_ec2" | cut -d'|' -f2)

    # Node Exporter/Pg Exporter/Promtail/Mailpit: 合并为一个 t3.nano
    local misc_ec2
    misc_ec2=$(map_to_aws_instance 0.5 256)
    local misc_ec2_monthly=$(echo "$misc_ec2" | cut -d'|' -f2)

    # === 存储成本 ===
    # EBS: 数据卷约 30GB (PG+Redis+Prometheus TSDB)
    local ebs_cost
    ebs_cost=$(echo "30 $AWS_EBS_GP3_PER_GB_MONTH" | awk '{printf "%.2f", $1*$2}')

    # S3: 备份 ~20GB
    local s3_cost
    s3_cost=$(echo "20 $AWS_S3_STANDARD_PER_GB_MONTH" | awk '{printf "%.2f", $1*$2}')

    # === 网络成本 ===
    # ALB
    local alb_cost
    alb_cost=$(echo "$AWS_ALB_PER_LCU_HOUR $AWS_ALB_BASE_HOURS" | awk '{printf "%.2f", $1*$2}')

    # Data Transfer (估算 50GB/月)
    local transfer_cost
    transfer_cost=$(echo "50 $AWS_DATA_TRANSFER_OUT_PER_GB" | awk '{printf "%.2f", max($1*$2-9, 0)}')  # 前9GB免费

    # === 监控成本 ===
    # CloudWatch: ~50 metrics
    local cw_metrics
    cw_metrics=$(echo "50 $AWS_CLOUDWATCH_METRICS_PER_MILLION" | awk '{printf "%.2f", ($1/1000000)*$2*744}')
    # CloudWatch Logs: ~5GB/月
    local cw_logs
    cw_logs=$(echo "5 $AWS_CLOUDWATCH_LOGS_INGEST_PER_GB" | awk '{printf "%.2f", $1*$2}')

    # === 汇总 ===
    local compute_total
    compute_total=$(echo "$api_ec2_monthly $nginx_ec2_monthly $pg_rds_monthly $redis_ec_monthly $prom_ec2_monthly $grafana_ec2_monthly $loki_ec2_monthly $tempo_ec2_monthly $am_ec2_monthly $misc_ec2_monthly" \
        | awk '{for(i=1;i<=NF;i++) sum+=$i; printf "%.2f", sum}')

    local storage_total
    storage_total=$(echo "$ebs_cost $s3_cost" | awk '{printf "%.2f", $1+$2}')

    local network_total
    network_total=$(echo "$alb_cost $transfer_cost" | awk '{printf "%.2f", $1+$2}')

    local monitoring_total
    monitoring_total=$(echo "$cw_metrics $cw_logs" | awk '{printf "%.2f", $1+$2}')

    local grand_total
    grand_total=$(echo "$compute_total $storage_total $network_total $monitoring_total" | awk '{printf "%.2f", $1+$2+$3+$4}')

    # RI节省
    local ri_1y_total
    ri_1y_total=$(echo "$grand_total $AWS_RI_1Y_NOUPFRONT_DISCOUNT" | awk '{printf "%.2f", $1*(1-$2)}')
    local ri_3y_total
    ri_3y_total=$(echo "$grand_total $AWS_RI_3Y_NOUPFRONT_DISCOUNT" | awk '{printf "%.2f", $1*(1-$2)}')

    echo "${compute_total}|${storage_total}|${network_total}|${monitoring_total}|${grand_total}|${ri_1y_total}|${ri_3y_total}"
}

# 计算 Azure 总成本
calculate_azure_total() {
    # === 计算组件 ===
    local api_vm
    api_vm=$(map_to_azure_vm 1.0 512)
    local api_vm_monthly=$(echo "$api_vm" | cut -d'|' -f2)

    local nginx_vm
    nginx_vm=$(map_to_azure_vm 0.5 256)
    local nginx_vm_monthly=$(echo "$nginx_vm" | cut -d'|' -f2)

    local pg_sql
    pg_sql=$(map_to_azure_sql 2.0 2048)
    local pg_sql_monthly=$(echo "$pg_sql" | cut -d'|' -f2)

    local redis_cache
    redis_cache=$(map_to_azure_redis 512)
    local redis_cache_monthly=$(echo "$redis_cache" | cut -d'|' -f2)

    local prom_vm
    prom_vm=$(map_to_azure_vm 1.0 2048)
    local prom_vm_monthly=$(echo "$prom_vm" | cut -d'|' -f2)

    local grafana_vm
    grafana_vm=$(map_to_azure_vm 0.5 512)
    local grafana_vm_monthly=$(echo "$grafana_vm" | cut -d'|' -f2)

    local loki_vm
    loki_vm=$(map_to_azure_vm 1.0 1024)
    local loki_vm_monthly=$(echo "$loki_vm" | cut -d'|' -f2)

    local tempo_vm
    tempo_vm=$(map_to_azure_vm 1.0 1024)
    local tempo_vm_monthly=$(echo "$tempo_vm" | cut -d'|' -f2)

    local am_vm
    am_vm=$(map_to_azure_vm 0.25 128)
    local am_vm_monthly=$(echo "$am_vm" | cut -d'|' -f2)

    local misc_vm
    misc_vm=$(map_to_azure_vm 0.5 256)
    local misc_vm_monthly=$(echo "$misc_vm" | cut -d'|' -f2)

    # === 存储成本 ===
    # Managed Disks: ~30GB → P10 (128GB)
    local disk_cost=$AZURE_MANAGED_DISK_P10

    # Blob Storage: 备份 ~20GB
    local blob_cost
    blob_cost=$(echo "20 $AZURE_BLOB_HOT_PER_GB" | awk '{printf "%.2f", $1*$2}')

    # === 网络成本 ===
    # Application Gateway
    local appgw_cost
    appgw_cost=$(echo "$AZURE_APPGW_CAPACITY_UNIT 744" | awk '{printf "%.2f", $1*2}')  # 约2vCPU等效

    # Data Transfer
    local transfer_cost
    transfer_cost=$(echo "50 $AZURE_DATA_TRANSFER_FIRST_5TB_PER_GB" | awk '{printf "%.2f", $1*$2}')

    # === 监控成本 ===
    # App Insights (在免费额度内)
    local insights_cost=0

    # Log Analytics: ~5GB
    local log_analytics
    log_analytics=$(echo "5 $AZURE_LOG_ANALYTICS_PER_GB" | awk '{printf "%.2f", $1*$2}')

    # === 汇总 ===
    local compute_total
    compute_total=$(echo "$api_vm_monthly $nginx_vm_monthly $pg_sql_monthly $redis_cache_monthly $prom_vm_monthly $grafana_vm_monthly $loki_vm_monthly $tempo_vm_monthly $am_vm_monthly $misc_vm_monthly" \
        | awk '{for(i=1;i<=NF;i++) sum+=$i; printf "%.2f", sum}')

    local storage_total
    storage_total=$(echo "$disk_cost $blob_cost" | awk '{printf "%.2f", $1+$2}')

    local network_total
    network_total=$(echo "$appgw_cost $transfer_cost" | awk '{printf "%.2f", $1+$2}')

    local monitoring_total
    monitoring_total=$(echo "$insights_cost $log_analytics" | awk '{printf "%.2f", $1+$2}')

    local grand_total
    grand_total=$(echo "$compute_total $storage_total $network_total $monitoring_total" | awk '{printf "%.2f", $1+$2+$3+$4}')

    # RI节省
    local ri_1y_total
    ri_1y_total=$(echo "$grand_total $AZURE_RI_1Y_DISCOUNT" | awk '{printf "%.2f", $1*(1-$2)}')
    local ri_3y_total
    ri_3y_total=$(echo "$grand_total $AZURE_RI_3Y_DISCOUNT" | awk '{printf "%.2f", $1*(1-$2)}')

    echo "${compute_total}|${storage_total}|${network_total}|${monitoring_total}|${grand_total}|${ri_1y_total}|${ri_3y_total}"
}

# 计算 GCP 总成本
calculate_gcp_total() {
    # === 计算组件 ===
    local api_ce
    api_ce=$(map_to_gcp_ce 1.0 512)
    local api_ce_monthly=$(echo "$api_ce" | cut -d'|' -f2)

    local nginx_ce
    nginx_ce=$(map_to_gcp_ce 0.5 256)
    local nginx_ce_monthly=$(echo "$nginx_ce" | cut -d'|' -f2)

    local pg_cloudsql
    pg_cloudsql=$(map_to_gcp_cloudsql 2.0 2048)
    local pg_cloudsql_monthly=$(echo "$pg_cloudsql" | cut -d'|' -f2)

    local redis_ms
    redis_ms=$(map_to_gcp_memorystore 512)
    local redis_ms_monthly=$(echo "$redis_ms" | cut -d'|' -f2)

    local prom_ce
    prom_ce=$(map_to_gcp_ce 1.0 2048)
    local prom_ce_monthly=$(echo "$prom_ce" | cut -d'|' -f2)

    local grafana_ce
    grafana_ce=$(map_to_gcp_ce 0.5 512)
    local grafana_ce_monthly=$(echo "$grafana_ce" | cut -d'|' -f2)

    local loki_ce
    loki_ce=$(map_to_gcp_ce 1.0 1024)
    local loki_ce_monthly=$(echo "$loki_ce" | cut -d'|' -f2)

    local tempo_ce
    tempo_ce=$(map_to_gcp_ce 1.0 1024)
    local tempo_ce_monthly=$(echo "$tempo_ce" | cut -d'|' -f2)

    local am_ce
    am_ce=$(map_to_gcp_ce 0.25 128)
    local am_ce_monthly=$(echo "$am_ce" | cut -d'|' -f2)

    local misc_ce
    misc_ce=$(map_to_gcp_ce 0.5 256)
    local misc_ce_monthly=$(echo "$misc_ce" | cut -d'|' -f2)

    # === 存储成本 ===
    # PD-Balanced: ~30GB
    local pd_cost
    pd_cost=$(echo "30 $GCP_PD_BALANCED_PER_GB" | awk '{printf "%.2f", $1*$2}')

    # Cloud Storage: 备份 ~20GB
    local storage_cost
    storage_cost=$(echo "20 $GCP_CLOUD_STORAGE_STD" | awk '{printf "%.2f", $1*$2}')

    # === 网络成本 ===
    # HTTP(S) Load Balancer: 免费(条件满足时)
    local lb_cost=0

    # Data Transfer: ~50GB/月 (前1GB/天免费 ≈ 30GB免费)
    local transfer_cost
    transfer_cost=$(echo "50 30 $GCP_EGRESS_FIRST_1TB_PER_GB" | awk '{printf "%.2f", ($1-$2)*$3}')

    # === 监控成本 ===
    # Cloud Monitoring: 付费实例
    local monitoring_instances=5
    local monitor_cost
    monitor_cost=$(echo "$monitoring_instances $GCP_MONITORING_PAID_PER_INSTANCE" | awk '{printf "%.2f", $1*$2}')

    # Cloud Logging: ~5GB (前10GB免费)
    local logging_cost=0  # 在免费额度内

    # === 汇总 ===
    local compute_total
    compute_total=$(echo "$api_ce_monthly $nginx_ce_monthly $pg_cloudsql_monthly $redis_ms_monthly $prom_ce_monthly $grafana_ce_monthly $loki_ce_monthly $tempo_ce_monthly $am_ce_monthly $misc_ce_monthly" \
        | awk '{for(i=1;i<=NF;i++) sum+=$i; printf "%.2f", sum}')

    local storage_total
    storage_total=$(echo "$pd_cost $storage_cost" | awk '{printf "%.2f", $1+$2}')

    local network_total
    network_total=$(echo "$lb_cost $transfer_cost" | awk '{printf "%.2f", $1+$2}')

    local monitoring_total
    monitoring_total=$(echo "$monitor_cost $logging_cost" | awk '{printf "%.2f", $1+$2}')

    local grand_total
    grand_total=$(echo "$compute_total $storage_total $network_total $monitoring_total" | awk '{printf "%.2f", $1+$2+$3+$4}')

    # CUD节省
    local cud_1y_total
    cud_1y_total=$(echo "$grand_total $GCP_CUD_1Y_DISCOUNT" | awk '{printf "%.2f", $1*(1-$2)}')
    local cud_3y_total
    cud_3y_total=$(echo "$grand_total $GCP_CUD_3Y_DISCOUNT" | awk '{printf "%.2f", $1*(1-$2)}')

    echo "${compute_total}|${storage_total}|${network_total}|${monitoring_total}|${grand_total}|${cud_1y_total}|${cud_3y_total}"
}

# Free Tier 利用度分析
analyze_free_tier() {
    echo ""
    echo -e "${CYAN}🆓 Free Tier 利用度分析:${NC}"
    echo ""

    # AWS Free Tier
    echo -e "  ${YELLOW}AWS Free Tier (新账户12个月):${NC}"
    echo -e "    • EC2: ${FREE_TIER_AWS[EC2]}"
    echo -e "    • RDS: ${FREE_TIER_AWS[RDS]}"
    echo -e "    • ElastiCache: ${FREE_TIER_AWS[ElastiCache]}"
    echo -e "    • CloudWatch: ${FREE_TIER_AWS[CloudWatch]}"
    echo -e "    • S3: ${FREE_TIER_AWS[S3]}"
    echo -e "    • Data Transfer: ${FREE_TIER_AWS[DataTransfer]}"
    echo -e "    ${GREEN}→ 可覆盖: API+Nginx+Redis+基础监控 (≈$60-80/月)${NC}"

    # Azure Free Tier
    echo ""
    echo -e "  ${YELLOW}Azure Free Tier (新账户12个月):${NC}"
    echo -e "    • VM: ${FREE_TIER_AZURE[VM]}"
    echo -e "    • SQL Database: ${FREE_TIER_AZURE[SQL]}"
    echo -e "    • Redis Cache: ${FREE_TIER_AZURE['Redis Cache']}"
    echo -e "    • App Insights: ${FREE_TIER_AZURE[AppInsights]}"
    echo -e "    • Blob Storage: ${FREE_TIER_AZURE[Blob]}"
    echo -e "    • Bandwidth: ${FREE_TIER_AZURE[Bandwidth]}"
    echo -e "    ${GREEN}→ 可覆盖: API+Nginx+PostgreSQL(Basic)+Redis+监控 (≈$70-90/月)${NC}"

    # GCP Free Tier
    echo ""
    echo -e "  ${YELLOW}GCP Free Tier (Always Free):${NC}"
    echo -e "    • Compute Engine: ${FREE_TIER_GCP[CE]}"
    echo -e "    • Cloud SQL: ${FREE_TIER_GCP[CloudSQL]}"
    echo -e "    • Monitoring: ${FREE_TIER_GCP[Monitoring]}"
    echo -e "    • Logging: ${FREE_TIER_GCP[Logging]}"
    echo -e "    • Storage: ${FREE_TIER_GCP[Storage]}"
    echo -e "    • Egress: ${FREE_TIER_GCP[Egress]}"
    echo -e "    ${GREEN}→ 可覆盖: API(e2-micro)+PostgreSQL(db-f1-micro)+基础监控 (≈$40-55/月)${NC}"
    echo ""
    echo -e "  ${PURPLE}💡 建议: 新项目可充分利用 Free Trial 降低初期成本，12个月后切换至RI/CUD${NC}"
}

# ============================================
# 主程序入口
# ============================================

main() {
    local report_time
    report_time=$(date '+%Y-%m-%d %H:%M:%S')

    # 计算各云厂商成本
    local aws_result azure_result gcp_result

    if [[ "$TARGET_PROVIDER" == "all" || "$TARGET_PROVIDER" == "aws" ]]; then
        aws_result=$(calculate_aws_total)
    fi
    if [[ "$TARGET_PROVIDER" == "all" || "$TARGET_PROVIDER" == "azure" ]]; then
        azure_result=$(calculate_azure_total)
    fi
    if [[ "$TARGET_PROVIDER" == "all" || "$TARGET_PROVIDER" == "gcp" ]]; then
        gcp_result=$(calculate_gcp_total)
    fi

    # ===== JSON模式输出 =====
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        python3 -c "
import json, datetime

providers = {}
if '${TARGET_PROVIDER}' in ('all', 'aws'):
    r = '${aws_result}'.split('|')
    providers['aws'] = {
        'compute_usd': float(r[0]), 'storage_usd': float(r[1]),
        'network_usd': float(r[2]), 'monitoring_usd': float(r[3]),
        'total_on_demand_usd': float(r[4]),
        'ri_1y_usd': float(r[5]), 'ri_3y_usd': float(r[6]),
        'currency': 'USD', 'region': 'us-east-1'
    }
if '${TARGET_PROVIDER}' in ('all', 'azure'):
    r = '${azure_result}'.split('|')
    providers['azure'] = {
        'compute_usd': float(r[0]), 'storage_usd': float(r[1]),
        'network_usd': float(r[2]), 'monitoring_usd': float(r[3]),
        'total_on_demand_usd': float(r[4]),
        'ri_1y_usd': float(r[5]), 'ri_3y_usd': float(r[6]),
        'currency': 'USD', 'region': 'eastus'
    }
if '${TARGET_PROVIDER}' in ('all', 'gcp'):
    r = '${gcp_result}'.split('|')
    providers['gcp'] = {
        'compute_usd': float(r[0]), 'storage_usd': float(r[1]),
        'network_usd': float(r[2]), 'monitoring_usd': float(r[3]),
        'total_on_demand_usd': float(r[4]),
        'cud_1y_usd': float(r[5]), 'cud_3y_usd': float(r[6]),
        'currency': 'USD', 'region': 'us-central1'
    }

print(json.dumps({
    'report_type': 'cloud_cost_estimate',
    'timestamp': datetime.datetime.now().isoformat(),
    'source_infrastructure': 'GlobalReach V2.0 Docker Compose (13 containers)',
    'mapping_method': 'resource_equivalence',
    'pricing_date': '2026-01 (estimated)',
    'providers': providers,
    'recommendation': 'See detailed comparison for optimal choice'
}, indent=2))
"
        exit 0
    fi

    # ===== 文本模式输出 =====

    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  GlobalReach 云迁移成本估算 (O06)                       ║${NC}"
    echo -e "${CYAN}╠════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║  时间: ${report_time}                          ║${NC}"
    echo -e "${CYAN}║  源架构: Docker Compose 13容器 (单节点)               ║${NC}"
    echo -e "${CYAN}║  定价日期: 2026年1月 (基于公开定价, 仅供参考)         ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # ---- 总览对比表 ----
    echo -e "${PURPLE}☁️  三云厂商月度成本总览 (On-Demand):${NC}"
    echo ""
    echo -e "┌─────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐"
    echo -e "│ 云厂商       │ 计算费用 │ 存储费用 │ 网络费用 │ 监控费用 │ **总计** │"
    echo -e "├─────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤"

    if [[ -n "${aws_result:-}" ]]; then
        IFS='|' read -r aws_comp aws_stor aws_net aws_mon aws_tot aws_ri1y aws_ri3y <<< "$aws_result"
        printf "│ %-11s │ \$%7.1f │ \$%7.1f │ \$%7.1f │ \$%7.1f │ \033[1;35m\$%8.1f\033[0m │\n" \
            "AWS" "$aws_comp" "$aws_stor" "$aws_net" "$aws_mon" "$aws_tot"
    fi

    if [[ -n "${azure_result:-}" ]]; then
        IFS='|' read -r az_comp az_stor az_net az_mon az_tot az_ri1y az_ri3y <<< "$azure_result"
        printf "│ %-11s │ \$%7.1f │ \$%7.1f │ \$%7.1f │ \$%7.1f │ \033[1;35m\$%8.1f\033[0m │\n" \
            "Azure" "$az_comp" "$az_stor" "$az_net" "$az_mon" "$az_tot"
    fi

    if [[ -n "${gcp_result:-}" ]]; then
        IFS='|' read -r gcp_comp gcp_stor gcp_net gcp_mon gcp_tot gcp_cud1y gcp_cud3y <<< "$gcp_result"
        printf "│ %-11s │ \$%7.1f │ \$%7.1f │ \$%7.1f │ \$%7.1f │ \033[1;35m\$%8.1f\033[0m │\n" \
            "GCP" "$gcp_cost" "$gcp_stor" "$gcp_net" "$gcp_mon" "$gcp_tot"
    fi

    echo -e "└─────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘"
    echo ""

    # ---- RI/CUD 对比 ----
    if [[ "$SHOW_RESERVED" == true ]]; then
        echo -e "${YELLOW}📋 Reserved Instance / CUD 对比:${NC}"
        echo ""
        echo -e "┌─────────────┬──────────────┬──────────────┬──────────────┐"
        echo -e "│ 云厂商       │ On-Demand    │ 1年预留/CUD  │ 3年预留/CUD  │"
        echo -e "│             │ (月费用)      │ (月费用)      │ (月费用)      │"
        echo -e "├─────────────┼──────────────┼──────────────┼──────────────┤"

        if [[ -n "${aws_result:-}" ]]; then
            printf "│ %-11s │ \$%11.1f │ \$%11.1f │ \$%11.1f │\n" \
                "AWS" "$aws_tot" "$aws_ri1y" "$aws_ri3y"
        fi
        if [[ -n "${azure_result:-}" ]]; then
            printf "│ %-11s │ \$%11.1f │ \$%11.1f │ \$%11.1f │\n" \
                "Azure" "$az_tot" "$az_ri1y" "$az_ri3y"
        fi
        if [[ -n "${gcp_result:-}" ]]; then
            printf "│ %-11s │ \$%11.1f │ \$%11.1f │ \$%11.1f │\n" \
                "GCP" "$gcp_tot" "$gcp_cud1y" "$gcp_cud3y"
        fi

        echo -e "└─────────────┴──────────────┴──────────────┴──────────────┘"
        echo -e "  ${GREEN}注: RI/CUD 价格为长期承诺后的等效月均费用${NC}"
        echo ""
    fi

    # ---- 详细组件分解 ----
    if [[ "$SHOW_DETAILED" == true ]]; then
        echo -e "${BLUE}📦 组件级详细成本分解:${NC}"
        echo ""

        if [[ "$TARGET_PROVIDER" == "all" || "$TARGET_PROVIDER" == "aws" ]]; then
            echo -e "  ${YELLOW}--- AWS 组件映射 ---${NC}"
            echo -e "  ┌────────────────┬──────────────────┬────────────┐"
            echo -e "  │ 组件             │ 映射实例          │ 月费用(USD) │"
            echo -e "  ├────────────────┼──────────────────┼────────────┤"

            local instances_map=(
                "API Node|$(map_to_aws_instance 1.0 512)"
                "Nginx|$(map_to_aws_instance 0.5 256)"
                "PostgreSQL|$(map_to_aws_rds 2.0 2048)"
                "Redis|$(map_to_aws_elasticache 512)"
                "Prometheus|$(map_to_aws_instance 1.0 2048)"
                "Grafana|$(map_to_aws_instance 0.5 512)"
                "Loki|$(map_to_aws_instance 1.0 1024)"
                "Tempo|$(map_to_aws_instance 1.0 1024)"
                "AlertManager|$(map_to_aws_instance 0.25 128)"
                "Others(x4)|$(map_to_aws_instance 0.5 256)"
            )

            for item in "${instances_map[@]}"; do
                IFS='|' read -r name mapping <<< "$item"
                IFS='|' read -r inst od _ri1 _ri3 <<< "$mapping"
                printf "  │ %-16s │ %-18s │ \$%10.2f │\n" "$name" "$inst" "$od"
            done

            echo -e "  └────────────────┴──────────────────┴────────────┘"
            echo -e "  附加: EBS(~\$2.4), S3(~\$0.46), ALB(~\$6.7), CW(~\$2.65), Transfer(~\$3.7)"
            echo ""
        fi
    fi

    # ---- Free Tier 分析 ----
    analyze_free_tier

    # ---- TCO 对比 (3年) ----
    echo -e "${RED}📊 TCO 对比 (3年总拥有成本):${NC}"
    echo ""

    local aws_3yr=0 azure_3yr=0 gcp_3yr=0
    if [[ -n "${aws_result:-}" ]]; then
        aws_3yr=$(echo "$aws_tot" | awk '{printf "%.0f", $1*36}')  # On-demand 3年
        local aws_3yr_ri
        aws_3yr_ri=$(echo "$aws_ri3y" | awk '{printf "%.0f", $1*36}')
        echo -e "  AWS:  On-Demand = \$$aws_3yr  |  3Y RI = \033[32m\$$aws_3yr_ri\033[0m  (节省 \$$(($aws_3yr - $aws_3yr_ri)))"
    fi
    if [[ -n "${azure_result:-}" ]]; then
        azure_3yr=$(echo "$az_tot" | awk '{printf "%.0f", $1*36}')
        local azure_3yr_ri
        azure_3yr_ri=$(echo "$az_ri3y" | awk '{printf "%.0f", $1*36}')
        echo -e "  Azure: On-Demand = \$$azure_3yr  |  3Y RI = \033[32m\$$azure_3yr_ri\033[0m  (节省 \$$(($azure_3yr - $azure_3yr_ri)))"
    fi
    if [[ -n "${gcp_result:-}" ]]; then
        gcp_3yr=$(echo "$gcp_tot" | awk '{printf "%.0f", $1*36}')
        local gcp_3yr_cud
        gcp_3yr_cud=$(echo "$gcp_cud3y" | awk '{printf "%.0f", $1*36}')
        echo -e "  GCP:  On-Demand = \$$gcp_3yr  |  3Y CUD = \033[32m\$$gcp_3yr_cud\033[0m  (节省 \$$(($gcp_3yr - $gcp_3yr_cud)))"
    fi
    echo ""

    # ---- 推荐建议 ----
    echo -e "${GREEN}💡 迁移建议:${NC}"
    echo -e "  1. ${YELLOW}短期(0-12月)${NC}: 利用各云厂商 Free Trial, 成本接近 \$0"
    echo -e "  2. ${YELLOW}中期(1-3年)${NC}: 推荐 AWS/GCP 1Y RI 或 Azure RI, 降低30-40%"
    echo -e "  3. ${YELLOW}长期(3年+)${NC}: 3Y RI/CUD 最优, 可降低55-66% On-Demand 成本"
    echo -e "  4. ${YELLOW}优化策略${NC}: 监控栈合并部署(减少3-4个VM), 使用托管服务替代自建"
    echo ""

    echo -e "${CYAN}═════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  ⚠️  以上价格为估算值, 实际费用以云控制台账单为准${NC}"
    echo -e "${CYAN}  📝  定价来源: AWS/Azure/GCP 公开定价页面 (2026Q1)${NC}"
    echo -e "${CYAN}═════════════════════════════════════════════════════════${NC}"
}

main "$@"
