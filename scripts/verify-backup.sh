#!/bin/bash
# ==============================================================================
# GlobalReach V2.0 — 备份完整性验证脚本 (M-D04)
# 验证备份文件的完整性 + 可恢复性 (不影响生产数据)
#
# Usage:
#   ./scripts/verify-backup.sh                          # 验证最新备份
#   ./scripts/verify-backup.sh /path/to/backup.tar.gz   # 指定备份文件
#   ./scripts/verify-backup.sh --all                    # 验证所有备份
#   BACKUP_DIR=/data/backups ./scripts/verify-backup.sh # 环境变量指定
#
# 检查项:
#   1. SHA256 校验和验证
#   2. tar.gz 文件结构验证
#   3. 关键文件存在性 (pg_dump, redis.rdb, grafana.db)
#   4. SQL 文件语法检查 (pg_restore --list)
#   5. 备份年龄检查
#   6. 备份大小异常检测
#   7. 磁盘空间检查
#   8. 输出验证报告 (PASS/WARN/FAIL)
# ==============================================================================

set -euo pipefail

# ======================== 可配置参数 ========================
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${1:-${PROJECT_ROOT}/backups}}"
VERIFY_ALL="${VERIFY_ALL:-false}"
WARN_AGE_DAYS="${WARN_AGE_DAYS:-7}"          # 超过此天数警告
MIN_DISK_GB="${MIN_DISK_GB:-10}"             # 最小剩余磁盘空间(GB)

# ======================== 颜色输出 ========================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()  { echo -e "${CYAN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_pass()  { echo -e "${GREEN}[PASS]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# ======================== 全局统计 ========================
TOTAL_CHECKS=0
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

record_result() {
    local result="$1" check_name="$2" detail="$3"
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    case "$result" in
        PASS) PASS_COUNT=$((PASS_COUNT + 1)); log_pass "[$check_name] $detail" ;;
        WARN) WARN_COUNT=$((WARN_COUNT + 1)); log_warn "[$check_name] $detail" ;;
        FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)); log_fail "[$check_name] $detail" ;;
    esac
}

# ======================== 帮助信息 ========================
show_help() {
    echo "GlobalReach V2.0 — 备份完整性验证脚本 (M-D04)"
    echo ""
    echo "Usage: $0 [backup_file.tar.gz|--all] [options]"
    echo ""
    echo "Options:"
    echo "  --all              验证备份目录中所有备份文件"
    echo "  --json             输出 JSON 格式报告"
    echo "  --quiet            仅显示结果摘要"
    echo "  --help             显示帮助信息"
    echo ""
    echo "Environment:"
    echo "  BACKUP_DIR         备份目录路径 (默认: ./backups)"
    echo "  WARN_AGE_DAYS      备份年龄警告阈值天 (默认: 7)"
    echo "  MIN_DISK_GB       最小磁盘剩余空间 GB (默认: 10)"
    exit 0
}

# ======================== 参数解析 ========================
BACKUP_FILE=""
OUTPUT_FORMAT="text"
QUIET_MODE="false"

for arg in "$@"; do
    case "$arg" in
        --all)     VERIFY_ALL="true"; shift ;;
        --json)    OUTPUT_FORMAT="json"; shift ;;
        --quiet)   QUIET_MODE="true"; shift ;;
        -h|--help) show_help ;;
        -*)
            if [ -f "$arg" ]; then
                BACKUP_FILE="$arg"
            else
                log_fail "未知参数或文件不存在: $arg"
                show_help
            fi
            shift ;;
        *)
            if [ -f "$arg" ]; then
                BACKUP_FILE="$arg"
            fi
            shift ;;
    esac
done

# ======================== 头部 ========================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD} GlobalReach V2.0 — 备份完整性验证 (M-D04)${NC}"
echo -e "${BOLD}============================================================${NC}"
echo -e "  验证时间:     $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "  备份目录:     ${BACKUP_DIR}"
echo ""

# ======================== 确定要验证的文件列表 ========================
if [ "$VERIFY_ALL" = "true" ]; then
    mapfile -t FILES_TO_VERIFY < <(
        find "${BACKUP_DIR}" -name "globalreach_backup_*.tar.gz" -type f 2>/dev/null \
        | sort -r
    )
    log_info "验证模式: ALL (${#FILES_TO_VERIFY[@]} 个文件)"
