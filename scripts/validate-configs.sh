#!/usr/bin/env bash
# ============================================================================
# GlobalReach V2.0 — 配置验证防护网（Configuration Validation Safety Net）
# S132: 建立配置验证防护网
#
# 用法:
#   ./scripts/validate-configs.sh              # 全量检查所有配置
#   ./scripts/validate-configs.sh --fix        # 尝试自动修复已知问题
#   ./scripts/validate-configs.sh --ci         # CI模式（JSON输出+exit code）
#   ./scripts/validate-configs.sh --service nginx  # 仅检查指定服务
#
# 退出码:
#   0 = 全部通过
#   1 = 有失败项
#   2 = 有错误（无法继续验证）
#
# 兼容: Windows (Git Bash / WSL2) + Linux (CI)
# ============================================================================

set -euo pipefail

# ── 全局变量 ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="normal"          # normal | ci | fix
TARGET_SERVICE=""      # 空 = 全量, 或指定服务名
TOTAL_CHECKS=0
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
ERROR_COUNT=0

# 结果收集数组（用于 CI JSON 输出）
declare -a RESULTS=()
declare -a FAIL_DETAILS=()

# 颜色定义（CI 模式下禁用）
if [ -t 1 ] && [ "${MODE}" != "ci" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    BOLD=''
    NC=''
fi

# ── 工具函数 ───────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
${BOLD}GlobalReach 配置验证防护网${NC}

用法:
    $0 [选项]

选项:
    --fix           尝试自动修复已知问题（重命名 .snippet 文件等）
    --ci            CI 模式：输出 JSON 格式结果，使用 exit code
    --service NAME  仅检查指定服务 (nginx|alertmanager|prometheus|promtail|loki|docker-compose|postgres|redis)
    -h, --help      显示此帮助信息

退出码:
    0  全部检查通过
    1  存在失败项（需要人工处理）
    2  内部错误（无法执行验证）

示例:
    $0                          # 全量验证
    $0 --service nginx          # 只检查 Nginx
    $0 --ci                     # CI 环境运行
    $0 --fix                    # 自动修复可修复的问题
EOF
}

log_pass() { printf "  ${GREEN}✅ PASS${NC} — %s\n" "$1"; }
log_warn() { printf "  ${YELLOW}⚠️ WARN${NC} — %s\n" "$1"; }
log_fail() { printf "  ${RED}❌ FAIL${NC} — %s\n" "$1"; }
log_info() { printf "  ${CYAN}ℹ️  INFO${NC} — %s\n" "$1"; }

add_result() {
    local category="$1" status="$2" message="$3"
    RESULTS+=("{\"category\":\"$category\",\"status\":\"$status\",\"message\":\"$message\"}")
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    case "$status" in
        pass) PASS_COUNT=$((PASS_COUNT + 1)) ;;
        warn) WARN_COUNT=$((WARN_COUNT + 1)) ;;
        fail) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
        error) ERROR_COUNT=$((ERROR_COUNT + 1)) ;;
    esac
}

add_fail_detail() {
    FAIL_DETAILS+=("$1")
}

# 获取 Git HEAD（如果可用）
get_git_head() {
    if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
        git rev-parse --short HEAD 2>/dev/null || echo "unknown"
    else
        echo "n/a"
    fi
}

# YAML 语法检查（使用 python3 或 python）
check_yaml_syntax() {
    local file="$1"
    if command -v python3 &>/dev/null; then
        python3 -c "
import yaml, sys
try:
    with open('$file', 'r') as f:
        yaml.safe_load(f)
    print('OK')
except yaml.YAMLError as e:
    print(f'YAML_ERROR: {e}')
except Exception as e:
    print(f'ERROR: {e}')
" 2>/dev/null
    elif command -v python &>/dev/null; then
        python -c "
import yaml, sys
try:
    with open(r'$file', 'r') as f:
        yaml.safe_load(f)
    print('OK')
except Exception as e:
    print(f'ERROR: {e}')
" 2>/dev/null
    else
        echo "SKIP: no python available"
    fi
}

# ── 参数解析 ───────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --fix)   MODE="fix" ;;
        --ci)    MODE="ci" ;;
        --service) shift; TARGET_SERVICE="$1" ;;
        -h|--help) usage; exit 0 ;;
        *) echo "未知参数: $1"; usage; exit 2 ;;
    esac
    shift
done

# ============================================================================
# A. Docker Compose 配置验证
# ============================================================================

