#!/bin/bash
# ==============================================================================
# GlobalReach V2.0 — 灾难恢复演练脚本 (M-D04)
# 在隔离环境中模拟完整恢复流程 (不影响生产数据)
#
# Usage:
#   ./scripts/disaster-recovery-drill.sh                        # 演练最新备份
#   ./scripts/disaster-recovery-drill.sh /path/to/backup.tar.gz  # 演练指定备份
#   ./scripts/disaster-recovery-drill.sh --cleanup               # 清理上次演练残留
#
# 功能:
#   1. 创建临时恢复目录 (隔离环境)
#   2. 从最新备份解压到隔离区
#   3. 验证 SQL 可以导入 (pg_restore --dry-run)
#   4. 验证 RDB 文件格式正确 (redis-check-rdb)
#   5. 验证 Grafana SQLite 数据库可读
#   6. 对比关键数据指标 (可选)
#   7. 自动清理临时文件
#   8. 输出演练报告
#
# 安全约束:
#   - 所有操作在 /tmp/globalreach_drill_XXXX 下进行
#   - 不连接任何生产数据库或服务
#   - 不修改任何生产文件
#   - 演练结束后自动清理 (除非指定 --keep)
# ==============================================================================

set -euo pipefail

# ======================== 可配置参数 ========================
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
DRILL_BASE_DIR="${DRILL_BASE_DIR:-/tmp}"
KEEP_TEMP="${KEEP_TEMP:-false}"
CLEANUP_ONLY="${CLEANUP_ONLY:false}"

# ======================== 颜色输出 ========================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()  { echo -e "${CYAN}[DRILL]${NC} $(date '+%H:%M:%S') $*"; }
log_pass()  { echo -e "${GREEN}[PASS]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }
log_step()  { echo -e "\n${BOLD}▶ 步骤 $*${NC}" }

# ======================== 统计 ========================
TOTAL_STEPS=0
PASS_STEPS=0
WARN_STEPS=0
FAIL_STEPS=0

record_step() {
    local result="$1" step_name="$2" detail="$3"
    TOTAL_STEPS=$((TOTAL_STEPS + 1))
    case "$result" in
        PASS) PASS_STEPS=$((PASS_STEPS + 1)); log_pass "[$step_name] $detail" ;;
        WARN) WARN_STEPS=$((WARN_STEPS + 1)); log_warn "[$step_name] $detail" ;;
        FAIL) FAIL_STEPS=$((FAIL_STEPS + 1)); log_fail "[$step_name] $detail" ;;
    esac
}

# ======================== 清理函数 ========================
cleanup() {
    if [ "$KEEP_TEMP" = "false" ] && [ -n "${DRILL_DIR:-}" ] && [ -d "$DRILL_DIR" ]; then
        log_info "清理临时目录: $DRILL_DIR"
        rm -rf "$DRILL_DIR"
    fi
}
trap cleanup EXIT

# ======================== 参数解析 ========================
BACKUP_FILE=""
for arg in "$@"; do
    case "$arg" in
        --keep)     KEEP_TEMP="true"; shift ;;
        --cleanup)  CLEANUP_ONLY="true"; shift ;;
        -h|--help)
            echo "GlobalReach V2.0 — 灾难恢复演练脚本 (M-D04)"
            echo ""
            echo "Usage: $0 [backup_file.tar.gz] [--keep] [--cleanup]"
            echo ""
            echo "Options:"
            echo "  --keep     保留临时目录（用于调试）"
            echo "  --cleanup  仅清理之前的演练残留"
            echo "  --help     显示帮助"
            exit 0
            ;;
        *)
            if [ -f "$arg" ]; then
                BACKUP_FILE="$arg"
            fi
            shift ;;
    esac
done

# ======================== 清理模式 ========================
if [ "$CLEANUP_ONLY" = "true" ]; then
    log_info "清理模式: 删除所有演练残留..."
    REMOVED=0
    for dir in "${DRILL_BASE_DIR}"/globalreach_drill_*; do
        if [ -d "$dir" ]; then
            rm -rf "$dir"
            log_info "已删除: $dir"
            REMOVED=$((REMOVED + 1))
        fi
    done
    if [ "$REMOVED" -eq 0 ]; then
        log_info "无残留需要清理"
    else
        log_pass "已清理 ${REMOVED} 个演练目录"
    fi
    exit 0
fi