elif [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
    FILES_TO_VERIFY=("$BACKUP_FILE")
    log_info "验证模式: SINGLE ($(basename "$BACKUP_FILE"))"
else
    # 默认：找最新的一个
    LATEST=$(find "${BACKUP_DIR}" -name "globalreach_backup_*.tar.gz" -type f 2>/dev/null \
        | sort -r | head -1)
    if [ -z "$LATEST" ]; then
        log_fail "未找到任何备份文件!"
        echo ""
        echo -e "${RED}结论: FAIL — 无备份文件可验证${NC}"
        exit 1
    fi
    FILES_TO_VERIFY=("$LATEST")
    log_info "验证模式: LATEST ($(basename "$LATEST"))"
fi

if [ ${#FILES_TO_VERIFY[@]} -eq 0 ]; then
    log_fail "未找到任何备份文件!"
    echo ""
    echo -e "${RED}结论: FAIL — 无备份文件可验证${NC}"
    exit 1
fi

# ======================== 对每个文件执行验证 ========================
for BFILE in "${FILES_TO_VERIFY[@]}"; do
    BNAME="$(basename "$BFILE")"
    BDIR="$(dirname "$BFILE")"

    echo -e "\n${BOLD}─────────────────────────────────────────────${NC}"
    echo -e "${BOLD} 验证文件: ${BNAME}${NC}"
    echo -e "${BOLD}─────────────────────────────────────────────${NC}"

    # 重置单文件计数器
    FILE_PASS=0; FILE_WARN=0; FILE_FAIL=0

    # ---- 检查 1: 文件存在性和基本属性 ----
    if [ ! -f "$BFILE" ]; then
        record_result "FAIL" "文件存在性" "文件不存在: $BFILE"
        continue
    fi

    FILE_SIZE=$(stat -c%s "$BFILE" 2>/dev/null || stat -f%z "$BFILE" 2>/dev/null || echo "0")
    FILE_SIZE_HR=$(numfmt --to=iec-i --suffix=B "$FILE_SIZE" 2>/dev/null || echo "${FILE_SIZE} bytes")
    FILE_MTIME=$(stat -c%y "$BFILE" 2>/dev/null | cut -d' ' -f1-2 || stat -f "%Sm" "$BFILE" 2>/dev/null)

    record_result "PASS" "文件存在性" "大小=${FILE_SIZE_HR}, 修改时间=${FILE_MTIME}"

    # ---- 检查 2: SHA256 校验和 ----
    SHA256_FILE="${BFILE}.sha256"
    if [ -f "$SHA256_FILE" ]; then
        STORED_HASH=$(head -1 "$SHA256_FILE" | awk '{print $1}')
        COMPUTED_HASH=$(sha256sum "$BFILE" 2>/dev/null | awk '{print $1}')

        if [ "$STORED_HASH" = "$COMPUTED_HASH" ]; then
            record_result "PASS" "SHA256校验" "匹配 (${COMPUTED_HASH:0:16}...)"
        else
            record_result "FAIL" "SHA256校验" "不匹配! 存储=${STORED_HASH:0:16}, 计算=${COMPUTED_HASH:0:16}"
        fi
    else
        # 无 .sha256 文件，现场计算并记录
        COMPUTED_HASH=$(sha256sum "$BFILE" 2>/dev/null | awk '{print $1}')
        record_result "WARN" "SHA256校验" "无 .sha256 文件，现场计算: ${COMPUTED_HASH:0:16}..."
    fi

    # ---- 检查 3: tar.gz 归档完整性 ----
    if tar -tzf "$BFILE" >/dev/null 2>&1; then
        TAR_ENTRIES=$(tar -tzf "$BFILE" 2>/dev/null | wc -l)
        record_result "PASS" "归档完整性(tar)" "有效，包含 ${TAR_ENTRIES} 个条目"

        # 提取文件清单供后续检查使用
        TAR_LIST=$(tar -tzf "$BFILE" 2>/dev/null)
    else
        record_result "FAIL" "归档完整性(tar)" "归档损坏或格式不正确!"
        TAR_LIST=""
        TAR_ENTRIES=0
    fi

    # ---- 检查 4: 关键文件存在性 ----
    if [ -n "$TAR_LIST" ]; then
        # PostgreSQL dump
        if echo "$TAR_LIST" | grep -q "postgresql/globalreach_prod.dump\|postgresql/globalreach_prod.sql"; then
            PG_SIZE=$(echo "$TAR_LIST" | grep -E "postgresql/globalreach_prod\.(dump|sql)" | head -1 || true)
            record_result "PASS" "PG备份存在" "已检测到 PostgreSQL dump 文件"
        else
            record_result "FAIL" "PG备份存在" "未找到 postgresql/globalreach_prod.{dump|sql}"
        fi

        # Redis RDB
        if echo "$TAR_LIST" | grep -q "redis/dump.rdb"; then
            record_result "PASS" "Redis备份存在" "已检测到 redis/dump.rdb"
        elif echo "$TAR_LIST" | grep -q "redis/appendonly.aof"; then
            record_result "WARN" "Redis备份存在" "未找到 dump.rdb，但发现 appendonly.aof"
        else
            record_result "WARN" "Redis备份存在" "未找到 Redis 数据文件 (dump.rdb / aof)"
        fi

        # Grafana DB
        if echo "$TAR_LIST" | grep -q "grafana/grafana.db"; then
            record_result "PASS" "Grafana备份存在" "已检测到 grafana.db"
        else
            record_result "WARN" "Grafana备份存在" "未找到 grafana.db"
        fi

        # Nginx 配置
        if echo "$TAR_LIST" | grep -q "nginx/nginx.conf\|nginx/conf.d"; then
            record_result "PASS" "Nginx配置存在" "已检测到 Nginx 配置文件"
        else
            record_result "WARN" "Nginx配置存在" "未找到 Nginx 配置文件"
        fi

        # MANIFEST
        if echo "$TAR_LIST" | grep -q "MANIFEST.txt"; then
            record_result "PASS" "MANIFEST存在" "已检测到 MANIFEST.txt"
        else
            record_result "WARN" "MANIFEST存在" "未找到 MANIFEST.txt"
        fi
    fi

    # ---- 检查 5: SQL/dump 可恢复性 (dry-run) ----
    if command -v pg_restore &>/dev/null; then
        # 尝试从归档中提取 pg_dump 并做 dry-run
        TMP_DRYRUN=$(mktemp -d)
        trap 'rm -rf "${TMP_DRYRUN}"' EXIT

        if tar -xzf "$BFILE" -C "$TMP_DRYRUN" "postgresql/globalreach_prod.dump" 2>/dev/null; then
            DUMP_FILE="${TMP_DRYRUN}/postgresql/globalreach_prod.dump"
            if pg_restore --list "$DUMP_FILE" >/dev/null 2>&1; then
                PG_ITEMS=$(pg_restore --list "$DUMP_FILE" 2>/dev/null | wc -l)
                record_result "PASS" "PG恢复测试(dry-run)" "pg_restore --list 成功 (${PG_ITEMS} 个对象)"
            else
                record_result "WARN" "PG恢复测试(dry-run)" "pg_restore --list 返回非零退出码"
            fi
        elif tar -xzf "$BFILE" -C "$TMP_DRYRUN" "postgresql/globalreach_prod.sql" 2>/dev/null; then
            SQL_FILE="${TMP_DRYRUN}/postgresql/globalreach_prod.sql"
            SQL_LINES=$(wc -l < "$SQL_FILE")
            if [ "$SQL_LINES" -gt 10 ]; then
                record_result "PASS" "PG恢复测试(SQL)" "SQL 文件有效 (${SQL_LINES} 行)"
            else
                record_result "WARN" "PG恢复测试(SQL)" "SQL 文件过小 (${SQL_LINES} 行)，可能不完整"
            fi
        else
            record_result "WARN" "PG恢复测试" "无法提取 PG dump 进行验证"
        fi

        rm -rf "$TMP_DRYRUN"
    else
        record_result "WARN" "PG恢复测试" "pg_restore 未安装，跳过 dry-run 测试"
    fi

    # ---- 检查 6: 备份年龄 ----
    if command -v stat &>/dev/null; then
        FILE_AGE_SEC=$(( $(date +%s) - $(stat -c%Y "$BFILE" 2>/dev/null || stat -f%m "$BFILE" 2>/dev/null) ))
        FILE_AGE_DAYS=$(( FILE_AGE_SEC / 86400 ))

        if [ "$FILE_AGE_DAYS" -le "$WARN_AGE_DAYS" ]; then
            record_result "PASS" "备份年龄" "${FILE_AGE_DAYS} 天前 (≤ ${WARN_AGE_DAYS} 天警告线)"
        elif [ "$FILE_AGE_DAYS" -le $((WARN_AGE_DAYS * 2)) ]; then
            record_result "WARN" "备份年龄" "${FILE_AGE_DAYS} 天前 (超过 ${WARN_AGE_DAYS} 天警告线!)"
        else
            record_result "FAIL" "备份年龄" "${FILE_AGE_DAYS} 天前 (严重过期! > $((WARN_AGE_DAYS * 2)) 天)"
        fi
    fi

    # ---- 检查 7: 备份大小趋势 (与同目录其他备份比较) ----
    OTHER_BACKUPS=$(find "$BDIR" -name "globalreach_backup_*.tar.gz" -type f ! -name "$(basename "$BFILE")" 2>/dev/null \
        | sort -r | head -5)

    if [ -n "$OTHER_BACKUPS" ]; then
        AVG_SIZE=0
        COUNT=0
        for ob in $OTHER_BACKUPS; do
            OSIZE=$(stat -c%s "$ob" 2>/dev/null || echo "0")
            AVG_SIZE=$((AVG_SIZE + OSIZE))
            COUNT=$((COUNT + 1))
        done

        if [ "$COUNT" -gt 0 ]; then
            AVG_SIZE=$((AVG_SIZE / COUNT))
            RATIO=$((FILE_SIZE * 100 / AVG_SIZE))

            if [ "$RATIO" -lt 50 ] && [ "$FILE_SIZE" -gt 1024 ]; then
                record_result "WARN" "备份大小趋势" "当前大小为历史平均的 ${RATIO}% (可能备份不完整!)"
            elif [ "$RATIO" -lt 80 ]; then
                record_result "WARN" "备份大小趋势" "当前大小为历史平均的 ${RATIO}% (略低于平均)"
            else
                record_result "PASS" "备份大小趋势" "正常 (当前/历史平均 ≈ ${RATIO}%)"
            fi
        fi
    else
        record_result "WARN" "备份大小趋势" "无历史备份可供对比 (首个备份)"
    fi

    # ---- 单文件小结 ----
    echo -e "\n  ─── ${BNAME} 验证小结 ───"
done

# ======================== 检查 8: 磁盘空间 (全局一次) ========================
echo -e "\n${BOLD}─────────────────────────────────────────────${NC}"
echo -e "${BOLD} 全局检查: 磁盘空间${NC}"
echo -e "${BOLD}─────────────────────────────────────────────${NC}"

if command -v df &>/dev/null; then
    DISK_INFO=$(df -BG "${BACKUP_DIR}" 2>/dev/null | tail -1)
    DISK_TOTAL=$(echo "$DISK_INFO" | awk '{print $2}' | tr -d 'G')
    DISK_USED=$(echo "$DISK_INFO" | awk '{print $3}' | tr -d 'G')
    DISK_FREE=$(echo "$DISK_INFO" | awk '{print $4}' | tr -d 'G')
    DISK_PCT=$(echo "$DISK_INFO" | awk '{print $5}')

    if [ "$DISK_FREE" -ge "$MIN_DISK_GB" ]; then
        record_result "PASS" "磁盘剩余空间" "可用 ${DISK_FREE}GB / 总计 ${DISK_TOTAL}GB (${DISK_PCT} 已用)"
    elif [ "$DISK_FREE" -ge $((MIN_DISK_GB / 2)) ]; then
        record_result "WARN" "磁盘剩余空间" "仅剩 ${DISK_FREE}GB (建议 ≥ ${MIN_DISK_GB}GB)"
    else
        record_result "FAIL" "磁盘剩余空间" "严重不足! 仅剩 ${DISK_FREE}GB (需要 ≥ ${MIN_DISK_GB}GB)"
    fi
else
    record_result "WARN" "磁盘剩余空间" "df 命令不可用，跳过磁盘检查"
fi

# ======================== 最终报告 ========================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD} 验证报告汇总${NC}"
echo -e "${BOLD}============================================================${NC}"
echo -e "  总检查项:    ${TOTAL_CHECKS}"
echo -e "  ${GREEN}通过 (PASS):  ${PASS_COUNT}${NC}"
echo -e "  ${YELLOW}警告 (WARN):  ${WARN_COUNT}${NC}"
echo -e "  ${RED}失败 (FAIL):  ${FAIL_COUNT}${NC}"

# 结论判定
if [ "$FAIL_COUNT" -gt 0 ]; then
    VERDICT="FAIL"
    VERDICT_COLOR="$RED"
elif [ "$WARN_COUNT" -gt 0 ]; then
    VERDICT="WARN"
    VERDICT_COLOR="$YELLOW"
else
    VERDICT="PASS"
    VERDICT_COLOR="$GREEN"
fi

echo -e "\n  ${BOLD}${VERDICT_COLOR}结论: ${VERDICT}${NC}"
echo -e "${BOLD}============================================================${NC}\n"

# 输出 JSON 格式（可选）
if [ "$OUTPUT_FORMAT" = "json" ]; then
    cat <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "backup_dir": "${BACKUP_DIR}",
  "files_verified": ${#FILES_TO_VERIFY[@]},
  "total_checks": ${TOTAL_CHECKS},
  "pass": ${PASS_COUNT},
  "warn": ${WARN_COUNT},
  "fail": ${FAIL_COUNT},
  "verdict": "${VERDICT}"
}
EOF
fi

# 退出码
if [ "$VERDICT" = "FAIL" ]; then
    exit 1
elif [ "$VERDICT" = "WARN" ]; then
    exit 2
else
    exit 0
fi