check_docker_compose() {
    if [ -n "$TARGET_SERVICE" ] && [ "$TARGET_SERVICE" != "docker-compose" ]; then
        return 0
    fi

    local category="[Docker Compose]"
    local compose_file="$PROJECT_ROOT/docker-compose.prod.yml"
    local errors=0 warnings=0

    echo ""
    echo -e "${BOLD}${category}${NC}"

    # A1. docker compose config 语法验证
    if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
        local dc_output
        if dc_output=$(docker compose -f "$compose_file" config 2>&1); then
            log_pass "docker compose config 语法正确"
            add_result "Docker Compose" "pass" "config syntax OK"
        else
            log_fail "docker compose config 失败: $(echo "$dc_output" | head -3)"
            add_result "Docker Compose" "fail" "config syntax error"
            errors=$((errors + 1))
            add_fail_detail "[FAIL] Docker Compose: config validation failed"
        fi
    else
        log_warn "docker 命令不可用，跳过 compose config 验证"
        add_result "Docker Compose" "warn" "docker not available"
        warnings=$((warnings + 1))
    fi

    # A2. 服务名引用检查 — 提取 compose 中定义的服务名，检查 depends_on 和 proxy_pass 引用
    if [ -f "$compose_file" ]; then
        # 提取 services 下的一级服务名
        local defined_services
        defined_services=$(grep -E '^\s{2}[a-z][a-z0-9_-]+:' "$compose_file" | grep -vE '(image|build|container_name|restart|volumes|environment|networks|ports|healthcheck|deploy|depends_on|command|entrypoint|profiles|user|labels)' | sed 's/.*\([a-z][a-z0-9_-]*\):.*/\1/' | sort -u)

        # 从 nginx 配置中提取 proxy_pass 引用的上游主机名
        local upstream_refs=""
        for nf in "$PROJECT_ROOT"/nginx/conf.d/*.conf; do
            [ -f "$nf" ] || continue
            local refs
            refs=$(grep -oP 'proxy_pass\s+http://[\w.-]+' "$nf" 2>/dev/null | sed 's/.*http:\/\///' | sort -u || true)
            if [ -n "$refs" ]; then
                upstream_refs="$upstream_refs $refs"
            fi
        done

        # 检查每个引用是否在 compose 中有对应容器名或服务名
        local unresolved=0
        for ref in $upstream_refs; do
            # 跳过 IP 地址和 localhost
            if echo "$ref" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$|^localhost$'; then
                continue
            fi
            # 检查是否匹配某个 container_name 或 service name
            local found=0
            while IFS= read -r svc; do
                if echo "$ref" | grep -qi "^${svc}$\|-${svc}$\|${svc}-"; then
                    found=1
                    break
                fi
            done <<< "$defined_services"

            # 也检查 container_name
            if [ "$found" -eq 0 ]; then
                if grep -q "container_name:.*$ref" "$compose_file" 2>/dev/null; then
                    found=1
                fi
            fi

            if [ "$found" -eq 0 ]; then
                # 特殊情况：api_backend 是 upstream 定义，不是直接的服务名
                if [ "$ref" != "api_backend" ]; then
                    log_warn "upstream '$ref' 在 docker-compose.prod.yml 中未找到对应服务/容器"
                    add_result "Docker Compose" "warn" "unresolved upstream: $ref"
                    warnings=$((warnings + 1))
                    unresolved=$((unresolved + 1))
                fi
            fi
        done

        if [ "$unresolved" -eq 0 ] && [ -n "$upstream_refs" ]; then
            log_pass "所有 upstream 引用均可在 compose 文件中解析 ($upstream_refs)"
            add_result "Docker Compose" "pass" "all upstream refs resolved"
        elif [ -z "$upstream_refs" ]; then
            log_info "未发现需要检查的 upstream 引用"
        fi
    fi

    # A3. Volume mount 本地路径存在性检查（仅警告，不阻断）
    if [ -f "$compose_file" ]; then
        local volume_paths
        volume_paths=$(grep -oP '\./[^:]+' "$compose_file" 2>/dev/null | sed 's/^\.\///' | sort -u || true)
        local missing_vols=0
        for vp in $volume_paths; do
            full_path="$PROJECT_ROOT/$vp"
            if [ ! -d "$full_path" ] && [ ! -f "$full_path" ]; then
                log_warn "volume mount 路径不存在: ./$vp"
                add_result "Docker Compose" "warn" "missing volume path: $vp"
                warnings=$((warnings + 1))
                missing_vols=$((missing_vols + 1))
            fi
        done
        if [ "$missing_vols" -eq 0 ] && [ -n "$volume_paths" ]; then
            log_pass "所有 volume mount 本地路径均存在"
            add_result "Docker Compose" "pass" "all volume paths exist"
        fi
    fi

    # A4. 端口冲突检查
    if [ -f "$compose_file" ]; then
        local port_map
        port_map=$(grep -oP '"\d+:\d+"' "$compose_file" 2>/dev/null | tr -d '"' | sort || true)
        local dup_ports
        dup_ports=$(echo "$port_map" | uniq -d || true)
        if [ -n "$dup_ports" ]; then
            log_fail "端口冲突检测到: $dup_ports"
            add_result "Docker Compose" "fail" "port conflict: $dup_ports"
            errors=$((errors + 1))
            add_fail_detail "[FAIL] Docker Compose: port conflicts: $dup_ports"
        else
            log_pass "无端口冲突"
            add_result "Docker Compose" "pass" "no port conflicts"
        fi
    fi

    # 输出汇总
    if [ "$errors" -eq 0 ] && [ "$warnings" -eq 0 ]; then
        : # 已在上面逐项输出
    fi
}

# ============================================================================
# B. Nginx 配置验证
# ============================================================================

check_nginx() {
    if [ -n "$TARGET_SERVICE" ] && [ "$TARGET_SERVICE" != "nginx" ]; then
        return 0
    fi

    local category="[Nginx]"
    local nginx_conf_dir="$PROJECT_ROOT/nginx/conf.d"
    local errors=0 warnings=0

    echo ""
    echo -e "${BOLD}${category}${NC}"

    # 遍历所有 .conf 文件（排除 .snippet 文件）
    local conf_files=()
    while IFS= read -r -d '' f; do
        conf_files+=("$f")
    done < <(find "$nginx_conf_dir" -maxdepth 1 -name "*.conf" -print0 2>/dev/null | sort -z)

    if [ ${#conf_files[@]} -eq 0 ]; then
        log_warn "nginx/conf.d/ 目录下没有 .conf 文件"
        add_result "Nginx" "warn" "no conf files found"
        return 0
    fi

    for conf_file in "${conf_files[@]}"; do
        local basename
        basename="$(basename "$conf_file")"
        local file_errors=0 file_warnings=0

        # B1. location 指令上下文检查
        # location 必须出现在 server {} 或 http {} 块内
        # 简化版：检查文件中是否有裸露的 location（不在 server 块内的）
        local in_server_block=0
        local line_num=0
        local brace_depth=0
        local server_depth=-1  # server 块的深度
        local has_server=false
        local bare_locations=()

        while IFS= read -r line || [[ -n "$line" ]]; do
            line_num=$((line_num + 1))

            # 跳过注释和空行
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            [[ -z "${line// }" ]] && continue

            # 追踪花括号深度
            open_count=$(echo "$line" | grep -o '{' | wc -l || true)
            close_count=$(echo "$line" | grep -o '}' | wc -l || true)
            brace_depth=$((brace_depth + open_count - close_count))

            # 检测 server 块开始
            if echo "$line" | grep -qE '^\s*server\s*\{'; then
                has_server=true
                server_depth=$brace_depth
            fi

            # 检测 location 指令
            if echo "$line" | grep -qE '^\s*location'; then
                if ! $has_server; then
                    bare_locations+=("L$line_num")
                elif [ "$server_depth" -ge 0 ] && [ "$brace_depth" -le "$server_depth" ]; then
                    # location 不在 server 块内部
                    bare_locations+=("L$line_num (outside server block)")
                fi
            fi
        done < "$conf_file"

        if [ ${#bare_locations[@]} -gt 0 ]; then
            log_fail "$basename: location 指令出现在错误的上下文 (${bare_locations[*]})"
            add_result "Nginx" "fail" "$basename: bad location context at ${bare_locations[*]}"
            errors=$((errors + 1))
            file_errors=$((file_errors + 1))
            add_fail_detail "[FAIL] Nginx Config: $basename — location directive outside server/http block at ${bare_locations[*]}"
        else
            :
        fi

        # B2. upstream 引用检查
        local upstream_names
        upstream_names=$(grep -oP 'proxy_pass\s+http://[\w.-]+' "$conf_file" 2>/dev/null | sed 's/.*http:\/\/://' | sort -u || true)

        # 检查 upstream 块定义
        local defined_upstreams
        defined_upstreams=$(grep -oP 'upstream\s+[\w.-]+\s*\{' "$conf_file" 2>/dev/null | sed 's/upstream\s*//;s/\s*{//g' | sort -u || true)

        # 也检查同目录下其他文件中的 upstream 定义
        for other_conf in "$nginx_conf_dir"/*.conf "$nginx_conf_dir"/*.snippet; do
            [ -f "$other_conf" ] || continue
            local more_upstreams
            more_upstreams=$(grep -oP 'upstream\s+[\w.-]+\s*\{' "$other_conf" 2>/dev/null | sed 's/upstream\s*//;s/\s*{//g' | sort -u || true)
            defined_upstreams="$defined_upstreams $more_upstreams"
        done

        for up_ref in $upstream_names; do
            local found_upstream=0
            for du in $defined_upstreams; do
                if [ "$up_ref" = "$du" ]; then
                    found_upstream=1
                    break
                fi
            done

            # 如果不是 upstream 定义的名称，检查是否是容器名（Docker DNS）
            if [ "$found_upstream" -eq 0 ]; then
                # 容器名通常包含 globalreach- 前缀或为 postgres/redis/api 等
                if echo "$up_ref" | grep -qE '^(globalreach-|postgres|redis|api|loki|grafana|prometheus|alertmanager|promtail|tempo|mailpit|node-exporter|pg-exporter|certbot)'; then
                    : # 合法的容器名/DNS 引用
                else
                    log_warn "$basename: upstream 引用 '$up_ref' 未在 upstream 块中定义且不像合法的容器名"
                    add_result "Nginx" "warn" "$basename: unresolved upstream ref '$up_ref'"
                    warnings=$((warnings + 1))
                    file_warnings=$((file_warnings + 1))
                fi
            fi
        done

        # B3. SSL 证书路径检查（仅警告）
        local ssl_certs
        ssl_certs=$(grep -oP 'ssl_certificate\s+[^;]+' "$conf_file" 2>/dev/null | awk '{print $2}' | sort -u || true)
        for cert_path in $ssl_certs; do
            # 跳过变量和占位符
            if echo "$cert_path" | grep -qE '\$\{|<path>|/etc/nginx/ssl'; then
                continue
            fi
            if [ ! -f "$cert_path" ]; then
                log_warn "$basename: SSL 证书文件不存在: $cert_path"
                add_result "Nginx" "warn" "$basename: SSL cert missing: $cert_path"
                warnings=$((warnings + 1))
                file_warnings=$((file_warnings + 1))
            fi
        done

        # B4. 已弃用指令检查
        # http2 已被弃用（NGINX 1.25+），应使用 listen ... ssl 的协议协商
        if grep -qE 'listen\s+\d+\s+ssl\s+http2' "$conf_file" 2>/dev/null; then
            log_warn "$basename: 'listen ... ssl http2' 已弃用，建议移除 http2（NGINX 1.25+ 自动协议协商）"
            add_result "Nginx" "warn" "$basename: deprecated 'listen ... ssl http2'"
            warnings=$((warnings + 1))
            file_warnings=$((file_warnings + 1))
        fi

        # B5. .snippet 文件误用检查
        # 如果 MODE=fix 且发现有 .conf 文件实际应该是 snippet，尝试重命名
        if [ "$MODE" = "fix" ]; then
            # 检查是否以 location 开头但没有 server 包裹（说明可能是 snippet）
            if [ ${#bare_locations[@]} -gt 0 ] && ! grep -qE '^\s*server\s*\{' "$conf_file" 2>/dev/null; then
                local new_name="${conf_file}.snippet"
                if [ ! -f "$new_name" ]; then
                    mv "$conf_file" "$new_name"
                    log_info "$basename → 重命名为 .snippet（auto-fix）"
                    add_result "Nginx" "info" "$basename renamed to .snippet (auto-fix)"
                fi
            fi
        fi

        # 单文件汇总
        if [ "$file_errors" -eq 0 ] && [ "$file_warnings" -eq 0 ]; then
            log_pass "$basename: 0 errors, 0 warnings"
            add_result "Nginx" "pass" "$basename: clean"
        elif [ "$file_errors" -eq 0 ] && [ "$file_warnings" -gt 0 ]; then
            log_warn "$basename: 0 errors, $file_warnings warning(s)"
        else
            log_fail "$basename: $file_errors error(s), $file_warnings warning(s)"
        fi
    done
}

# ============================================================================
# C. AlertManager 配置验证
# ============================================================================

check_alertmanager() {
    if [ -n "$TARGET_SERVICE" ] && [ "$TARGET_SERVICE" != "alertmanager" ]; then
        return 0
    fi

    local category="[AlertManager]"
    local am_config="$PROJECT_ROOT/alertmanager/alertmanager.yml"
    local errors=0 warnings=0

    echo ""
    echo -e "${BOLD}${category}${NC}"

    if [ ! -f "$am_config" ]; then
        log_warn "alertmanager.yml 不存在，跳过检查"
        add_result "AlertManager" "warn" "config file not found"
        return 0
    fi

    # C1. YAML 语法检查
    local yaml_result
    yaml_result=$(check_yaml_syntax "$am_config")
    if echo "$yaml_result" | grep -q '^OK'; then
        log_pass "YAML 语法正确"
        add_result "AlertManager" "pass" "YAML syntax OK"
    elif echo "$yaml_result" | grep -q 'YAML_ERROR'; then
        local err_msg
        err_msg=$(echo "$yaml_result" | sed 's/YAML_ERROR: //')
        log_fail "YAML 语法错误: $err_msg"
        add_result "AlertManager" "fail" "YAML syntax error: $err_msg"
        errors=$((errors + 1))
        add_fail_detail "[FAIL] AlertManager: YAML parse error: $err_msg"
    else
        log_warn "YAML 语法检查跳过: $yaml_result"
        add_result "AlertManager" "warn" "YAML check skipped: $yaml_result"
        warnings=$((warnings + 1))
    fi

    # C2. 非法字段黑名单检查（针对 v0.32.x 版本兼容性）
    # max_alerts_per_message — 不存在于 v0.32.2
    local blacklisted_fields=(
        "max_alerts_per_message"
        "max_alerts"
        "resolve_message_max_size"
    )

    for field in "${blacklisted_fields[@]}"; do
        if grep -qE "^\s*${field}\s*:" "$am_config" 2>/dev/null; then
            local line_num
            line_num=$(grep -n "^\s*${field}\s*:" "$am_config" | head -1 | cut -d: -f1)
            log_fail "非法字段 '${field}' 在 L${line_num}: 此字段在 AlertManager v0.32.x 中不存在"
            add_result "AlertManager" "fail" "invalid field '$field' at L${line_num}"
            errors=$((errors + 1))
            add_fail_detail "[FAIL] AlertManager: Field '$field' is not valid in alertmanager v0.32.x (L${line_num}). Fix: Remove this field."

            # auto-fix: 移除该字段
            if [ "$MODE" = "fix" ]; then
                local temp_file
                temp_file=$(mktemp)
                grep -v "^\s*${field}\s*:" "$am_config" > "$temp_file" || true
                mv "$temp_file" "$am_config"
                log_info "已自动移除字段 '${field}'（--fix 模式）"
            fi
        fi
    done

    # C3. bearer_token 格式检查
    local bt_lines
    bt_lines=$(grep -n 'bearer_token' "$am_config" 2>/dev/null || true)
    if [ -n "$bt_lines" ]; then
        while IFS= read -r bt_line; do
            local bt_line_num bt_content
            bt_line_num=$(echo "$bt_line" | cut -d: -f1)
            bt_content=$(echo "$bt_line" | cut -d: -f2-)
            # bearer_token 应该是字符串值或环境变量引用
            if ! echo "$bt_content" | grep -qE "(\".*\"|'.*'|\$\{|'[[:space:]]*$)" ; then
                log_warn "bearer_token 格式可疑 (L${bt_line_num}): 应为字符串或 \${VAR} 引用"
                add_result "AlertManager" "warn" "bearer_token format suspicious at L${bt_line_num}"
                warnings=$((warnings + 1))
            fi
        done <<< "$bt_lines"
    fi

    # C4. Route Tree 结构完整性检查
    # 检查 route 块是否存在、receiver 是否有效
    if command -v python3 &>/dev/null || command -v python &>/dev/null; then
        local py_cmd="python3"
        command -v python3 &>/dev/null || py_cmd="python"

        local route_check
        route_check=$($py_cmd -c "
import yaml, sys
try:
    with open('$am_config', 'r') as f:
        data = yaml.safe_load(f)

    route = data.get('route', {})
    receivers = [r.get('name','') for r in data.get('receivers', [])]
    issues = []

    # 检查默认 receiver 是否存在
    default_recv = route.get('receiver', '')
    if default_recv and default_recv not in receivers:
        issues.append(f'Default receiver \"{default_recv}\" not defined in receivers')

    # 检查子路由 receiver
    def check_routes(routes, depth=0):
        for r in routes or []:
            recv = r.get('receiver', '')
            if recv and recv not in receivers:
                issues.append(f'Route (depth={depth}) receiver \"{recv}\" not defined')
            check_routes(r.get('routes', []), depth+1)

    check_routes(route.get('routes', []))

    if issues:
        for i in issues:
            print(f'ROUTE_ISSUE: {i}')
    else:
        print('ROUTE_OK')
except Exception as e:
    print(f'ERROR: {e}')
" 2>/dev/null)

        if echo "$route_check" | grep -q '^ROUTE_OK'; then
            log_pass "Route Tree 结构完整（所有 receiver 已定义）"
            add_result "AlertManager" "pass" "Route tree valid"
        elif echo "$route_check" | grep -q 'ROUTE_ISSUE'; then
            while IFS= read -r issue; do
                issue_msg=$(echo "$issue" | sed 's/ROUTE_ISSUE: //')
                log_fail "Route Tree 问题: $issue_msg"
                add_result "AlertManager" "fail" "Route tree: $issue_msg"
                errors=$((errors + 1))
                add_fail_detail "[FAIL] AlertManager Route: $issue_msg"
            done <<< "$route_check"
        fi
    fi

    # 单组件汇总
    if [ "$errors" -eq 0 ] && [ "$warnings" -eq 0 ]; then
        log_pass "总计: 0 errors, 0 warnings"
    fi
}

# ============================================================================
# D. Prometheus 规则验证
# ============================================================================

check_prometheus() {
    if [ -n "$TARGET_SERVICE" ] && [ "$TARGET_SERVICE" != "prometheus" ]; then
        return 0
    fi

    local category="[Prometheus]"
    local rules_dir="$PROJECT_ROOT/prometheus/rules"
    local errors=0 warnings=0

    echo ""
    echo -e "${BOLD}${category}${NC}"

    if [ ! -d "$rules_dir" ]; then
        log_warn "prometheus/rules/ 目录不存在，跳过检查"
        add_result "Prometheus" "warn" "rules directory not found"
        return 0
    fi

    # 遍历规则文件
    local rule_files=()
    while IFS= read -r -d '' f; do
        rule_files+=("$f")
    done < <(find "$rules_dir" -maxdepth 1 -name '*.yml' -o -name '*.yaml' | sort -z 2>/dev/null)

    if [ ${#rule_files[@]} -eq 0 ]; then
        log_warn "prometheus/rules/ 目录下没有 yml/yaml 文件"
        add_result "Prometheus" "warn" "no rule files found"
        return 0
    fi

    for rule_file in "${rule_files[@]}"; do
        local basename
        basename="$(basename "$rule_file")"
        local file_errors=0 file_warnings=0

        # D1. YAML 语法检查
        local yaml_result
        yaml_result=$(check_yaml_syntax "$rule_file")
        if echo "$yaml_result" | grep -q '^OK'; then
            : # OK
        elif echo "$yaml_result" | grep -q 'YAML_ERROR'; then
            local err_msg
            err_msg=$(echo "$yaml_result" | sed 's/YAML_ERROR: //')
            log_fail "$basename: YAML 语法错误: $err_msg"
            add_result "Prometheus" "fail" "$basename: YAML error: $err_msg"
            errors=$((errors + 1))
            file_errors=$((file_errors + 1))
            add_fail_detail "[FAIL] Prometheus Rule: $basename — YAML parse error: $err_msg"
        fi

        # D2. eval_interval 非法字段检查
        if grep -qE '^\s*eval_interval\s*:' "$rule_file" 2>/dev/null; then
            local ei_line
            ei_line=$(grep -n 'eval_interval' "$rule_file" | head -1 | cut -d: -f1)
            log_fail "$basename: L${ei_line} 字段 'eval_interval' 在 rulefmt.RuleGroup 中不合法"
            add_result "Prometheus" "fail" "$basename: L${ei_line} eval_interval not supported"
            errors=$((errors + 1))
            file_errors=$((file_errors + 1))
            add_fail_detail "[FAIL] Prometheus Rule: $basename — Line ${ei_line}: Field 'eval_interval' is not valid in rulefmt.RuleGroup. Fix: Remove this field, use 'interval' only. Doc: https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/"

            # auto-fix
            if [ "$MODE" = "fix" ]; then
                local temp_file
                temp_file=$(mktemp)
                grep -v '^\s*eval_interval\s*:' "$rule_file" > "$temp_file" || true
                mv "$temp_file" "$rule_file"
                log_info "已自动移除 eval_interval 字段（--fix 模式）"
            fi
        fi

        # D3. PromQL 表达式基本语法检查
        local py_cmd="python3"
        command -v python3 &>/dev/null || py_cmd="python"

        if command -v "$py_cmd" &>/dev/null; then
            local promql_check
            promql_check=$($py_cmd -c "
import re, sys, yaml

try:
    with open('$rule_file', 'r') as f:
        data = yaml.safe_load(f)
except:
    print('PROMQL_SKIP'); sys.exit(0)

issues = []
groups = data.get('groups', [])
for g_idx, group in enumerate(groups):
    rules = group.get('rules', [])
    for r_idx, rule in enumerate(rules):
        expr = rule.get('expr', '')
        line_hint = f'group[{g_idx}].rule[{r_idx}] ({rule.get(\"alert\", \"recording\")})'

        if not expr:
            continue

        # D3a. rate()/increase() 的向量选择器 [duration] 格式检查
        # 正确: rate(foo[5m])  错误: rate(foo) 或 rate(foo[])
        for fn in ['rate', 'increase', 'irate', 'deriv']:
            pattern = rf'{fn}\s*\(([^)]+)\)'
            matches = re.findall(pattern, expr)
            for m in matches:
                inner = m.strip()
                # 移除 offset 部分
                inner_no_offset = re.sub(r'\s+offset\s+\S+', '', inner)
                if not re.search(r'\[\d+[smhdw]\]', inner_no_offset):
                    issues.append(f'{line_hint}: {fn}() 缺少向量选择器 [duration]: {fn}({inner})')

        # D3b. offset 位置检查：offset 必须在 [duration] 之后
        # 错误写法: foo[offset 1h][5m]
        if re.search(r'\[offset\s+\S+\][\[]', expr):
            issues.append(f'{line_hint}: offset 语法错误 — offset 必须在 [duration] 之后，不能是 offset X][Y]')
        # 错误写法: foo[5m] offset 1h （缺少方括号包裹 offset）
        if re.search(r'\]\s+offset\s+\S+(?!\])', expr) and not re.search(r'\]\s+offset\s+\S+\]', expr):
            # 这个可能合法（某些上下文中），只做弱警告
            pass

        # D3c. 括号匹配检查
        stack = []
        for i, ch in enumerate(expr):
            if ch in '([':
                stack.append((ch, i))
            elif ch in ')]':
                if not stack:
                    issues.append(f'{line_hint}: 多余的闭括号 \'{ch}\' 位置 {i}')
                else:
                    stack.pop()
        if stack:
            for unclosed_ch, pos in stack:
                issues.append(f'{line_hint}: 未闭合的括号 \'{unclosed_ch}\' 位置 {pos}')

for iss in issues:
    print(f'PROMQL_ISSUE: {iss}')

if not issues:
    print('PROMQL_OK')
" 2>/dev/null)

            if echo "$promql_check" | grep -q '^PROMQL_OK'; then
                :
            elif echo "$promql_check" | grep -q 'PROMQL_ISSUE'; then
                while IFS= read -r issue; do
                    issue_msg=$(echo "$issue" | sed 's/PROMQL_ISSUE: //')
                    log_fail "$basename: PromQL 问题: $issue_msg"
                    add_result "Prometheus" "fail" "$basename: PromQL: $issue_msg"
                    errors=$((errors + 1))
                    file_errors=$((file_errors + 1))
                    add_fail_detail "[FAIL] Prometheus Rule: $basename — $issue_msg"
                done <<< "$promql_check"
            fi
        fi

        # D4. for: duration 格式合法性检查
        local bad_for_lines
        bad_for_lines=$(grep -n '^\s*for:\s*' "$rule_file" 2>/dev/null | grep -vE 'for:\s*\d+[smhdw]$|for:\s*\d+[smhdw]\s*$' || true)
        if [ -n "$bad_for_lines" ]; then
            while IFS= read -r bfl; do
                local fl_num fl_val
                fl_num=$(echo "$bfl" | cut -d: -f1)
                fl_val=$(echo "$bfl" | sed 's/.*for:\s*//')
                log_warn "$basename: L${fl_num} 'for:' 值格式可疑: '$fl_val'（应为如 5m, 1h, 30s 等）"
                add_result "Prometheus" "warn" "$basename: L${fl_num} suspicious 'for' value: $fl_val"
                warnings=$((warnings + 1))
                file_warnings=$((file_warnings + 1))
            done <<< "$bad_for_lines"
        fi

        # D5. labels/annotations 结构完整性
        if command -v "$py_cmd" &>/dev/null; then
            local struct_check
            struct_check=$($py_cmd -c "
import yaml, sys
try:
    with open('$rule_file', 'r') as f:
        data = yaml.safe_load(f)
except:
    print('STRUCT_SKIP'); sys.exit(0)

issues = []
groups = data.get('groups', [])
for g_idx, group in enumerate(groups):
    rules = group.get('rules', [])
    for r_idx, rule in enumerate(rules):
        name = rule.get('alert', rule.get('record', f'rule_{r_idx}'))
        has_labels = bool(rule.get('labels'))
        has_annotations = bool(rule.get('annotations'))

        if not has_labels:
            issues.append(f'{name}: 缺少 labels 字段')
        if not has_annotations:
            issues.append(f'{name}: 缺少 annotations 字段')

for iss in issues:
    print(f'STRUCT_ISSUE: {iss}')

if not issues:
    print('STRUCT_OK')
" 2>/dev/null)

            if echo "$struct_check" | grep -q '^STRUCT_OK'; then
                :
            elif echo "$struct_check" | grep -q 'STRUCT_ISSUE'; then
                while IFS= read -r issue; do
                    issue_msg=$(echo "$issue" | sed 's/STRUCT_ISSUE: //')
                    log_warn "$basename: 结构问题: $issue_msg"
                    add_result "Prometheus" "warn" "$basename: struct: $issue_msg"
                    warnings=$((warnings + 1))
                    file_warnings=$((file_warnings + 1))
                done <<< "$struct_check"
            fi
        fi

        # 单文件汇总
        if [ "$file_errors" -eq 0 ] && [ "$file_warnings" -eq 0 ]; then
            log_pass "$basename: 0 errors, 0 warnings"
            add_result "Prometheus" "pass" "$basename: clean"
        elif [ "$file_errors" -eq 0 ] && [ "$file_warnings" -gt 0 ]; then
            log_warn "$basename: 0 errors, $file_warnings warning(s)"
        else
            log_fail "$basename: $file_errors error(s), $file_warnings warning(s)"
        fi
    done
}

# ============================================================================
# E. Promtail/Loki 配置验证
# ============================================================================

check_promtail_loki() {
    local check_promtail=true
    local check_loki=true

    if [ -n "$TARGET_SERVICE" ]; then
        if [ "$TARGET_SERVICE" != "promtail" ]; then check_promtail=false; fi
        if [ "$TARGET_SERVICE" != "loki" ]; then check_loki=false; fi
        if [ "$TARGET_SERVICE" != "promtail" ] && [ "$TARGET_SERVICE" != "loki" ]; then
            return 0
        fi
    fi

    # ── Promtail 检查 ──
    if $check_promtail; then
        local category="[Promtail]"
        local pt_config="$PROJECT_ROOT/loki/promtail-config.yml"
        local errors=0 warnings=0

        echo ""
        echo -e "${BOLD}${category}${NC}"

        if [ ! -f "$pt_config" ]; then
            log_warn "promtail-config.yml 不存在，跳过检查"
            add_result "Promtail" "warn" "config file not found"
        else
            # E1. YAML 语法
            local yaml_result
            yaml_result=$(check_yaml_syntax "$pt_config")
            if echo "$yaml_result" | grep -q '^OK'; then
                log_pass "YAML 语法正确"
                add_result "Promtail" "pass" "YAML syntax OK"
            elif echo "$yaml_result" | grep -q 'YAML_ERROR'; then
                local err_msg
                err_msg=$(echo "$yaml_result" | sed 's/YAML_ERROR: //')
                log_fail "YAML 语法错误: $err_msg"
                add_result "Promtail" "fail" "YAML error: $err_msg"
                errors=$((errors + 1))
                add_fail_detail "[FAIL] Promtail: YAML parse error: $err_msg"
            fi

            # E2. pipeline_stages 类型白名单检查
            # Promtail 2.9.x / 3.x 合法 stage 类型
            local VALID_STAGES="multiline json timestamp labels metrics drop output regex match template limit replace tenant pack unpack output"

            # 提取所有 pipeline_stages 中的 stage 类型
            local used_stages
            used_stages=$(grep -oP '^\s+-\s+\w+:' "$pt_config" 2>/dev/null | grep -A0 'pipeline_stages' \
                | sed 's/.*-\s*//;s/:.*//' | sort -u || true)

            # 更精确地提取 stages（在 pipeline_stages 块内的）
            local invalid_stages=""
            local in_pipeline=false
            while IFS= read -r line; do
                if echo "$line" | grep -q 'pipeline_stages:'; then
                    in_pipeline=true
                    continue
                fi
                if $in_pipeline; then
                    # 检测缩进减少（离开 pipeline 块）
                    leading_spaces=${line%%[! ]*}
                    if [ -z "$line" ] || [ ${#leading_spaces} -lt 6 ]; then
                        # 可能还在 pipeline 内但空行
                        if [ -n "$line" ] && ! echo "$line" | grep -qE '^\s{6,}-\s+\w+'; then
                            # 检查是否还有更深的嵌套
                            if ! echo "$line" | grep -qE '^\s{8,}'; then
                                in_pipeline=false
                            fi
                        fi
                    fi

                    if $in_pipeline && echo "$line" | grep -qE '^\s+-\s+\w+'; then
                        local stage_type
                        stage_type=$(echo "$line" | sed 's/.*-\s*//;s/:.*//')
                        local is_valid=false
                        for vs in $VALID_STAGES; do
                            if [ "$stage_type" = "$vs" ]; then
                                is_valid=true
                                break
                            fi
                        done
                        if ! $is_valid; then
                            invalid_stages="$invalid_stages $stage_type"
                        fi
                    fi
                fi
            done < "$pt_config"

            if [ -n "$invalid_stages" ]; then
                for ist in $invalid_stages; do
                    log_fail "非法 pipeline stage 类型: '$ist'（不在白名单中）"
                    add_result "Promtail" "fail" "invalid stage type: $ist"
                    errors=$((errors + 1))
                    add_fail_detail "[FAIL] Promtail: Invalid pipeline stage type '$ist'. Allowed: $VALID_STAGES"
                done
            fi

            # E3. filter stage 检查（应替换为 drop）
            if grep -qE '^\s+-\s+filter:' "$pt_config" 2>/dev/null; then
                local filter_line
                filter_line=$(grep -n '^\s*- filter:' "$pt_config" | head -1)
                log_fail "$(echo "$filter_line" | cut -d: -f1-2): 'filter' stage 类型不支持，请替换为 'drop'"
                add_result "Promtail" "fail" "filter stage not supported, use 'drop'"
                errors=$((errors + 1))
                add_fail_detail "[FAIL] Promtail: 'filter' stage type is not supported. Replace with 'drop' stage."
            fi

            # E4. line_drop_pattern 在 limits_config 中检查
            if grep -qE 'line_drop_pattern' "$pt_config" 2>/dev/null; then
                local ldp_line
                ldp_line=$(grep -n 'line_drop_pattern' "$pt_config" | head -1)
                log_fail "$(echo "$ldp_line" | cut -d: -f1-2): 'line_drop_pattern' 在当前版本中不合法"
                add_result "Promtail" "fail" "line_drop_pattern not valid"
                errors=$((errors + 1))
                add_fail_detail "[FAIL] Promtail: 'line_drop_pattern' field is not valid in current Promtail version. Remove it."

                # auto-fix
                if [ "$MODE" = "fix" ]; then
                    local temp_file
                    temp_file=$(mktemp)
                    grep -v 'line_drop_pattern' "$pt_config" > "$temp_file" || true
                    mv "$temp_file" "$pt_config"
                    log_info "已自动移除 line_drop_pattern（--fix 模式）"
                fi
            fi

            # E5. Docker SD config filters 语法检查
            if grep -qA5 'docker_sd_configs:' "$pt_config" 2>/dev/null; then
                # 检查 filters 中的 name/values 对
                local filter_issues
                filter_issues=$(awk '
/docker_sd_configs:/ { in_docker=1; next }
in_docker && /^[[:space:]]*filters:/ { in_filters=1; next }
in_filters && /^[[:space:]]*- name:/ { 
    has_name=1; 
    next 
}
in_filters && has_name && /^[[:space:]]*values:/ { 
    has_values=1; 
    has_name=0;
    next
}
in_filters && /^[[:space:]]*-[a-z]/ && !/^[[:space:]]*(name|values):/ {
    # 新条目开始但前一个缺少 values
    if (has_name && !has_values) print "FILTER_MISSING_VALUES"
    has_name=0; has_values=0
}
# 缩进减少表示退出块
in_filters && /^[^[:space:]]/ { 
    if (has_name && !has_values) print "FILTER_MISSING_VALUES"
    in_filters=0; in_docker=0; has_name=0; has_values=0
}
END { if (has_name && !has_values) print "FILTER_MISSING_VALUES" }
' "$pt_config" 2>/dev/null || true)

                if echo "$filter_issues" | grep -q 'FILTER_MISSING_VALUES'; then
                    log_warn "docker_sd_configs.filters 中存在缺少 values 的 name 条目"
                    add_result "Promtail" "warn" "Docker SD filter missing values"
                    warnings=$((warnings + 1))
                else
                    log_pass "Docker SD config filters 语法正确"
                    add_result "Promtail" "pass" "Docker SD filters OK"
                fi
            fi

            if [ "$errors" -eq 0 ] && [ "$warnings" -eq 0 ]; then
                log_pass "总计: 0 errors, 0 warnings"
            fi
        fi
    fi

    # ── Loki 检查 ──
    if $check_loki; then
        local category="[Loki]"
        local loki_config="$PROJECT_ROOT/loki/loki-config.yml"
        local errors=0 warnings=0

        echo ""
        echo -e "${BOLD}${category}${NC}"

        if [ ! -f "$loki_config" ]; then
            log_warn "loki-config.yml 不存在，跳过检查"
            add_result "Loki" "warn" "config file not found"
        else
            # Loki YAML 语法检查
            local yaml_result
            yaml_result=$(check_yaml_syntax "$loki_config")
            if echo "$yaml_result" | grep -q '^OK'; then
                log_pass "YAML 语法正确"
                add_result "Loki" "pass" "YAML syntax OK"
            elif echo "$yaml_result" | grep -q 'YAML_ERROR'; then
                local err_msg
                err_msg=$(echo "$yaml_result" | sed 's/YAML_ERROR: //')
                log_fail "YAML 语法错误: $err_msg"
                add_result "Loki" "fail" "YAML error: $err_msg"
                errors=$((errors + 1))
                add_fail_detail "[FAIL] Loki: YAML parse error: $err_msg"
            fi

            if [ "$errors" -eq 0 ] && [ "$warnings" -eq 0 ]; then
                log_pass "总计: 0 errors, 0 warnings"
            fi
        fi
    fi
}

# ============================================================================
# F. PostgreSQL / Redis 配置检查
# ============================================================================

check_postgres_redis() {
    local check_pg=true
    local check_redis=true

    if [ -n "$TARGET_SERVICE" ]; then
        if [ "$TARGET_SERVICE" != "postgres" ]; then check_pg=false; fi
        if [ "$TARGET_SERVICE" != "redis" ]; then check_redis=false; fi
        if [ "$TARGET_SERVICE" != "postgres" ] && [ "$TARGET_SERVICE" != "redis" ]; then
            return 0
        fi
    fi

    # ── PostgreSQL ──
    if $check_pg; then
        local category="[PostgreSQL]"
        echo ""
        echo -e "${BOLD}${category}${NC}"

        local pg_confs=()
        # 查找自定义 postgresql.conf
        while IFS= read -r -d '' f; do
            pg_confs+=("$f")
        done < <(find "$PROJECT_ROOT" -maxdepth 3 -name 'postgresql.conf' -not -path '*/node_modules/*' -print0 2>/dev/null)

        if [ ${#pg_confs[@]} -eq 0 ]; then
            log_info "未找到自定义 postgresql.conf（使用镜像默认配置）"
            add_result "PostgreSQL" "info" "no custom postgresql.conf"
        else
            for pg_conf in "${pg_confs[@]}"; do
                local pg_basename
                pg_basename="$(basename "$pg_conf")"
                # 基本 INI/GUC 格式检查：每行应为 parameter = value 或注释
                local bad_lines
                bad_lines=$(grep -nvE '^\s*#|^\s*$|^\s*[a-z_]+\s*=\s*.*$' "$pg_conf" 2>/dev/null | head -5 || true)
                if [ -n "$bad_lines" ]; then
                    log_warn "$pg_basename: 发现异常格式的行: $(echo "$bad_lines" | head -2 | cut -d: -f1 | tr '\n' ' ')"
                    add_result "PostgreSQL" "warn" "$pg_basename: suspicious lines"
                else
                    log_pass "$pg_basename: 基本语法正常"
                    add_result "PostgreSQL" "pass" "$pg_basename: OK"
                fi
            done
        fi
    fi

    # ── Redis ──
    if $check_redis; then
        local category="[Redis]"
        echo ""
        echo -e "${BOLD}${category}${NC}"

        local redis_confs=()
        while IFS= read -r -d '' f; do
            redis_confs+=("$f")
        done < <(find "$PROJECT_ROOT" -maxdepth 3 -name 'redis.conf' -not -path '*/node_modules/*' -print0 2>/dev/null)

        if [ ${#redis_confs[@]} -eq 0 ]; then
            log_info "未找到自定义 redis.conf（使用镜像默认配置）"
            add_result "Redis" "info" "no custom redis.conf"
        else
            for redis_conf in "${redis_confs[@]}"; do
                local rbasename
                rbasename="$(basename "$redis_conf")"
                # Redis conf 基本格式：parameter value 或 # 注释
                local rbad_lines
                rbad_lines=$(grep -nvE '^\s*#|^\s*$|^\s*[a-z-]+\s+.+$' "$redis_conf" 2>/dev/null | head -5 || true)
                if [ -n "$rbad_lines" ]; then
                    log_warn "$rbasename: 发现异常格式的行"
                    add_result "Redis" "warn" "$rbasename: suspicious lines"
                else
                    log_pass "$rbasename: 基本语法正常"
                    add_result "Redis" "pass" "$rbasename: OK"
                fi
            done
        fi
    fi
}

# ============================================================================
# 主流程
# ============================================================================

main() {
    local start_time
    start_time=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "unknown")
    local git_head
    git_head=$(get_git_head)

    echo ""
    echo -e "${BOLD}╔════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║  GlobalReach 配置验证报告               ║${NC}"
    echo -e "${BOLD}╠════════════════════════════════════════╣${NC}"
    printf "${BOLD}║  时间: %-33s║${NC}\n" "$start_time"
    printf "${BOLD}║  Git HEAD: %-29s║${NC}\n" "$git_head"
    # 占位行，后面更新计数
    printf "${BOLD}║  总计: %-31s║${NC}\n" "正在检查..."
    echo -e "${BOLD}╚════════════════════════════════════════╝${NC}"

    # 执行各模块检查
    check_docker_compose
    check_nginx
    check_alertmanager
    check_prometheus
    check_promtail_loki
    check_postgres_redis

    # ── 输出最终报告 ───────────────────────────────────────────────────────

    echo ""
    echo -e "${BOLD}=== 失败详情 ===${NC}"
    if [ ${#FAIL_DETAILS[@]} -eq 0 ]; then
        echo "  ✅ 无失败项"
    else
        for detail in "${FAIL_DETAILS[@]}"; do
            echo -e "  ${RED}$detail${NC}"
        done
    fi

    echo ""
    echo -e "${BOLD}=== 退出码 ===${NC}"
    echo "  0 = 全部通过"
    echo "  1 = 有失败项"
    echo "  2 = 有错误（无法继续验证）"

    # CI 模式：输出 JSON
    if [ "$MODE" = "ci" ]; then
        echo ""
        echo "::CONFIG_VALIDATION_JSON::"
        echo "{"
        echo "  \"timestamp\": \"$start_time\","
        echo "  \"git_head\": \"$git_head\","
        echo "  \"total_checks\": $TOTAL_CHECKS,"
        echo "  \"passed\": $PASS_COUNT,"
        echo "  \"warnings\": $WARN_COUNT,"
        echo "  \"failed\": $FAIL_COUNT,"
        echo "  \"errors\": $ERROR_COUNT,"
        echo "  \"results\": ["
        local first_result=true
        for result in "${RESULTS[@]}"; do
            if $first_result; then
                first_result=false
            else
                echo ","
            fi
            echo -n "    $result"
        done
        echo ""
        echo "  ],"
        echo "  \"fail_details\": ["
        local first_detail=true
        for detail in "${FAIL_DETAILS[@]}"; do
            if $first_detail; then
                first_detail=false
            else
                echo ","
            fi
            echo -n "    \"$detail\""
        done
        echo ""
        echo "  ]"
        echo "}"
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