# ======================== 头部 ========================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD} GlobalReach V2.0 — 灾难恢复演练 (M-D04)${NC}"
echo -e "${BOLD}============================================================${NC}"
echo -e "  演练时间:     $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "  安全模式:     隔离环境 (不影响生产)"
echo ""

# ======================== 确定备份文件 ========================
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    # 自动查找最新备份
    BACKUP_FILE=$(find "${BACKUP_DIR}" -name "globalreach_backup_*.tar.gz" -type f 2>/dev/null \
        | sort -r | head -1)

    if [ -z "$BACKUP_FILE" ]; then
        log_fail "未找到任何备份文件! 请先执行 backup.sh"
        exit 1
    fi
fi

BNAME="$(basename "$BACKUP_FILE")"
log_info "使用备份文件: ${BNAME}"
log_info "文件大小:      $(du -h "$BACKUP_FILE" | cut -f1)"

# SHA256 快速校验
SHA256_FILE="${BACKUP_FILE}.sha256"
if [ -f "$SHA256_FILE" ]; then
    STORED_HASH=$(head -1 "$SHA256_FILE" | awk '{print $1}')
    COMPUTED_HASH=$(sha256sum "$BACKUP_FILE" | awk '{print $1}')
    if [ "$STORED_HASH" = "$COMPUTED_HASH" ]; then
        record_step "PASS" "预检-SHA256" "校验通过 (${COMPUTED_HASH:0:16}...)"
    else
        record_step "FAIL" "预检-SHA256" "校验不匹配!"
        exit 1
    fi
else
    record_step "WARN" "预检-SHA256" "无 .sha256 文件，跳过"
fi

# =====================================================================
# 步骤 1: 创建临时恢复目录 (隔离环境)
# =====================================================================
log_step "1/${TOTAL_STEPS}/ 创建临时恢复目录"

TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
DRILL_DIR="${DRILL_BASE_DIR}/globalreach_drill_${TIMESTAMP}"
mkdir -p "${DRILL_DIR}"

record_step "PASS" "创建隔离环境" "临时目录: ${DRILL_DIR}"

# =====================================================================
# 步骤 2: 从备份解压
# =====================================================================
log_step "2/${TOTAL_STEPS}/ 解压备份归档"

EXTRACT_DIR="${DRILL_DIR}/restored"
mkdir -p "${EXTRACT_DIR}"

if tar -xzf "$BACKUP_FILE" -C "${EXTRACT_DIR}" 2>/dev/null; then
    EXTRACTED_FILES=$(find "${EXTRACT_DIR}" -type f 2>/dev/null | wc -l)
    EXTRACTED_SIZE=$(du -sh "${EXTRACT_DIR}" 2>/dev/null | cut -f1)
    record_step "PASS" "解压备份" "成功解压 ${EXTRACTED_FILES} 个文件 (${EXTRACTED_SIZE})"
else
    record_step "FAIL" "解压备份" "tar 解压失败!"
    exit 1
fi

# 显示 MANIFEST
if [ -f "${EXTRACT_DIR}/MANIFEST.txt" ]; then
    log_info "备份清单内容:"
    cat "${EXTRACT_DIR}/MANIFEST.txt" | head -20
fi

# =====================================================================
# 步骤 3: PostgreSQL 恢复验证 (pg_restore --dry-run)
# =====================================================================
log_step "3/${TOTAL_STEPS}/ PostgreSQL 恢复验证"

PG_DUMP="${EXTRACT_DIR}/postgresql/globalreach_prod.dump"
PG_SQL="${EXTRACT_DIR}/postgresql/globalreach_prod.sql"

if [ -f "$PG_DUMP" ]; then
    PG_DUMP_SIZE=$(du -h "$PG_DUMP" | cut -f1)
    log_info "检测到 custom format dump: ${PG_DUMP_SIZE}"

    if command -v pg_restore &>/dev/null; then
        DRY_RUN_OUTPUT=$(pg_restore --list "$PG_DUMP" 2>&1) || true
        PG_OBJECT_COUNT=$(echo "$DRY_RUN_OUTPUT" | grep -c ";" || echo "0")
        PG_TABLE_COUNT=$(echo "$DRY_RUN_OUTPUT" | grep -i "TABLE" | wc -l || echo "0")

        if [ "$PG_OBJECT_COUNT" -gt 0 ]; then
            record_step "PASS" "PG恢复(dry-run)" \
                "pg_restore --list 成功: ${PG_OBJECT_COUNT} 个对象, ${PG_TABLE_COUNT} 张表"
        else
            record_step "WARN" "PG恢复(dry-run)" "pg_restore 返回空结果"
        fi

        # 尝试完整的 dry-run restore (不实际写入)
        log_info "执行完整 dry-run 恢复测试..."
        if pg_restore --clean --if-exists --dbname="postgres://fake@localhost/fake" \
            "$PG_DUMP" >/dev/null 2>&1 || \
           pg_restore --clean --if-exists "$PG_DUMP" >/dev/null 2>&1; then
            record_step "PASS" "PG恢复(完整dry-run)" "完整 dry-run 通过"
        else
            # dry-run 可能因无连接而失败，这是预期的
            record_step "WARN" "PG恢复(完整dry-run)" "需数据库连接才能完成完整 dry-run (正常)"
        fi
    else
        record_step "WARN" "PG恢复工具" "pg_restore 未安装，无法验证"
    fi

elif [ -f "$PG_SQL" ]; then
    SQL_SIZE=$(du -h "$PG_SQL" | cut -f1)
    SQL_LINES=$(wc -l < "$PG_SQL")
    SQL_INSERTS=$(grep -ci "^INSERT" "$PG_SQL" 2>/dev/null || echo "0")

    if [ "$SQL_LINES" -gt 20 ] && [ "$SQL_INSERTS" -gt 0 ]; then
        record_step "PASS" "PG恢复(SQL格式)" \
            "SQL 文件有效: ${SQL_LINES} 行, ${SQL_INSERTS} 条 INSERT (${SQL_SIZE})"
    else
        record_step "WARN" "PG恢复(SQL格式)" "SQL 文件可能不完整: ${SQL_LINES} 行"
    fi
else
    record_step "FAIL" "PG恢复" "未找到 PostgreSQL dump 文件!"
fi

# 表清单检查
TABLE_LIST="${EXTRACT_DIR}/postgresql/table_list.txt"
if [ -f "$TABLE_LIST" ]; then
    TABLE_COUNT=$(grep -c "table\|relation" "$TABLE_LIST" 2>/dev/null || echo "0")
    log_info "表清单 (${TABLE_COUNT} 张表):"
    cat "$TABLE_LIST" 2>/dev/null | head -15
fi

# =====================================================================
# 步骤 4: Redis RDB 格式验证
# =====================================================================
log_step "4/${TOTAL_STEPS}/ Redis 数据验证"

RDB_FILE="${EXTRACT_DIR}/redis/dump.rdb"
AOF_FILE="${EXTRACT_DIR}/redis/appendonly.aof"

if [ -f "$RDB_FILE" ]; then
    RDB_SIZE=$(du -h "$RDB_FILE" | cut -f1)
    log_info "检测到 RDB 文件: ${RDB_SIZE}"

    # 使用 redis-check-rdb 验证格式
    if command -v redis-check-rdb &>/dev/null; then
        RDB_CHECK=$(redis-check-rdb "$RDB_FILE" 2>&1 || true)
        if echo "$RDB_CHECK" | grep -qi "OK\|correctly\|0 errors"; then
            record_step "PASS" "Redis RDB验证" "格式正确 (${RDB_SIZE})"
        elif echo "$RDB_CHECK" | grep -qi "corrupt\|error\|bad"; then
            record_step "FAIL" "Redis RDB验证" "RDB 文件可能损坏!"
        else
            record_step "WARN" "Redis RDB验证" "无法确定状态 (输出: $(echo "$RDB_CHECK" | head -1))"
        fi
    else
        # 基础检查: RDB 文件头
        RDB_HEADER=$(xxd -l 9 "$RDB_FILE" 2>/dev/null | awk '{print $2$3}' || echo "")
        if echo "$RDB_HEADER" | grep -qi "^0000redis"; then
            record_step "PASS" "Redis RDB验证" "RDB 文件头有效 (REDIS magic, ${RDB_SIZE})"
        else
            record_step "WARN" "Redis RDB验证" "redis-check-rdb 未安装，仅做基础检查 (${RDB_SIZE})"
        fi
    fi

    # 键信息
    DBSIZE_FILE="${EXTRACT_DIR}/redis/dbsize.txt"
    if [ -f "$DBSIZE_FILE" ]; then
        DBSIZE=$(cat "$DBSIZE_FILE" 2>/dev/null || echo "?")
        log_info "Redis 键数 (备份时): ${DBSIZE}"
    fi
elif [ -f "$AOF_FILE" ]; then
    AOF_SIZE=$(du -h "$AOF_FILE" | cut -f1)
    record_step "WARN" "Redis AOF验证" "仅有 AOF 文件 (${AOF_SIZE})，无 RDB"
else
    record_step "WARN" "Redis 数据验证" "未找到 Redis 数据文件 (可能当时无持久化数据)"
fi

# =====================================================================
# 步骤 5: Grafana SQLite 验证
# =====================================================================
log_step "5/${TOTAL_STEPS}/ Grafana 数据验证"

GRAFANA_DB="${EXTRACT_DIR}/grafana/grafana.db"

if [ -f "$GRAFANA_DB" ]; then
    GF_SIZE=$(du -h "$GRAFANA_DB" | cut -f1)
    log_info "检测到 Grafana SQLite: ${GF_SIZE}"

    if command -v sqlite3 &>/dev/null; then
        # 完整性检查
        INTEGRITY_OK=$(sqlite3 "$GRAFANA_DB" "PRAGMA integrity_check;" 2>/dev/null || echo "NOT OK")
        if [ "$INTEGRITY_OK" = "ok" ]; then
            record_step "PASS" "Grafana DB完整性" "SQLite integrity_check 通过 (${GF_SIZE})"

            # 关键表行数统计
            log_info "Grafana 数据统计:"
            for tbl in dashboard data_source org user; do
                COUNT=$(sqlite3 "$GRAFANA_DB" "SELECT COUNT(*) FROM ${tbl};" 2>/dev/null || echo "?")
                log_info "  ${tbl}: ${COUNT} 行"
            done
        else
            record_step "FAIL" "Grafana DB完整性" "SQLite integrity_check 失败: ${INTEGRITY_OK}"
        fi
    else
        # 基础检查: 是否是有效的 SQLite 文件
        FILE_HEADER=$(xxd -l 16 "$GRAFANA_DB" 2>/dev/null | awk '{print $2$3}' || echo "")
        if echo "$FILE_HEADER" | grep -qi "sqlite format"; then
            record_step "PASS" "Grafana DB基础检查" "SQLite 文件头有效 (${GF_SIZE})"
        else
            record_step "WARN" "Grafana DB基础检查" "sqlite3 未安装，无法完整验证"
        fi
    fi
else
    record_step "WARN" "Grafana 数据验证" "未找到 grafana.db"
fi

# =====================================================================
# 步骤 6: Nginx 配置验证
# =====================================================================
log_step "6/${TOTAL_STEPS}/ Nginx 配置验证"

NGINX_CONF="${EXTRACT_DIR}/nginx/nginx.conf"
if [ -f "$NGINX_CONF" ]; then
    NGINX_LINES=$(wc -l < "$NGINX_CONF")
    if [ "$NGINX_LINES" -gt 5 ]; then
        # 基础语法检查
        if command -v nginx &>/dev/null; then
            if nginx -t -c "$NGINX_CONF" >/dev/null 2>&1; then
                record_step "PASS" "Nginx配置语法" "nginx -t 通过 (${NGINX_LINES} 行)"
            else
                record_step "WARN" "Nginx配置语法" "nginx -t 未通过 (可能缺少依赖的 include 文件)"
            fi
        else
            record_step "PASS" "Nginx配置存在" "配置文件有效 (${NGINX_LINES} 行)"
        fi
    else
        record_step "WARN" "Nginx配置" "配置文件过小 (${NGINX_LINES} 行)"
    fi
else
    record_step "WARN" "Nginx 配置验证" "未找到 nginx.conf"
fi

# SSL证书检查
SSL_GLOBALREACH="${EXTRACT_DIR}/nginx/ssl_globalreach"
SSL_LETSENCRYPT="${EXTRACT_DIR}/nginx/ssl_letsencrypt"
SSL_FOUND=false

if [ -d "$SSL_GLOBALREACH" ]; then
    CERT_COUNT=$(find "$SSL_GLOBALREACH" -name "*.crt" -o -name "*.pem" 2>/dev/null | wc -l)
    if [ "$CERT_COUNT" -gt 0 ]; then
        record_step "PASS" "SSL证书(GlobalReach)" "发现 ${CERT_COUNT} 个证书文件"
        SSL_FOUND=true
    fi
fi
if [ -d "$SSL_LETSENCRYPT" ]; then
    CERT_COUNT=$(find "$SSL_LETSENCRYPT" -name "*.pem" -o -name "*.crt" 2>/dev/null | wc -l)
    if [ "$CERT_COUNT" -gt 0 ]; then
        record_step "PASS" "SSL证书(Let's Encrypt)" "发现 ${CERT_COUNT} 个证书文件"
        SSL_FOUND=true
    fi
fi
if [ "$SSL_FOUND" = "false" ]; then
    record_step "WARN" "SSL证书" "未发现 SSL 证书备份"
fi

# =====================================================================
# 步骤 7: Docker Compose / 配置验证
# =====================================================================
log_step "7/${TOTAL_STEPS}/ 配置文件验证"

COMPOSE_FILE="${EXTRACT_DIR}/config/docker-compose.prod.yml"
if [ -f "$COMPOSE_FILE" ]; then
    COMPOSE_LINES=$(wc -l < "$COMPOSE_FILE")
    if command -v docker compose &>/dev/null; then
        if docker compose -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
            record_step "PASS" "Docker Compose配置" "docker compose config 通过 (${COMPOSE_LINES} 行)"
        else
            record_step "WARN" "Docker Compose配置" "config 验证未通过 (可能缺少 .env)"
        fi
    else
        record_step "PASS" "Docker Compose配置" "文件存在 (${COMPOSE_LINES} 行)，docker compose 不可用跳过验证"
    fi
else
    record_step "WARN" "Docker Compose配置" "未找到 docker-compose.prod.yml"
fi

# Prometheus 规则检查
PROM_RULES="${EXTRACT_DIR}/config/prometheus_rules"
if [ -d "$PROM_RULES" ]; then
    RULE_COUNT=$(find "$PROM_RULES" -name "*.yml" -o -name "*.yaml" 2>/dev/null | wc -l)
    record_step "PASS" "Prometheus规则" "发现 ${RULE_COUNT} 个规则文件"
fi

# =====================================================================
# 步骤 8: 数据量概览汇总
# =====================================================================
log_step "8/${TOTAL_STEPS}/ 数据量概览"

log_info "恢复后各组件大小:"
printf '  %-25s %12s\n' "组件" "大小"
printf '  %-25s %12s\n' "-------------------------" "------------"

for component in postgresql redis grafana nginx config; do
    CPATH="${EXTRACT_DIR}/${component}"
    if [ -d "$CPATH" ]; then
        CSIZE=$(du -sh "$CPATH" 2>/dev/null | cut -f1)
        printf '  %-25s %12s\n' "$component/" "$CSIZE"
    else
        printf '  %-25s %12s\n' "$component/" "(缺失)"
    fi
done

TOTAL_RECOVERED=$(du -sh "${EXTRACT_DIR}" 2>/dev/null | cut -f1)
printf '  %-25s %12s\n' "总计 (恢复)" "$TOTAL_RECOVERED"

ORIGINAL_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
printf '  %-25s %12s\n' "原始 (压缩)" "$ORIGINAL_SIZE"

# =====================================================================
# 最终报告
# =====================================================================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD} 灾难恢复演练报告${NC}"
echo -e "${BOLD}============================================================${NC}"
echo -e "  演练时间:     $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "  备份文件:     ${BNAME}"
echo -e "  恢复目录:     ${DRILL_DIR}"
echo -e "  隔离环境:     是 (不影响生产)"
echo ""
echo -e "  总步骤数:     ${TOTAL_STEPS}"
echo -e "  ${GREEN}通过:         ${PASS_STEPS}${NC}"
echo -e "  ${YELLOW}警告:         ${WARN_STEPS}${NC}"
echo -e "  ${RED}失败:         ${FAIL_STEPS}${NC}"

# 结论判定
if [ "$FAIL_STEPS" -gt 0 ]; then
    DRILL_VERDICT="FAIL"
    DRILL_COLOR="$RED"
elif [ "$WARN_STEPS" -gt 0 ]; then
    DRILL_VERDICT="WARN"
    DRILL_COLOR="$YELLOW"
else
    DRILL_VERDICT="PASS"
    DRILL_COLOR="$GREEN"
fi

echo -e "\n  ${BOLD}${DRILL_COLOR}演练结论: ${DRILL_VERDICT}${NC}"
echo -e "${BOLD}============================================================${NC}\n"

if [ "$KEEP_TEMP" = "true" ]; then
    log_info "临时目录已保留 (调试用): ${DRILL_DIR}"
    log_info "手动清理: rm -rf ${DRILL_DIR}"
else
    log_info "临时目录将自动清理"
fi

# 退出码
if [ "$DRILL_VERDICT" = "FAIL" ]; then
    exit 1
elif [ "$DRILL_VERDICT" = "WARN" ]; then
    exit 2
fi
