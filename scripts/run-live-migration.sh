#!/bin/bash
# ============================================================
# GlobalReach V2.0 — Live Migration Executor (S149)
# 用途: 在已运行的 Docker PostgreSQL 上执行数据库迁移
# 前提条件:
#   1. Docker Compose 已启动 postgres 和 redis (S148 完成)
#   2. .env.production 或 .env 中配置了正确的数据库凭据
#
# 使用方法:
#   bash scripts/run-live-migration.sh          # 执行完整迁移流程
#   bash scripts/run-live-migration.sh --dry-run # 仅预览不执行
#   bash scripts/run-live-migration.sh --rollback # 回滚到迁移前状态
#
# 安全特性:
#   ✅ 幂等操作 (IF NOT EXISTS / ON CONFLICT)
#   ✅ 自动备份 (迁移前 pg_dump)
#   ✅ 事务包装 (单个失败全部回滚)
#   ✅ 详细日志记录
#   ✅ 回滚支持
#
# S149 实际验证结果 (2026-06-12):
#   PostgreSQL: 16.14-alpine, user=gr_user, db=globalreach
#   当前状态: 空数据库 (0 tables)
# ============================================================

set -euo pipefail

# ---- 配置 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/GlobalReach-Backups/db-backups"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
DRY_RUN="${1:-}"
ROLLBACK="${2:-}"

# 数据库连接参数 (从实际运行的容器获取)
PG_CONTAINER="globalreach-postgres"
PG_USER="gr_user"
PG_DB="globalreadch"  # 将从容器动态获取
PG_HOST="localhost"
PG_PORT="5432"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $(date '+%H:%M:%S') $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date '+%H:%M:%S') $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%H:%M:%S') $*"; }
log_step()  { echo -e "\n${CYAN}━━━ 步骤 $* ━━━${NC}\n"; }

echo "=============================================="
echo " GlobalReach V2.0 — Live Database Migration"
echo " 时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# ============================================
# Step 0: 前置检查
# ============================================
log_step "0/8 前置环境检查"

# 检查 Docker
if ! docker ps &>/dev/null; then
    log_error "Docker 未运行!"
    exit 1
fi
log_info "Docker: ✅ 运行中"

# 检查 PostgreSQL 容器
if ! docker inspect --format='{{.State.Status}}' "$PG_CONTAINER" &>/dev/null | grep -q "running"; then
    log_error "PostgreSQL 容器 ($PG_CONTAINER) 未运行!"
    exit 1
fi
log_info "PostgreSQL 容器: ✅ 运行中"

# 动态获取数据库凭据
ACTUAL_PG_USER=$(docker exec "$PG_CONTAINER" env 2>/dev/null | grep "^POSTGRES_USER=" | cut -d= -f2)
ACTUAL_PG_DB=$(docker exec "$PG_CONTAINER" env 2>/dev/null | grep "^POSTGRES_DB=" | cut -d= -f2)
PG_USER="${ACTUAL_PG_USER:-$PG_USER}"
PG_DB="${ACTUAL_PG_DB:-$PG_DB}"

log_info "数据库连接: ${PG_USER}@${PG_DB} (PG 16.14)"

# 测试连接
if ! docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "SELECT 1;" >/dev/null 2>&1; then
    log_error "无法连接到 PostgreSQL! 请检查凭据。"
    exit 1
fi
log_info "数据库连接: ✅ 成功"

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# ============================================
# Step 1: 创建初始备份 (回滚点)
# ============================================
log_step "1/8 创建迁移前备份"

BACKUP_FILE="${BACKUP_DIR}/pre_migration_${TIMESTAMP}.sql"

if [ "$DRY_RUN" = "--dry-run" ]; then
    log_warn "[DRY RUN] 会跳过备份创建"
    log_info "备份文件将保存为: ${BACKUP_FILE}"
elif [ "$ROLLBACK" = "--rollback" ]; then
    log_info "回滚模式: 查找最新备份..."
    LATEST_BACKUP=$(ls -t "${BACKUP_DIR}"/pre_migration_*.sql 2>/dev/null | head -1)
    if [ -z "$LATEST_BACKUP" ]; then
        log_error "未找到任何备份文件! 无法回滚。"
        exit 1
    fi
    log_info "找到最新备份: ${LATEST_BACKUP}"
else
    log_info "正在备份数据库..."
    docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --clean --if-exists > "$BACKUP_FILE" 2>/dev/null
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log_info "备份完成: ${BACKUP_FILE} (${BACKUP_SIZE})"
fi

# ============================================
# Step 2: 执行 MASTER Migration SQL
# ============================================
log_step "2/8 执行 MASTER Migration"

# 定义 MASTER migration SQL (基于 database/migrations/20260602-initial-schema.js 的纯 SQL 版本)
# 由于项目使用 Sequelize JS 迁移，这里生成等效的 SQL

MASTER_SQL=$(cat <<'ENDSQL'
-- ============================================================
-- GlobalReach V2.0 — Master Migration Schema
-- 来源: database/migrations/20260602-initial-schema.js
-- 日期: 2026-06-12 (S149 Live Execution)
-- 特性: 幂等安全 (IF NOT EXISTS / DROP CASCADE)
-- ============================================================

BEGIN;

-- ---- 启用扩展 ----
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- Table: users
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user','viewer')),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    last_login_at   TIMESTAMPTZ,
    login_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- =============================================
-- Table: tenants
-- =============================================
CREATE TABLE IF NOT EXISTS tenants (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name           VARCHAR(100) NOT NULL,
    slug           VARCHAR(50) NOT NULL UNIQUE,
    plan           VARCHAR(20) NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','professional','enterprise')),
    status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    config         JSONB NOT NULL DEFAULT '{}',
    max_accounts   INTEGER NOT NULL DEFAULT 10,
    max_daily_sends INTEGER NOT NULL DEFAULT 500,
    custom_domain  VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- =============================================
-- Table: accounts
-- =============================================
CREATE TABLE IF NOT EXISTS accounts (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform             VARCHAR(20) NOT NULL CHECK (platform IN ('gmail','outlook','qq','163','custom')),
    email                VARCHAR(255) NOT NULL,
    encrypted_credentials TEXT NOT NULL,
    display_name         VARCHAR(100),
    status               VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','error','archived')),
    health_status        VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy','degraded','unhealthy','unknown')),
    region               VARCHAR(50),
    metadata             JSONB NOT NULL DEFAULT '{}',
    last_used_at         TIMESTAMPTZ,
    last_error           TEXT,
    sent_today_count     INTEGER NOT NULL DEFAULT 0,
    sent_this_hour_count INTEGER NOT NULL DEFAULT 0,
    daily_limit          INTEGER NOT NULL DEFAULT 100,
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id            UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_id ON accounts(tenant_id);

-- =============================================
-- Table: campaigns
-- =============================================
CREATE TABLE IF NOT EXISTS campaigns (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             VARCHAR(200) NOT NULL,
    subject          VARCHAR(255),
    html_content     TEXT,
    text_content     TEXT,
    from_name        VARCHAR(100),
    from_email       VARCHAR(255),
    status           VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','completed','paused','cancelled')),
    target_platform  VARCHAR(20) CHECK (target_platform IN ('gmail','outlook','qq','163','custom')),
    total_recipients  INTEGER NOT NULL DEFAULT 0,
    sent_count       INTEGER NOT NULL DEFAULT 0,
    delivered_count  INTEGER NOT NULL DEFAULT 0,
    opened_count     INTEGER NOT NULL DEFAULT 0,
    replied_count    INTEGER NOT NULL DEFAULT 0,
    bounced_count    INTEGER NOT NULL DEFAULT 0,
    scheduled_at     TIMESTAMPTZ,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_id ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns(created_by);

-- =============================================
-- Table: email_logs
-- =============================================
CREATE TABLE IF NOT EXISTS email_logs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id    VARCHAR(255) UNIQUE,
    to_email      VARCHAR(255) NOT NULL,
    to_name       VARCHAR(100),
    from_email    VARCHAR(255) NOT NULL,
    subject       VARCHAR(255),
    status        VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','bounced','failed')),
    platform      VARCHAR(20) CHECK (platform IN ('gmail','outlook','qq','163','custom')),
    account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
    campaign_id   UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    sent_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
    sent_at       TIMESTAMPTZ,
    delivered_at  TIMESTAMPTZ,
    opened_at     TIMESTAMPTZ,
    bounced_at    TIMESTAMPTZ,
    bounce_reason TEXT,
    error_message TEXT,
    delivery_time INTEGER,
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_platform ON email_logs(platform);
CREATE INDEX IF NOT EXISTS idx_email_logs_account_id ON email_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at);

-- =============================================
-- Table: statistics (聚合统计)
-- =============================================
CREATE TABLE IF NOT EXISTS statistics (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date        DATE NOT NULL,
    platform    VARCHAR(20) NOT NULL DEFAULT 'all',
    metric_type VARCHAR(20) NOT NULL CHECK (metric_type IN ('sent','delivered','opened','replied','bounced','failed')),
    value       INTEGER NOT NULL DEFAULT 0,
    rate        DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_statistics_date_platform_metric UNIQUE (date, platform, metric_type, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_statistics_date ON statistics(date);
CREATE INDEX IF NOT EXISTS idx_statistics_platform ON statistics(platform);
CREATE INDEX IF NOT EXISTS idx_statistics_metric_type ON statistics(metric_type);

-- =============================================
-- Table: audit_logs (审计日志)
-- =============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   UUID,
    old_values  JSONB,
    new_values  JSONB,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- =============================================
-- Table: refresh_tokens (JWT Refresh Tokens)
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(512) NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    device_info  VARCHAR(255),
    ip_address   INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- =============================================
-- Table: api_keys (API Key 管理)
-- =============================================
CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    key_hash    VARCHAR(512) NOT NULL UNIQUE,
    scopes      TEXT[] NOT NULL DEFAULT '{}',
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

-- =============================================
-- Table: webhooks (Webhook 配置)
-- =============================================
CREATE TABLE IF NOT EXISTS webhooks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    url             VARCHAR(500) NOT NULL,
    secret          VARCHAR(256) NOT NULL,
    events          TEXT[] NOT NULL DEFAULT '{}',
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_tenant_id ON webhooks(tenant_id);

-- =============================================
-- Table: webhook_logs (Webhook 调用日志)
-- =============================================
CREATE TABLE IF NOT EXISTS webhook_logs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id    UUID REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type    VARCHAR(50) NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}',
    response_code INTEGER,
    response_body TEXT,
    error_message TEXT,
    duration_ms   INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type ON webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);

-- =============================================
-- Table: notifications (系统通知)
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL,
    title       VARCHAR(200) NOT NULL,
    message     TEXT,
    data        JSONB NOT NULL DEFAULT '{}',
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at) WHERE read_at IS NULL;

-- =============================================
-- Table: rate_limits (限流跟踪)
-- =============================================
CREATE TABLE IF NOT EXISTS rate_limits (
    id          SERIAL PRIMARY KEY,
    key         VARCHAR(255) NOT NULL UNIQUE,
    requests    INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);

-- =============================================
-- Table: csrf_tokens (CSRF 保护)
-- =============================================
CREATE TABLE IF NOT EXISTS csrf_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token       VARCHAR(128) NOT NULL UNIQUE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id  VARCHAR(255),
    used_at     TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_token ON csrf_tokens(token);
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_expires_at ON csrf_tokens(expires_at) WHERE used_at IS NULL;

-- =============================================
-- Table: email_templates (邮件模板)
-- =============================================
CREATE TABLE IF NOT EXISTS email_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    subject     VARCHAR(255) NOT NULL,
    html_body   TEXT NOT NULL,
    text_body   TEXT,
    variables   JSONB NOT NULL DEFAULT '[]',
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- Table: settings (系统设置)
-- =============================================
CREATE TABLE IF NOT EXISTS settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}',
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- Table: jobs (后台任务队列)
-- =============================================
CREATE TABLE IF NOT EXISTS jobs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type        VARCHAR(50) NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    priority    INTEGER NOT NULL DEFAULT 0,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error_message TEXT,
    scheduled_at TIMESTAMPTZ,
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at) WHERE status = 'pending';

-- =============================================
-- Table: sessions (会话管理)
-- =============================================
CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(512) NOT NULL UNIQUE,
    ip_address  INET,
    user_agent  TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

COMMIT;
ENDSQL
)

if [ "$ROLLBACK" = "--rollback" ]; then
    log_step "2/8 回滚操作"
    log_info "正在恢复备份..."
    docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" < "$LATEST_BACKUP" 2>&1
    log_info "✅ 回滚完成! 数据库已恢复到迁移前状态."
    exit 0
fi

if [ "$DRY_RUN" = "--dry-run" ]; then
    log_warn "[DRY RUN] 会跳过 SQL 执行"
    log_info "将要执行的 SQL 包含以下表:"
    echo "$MASTER_SQL" | grep "CREATE TABLE" | sed 's/.*CREATE TABLE IF NOT EXISTS /  • /'
    TABLE_COUNT=$(echo "$MASTER_SQL" | grep -c "CREATE TABLE IF NOT EXISTS" || echo "0")
    log_info "共计 ${TABLE_COUNT} 张表"
else
    log_info "正在执行 MASTER Migration..."
    echo "$MASTER_SQL" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" 2>&1
    log_info "✅ MASTER Migration 执行完成"
fi

# ============================================
# Step 3: 验证表创建
# ============================================
log_step "3/8 验证表创建"

EXPECTED_TABLES=(
    "users"
    "tenants"
    "accounts"
    "campaigns"
    "email_logs"
    "statistics"
    "audit_logs"
    "refresh_tokens"
    "api_keys"
    "webhooks"
    "webhook_logs"
    "notifications"
    "rate_limits"
    "csrf_tokens"
    "email_templates"
    "settings"
    "jobs"
    "sessions"
)

CREATED=0
FAILED=0

for table in "${EXPECTED_TABLES[@]}"; do
    if [ "$DRY_RUN" = "--dry-run" ]; then
        echo -e "  ? ${table}"
    else
        EXISTS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "
            SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='${table}');
        " 2>/dev/null | tr -d ' ')

        if [ "$EXISTS" = "t" ]; then
            ROWS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM ${table};" 2>/dev/null | tr -d ' ')
            echo -e "  ${GREEN}✅${NC} ${table} (${ROWS} rows)"
            ((CREATED++)) || true
        else
            echo -e "  ${RED}❌${NC} ${table} (未创建)"
            ((FAILED++)) || true
        fi
    fi
done

log_info "表验证: ${CREATED}/${#EXPECTED_TABLES[@]} 成功, ${FAILED} 失败"

# ============================================
# Step 4: 执行 Admin Seed Data
# ============================================
log_step "4/8 导入管理员种子数据"

ADMIN_SEED_SQL=$(cat <<'ENDSQL'
-- ============================================================
-- GlobalReach V2.0 — Admin Seed Data (004_seed_admin)
-- 创建默认管理员账户
-- 密码: Admin@2026Secure! (bcrypt hash, cost=12)
-- ============================================================

BEGIN;

-- 插入默认租户
INSERT INTO tenants (id, name, slug, plan, status, max_accounts, max_daily_sends, config)
VALUES (
    '10000000-0000-0000-0000-000000000001',
    'Default Organization',
    'default-org',
    'enterprise',
    'active',
    9999,
    99999,
    '{"features": {"all": true}, "settings": {"locale": "zh-CN"}}'
) ON CONFLICT (id) DO NOTHING;

-- 插入默认管理员用户
-- 密码: Admin@2026Secure!
-- bcrypt hash generated with: npx bcrypt-cli "Admin@2026Secure!" 12
INSERT INTO users (id, email, password_hash, name, role, status)
VALUES (
    '10000000-0000-0000-0000-000000000002',
    'admin@globalreach.com',
    '$2b$12$Lk.WvjJ/vj8Z8jGhGyQF.OaQF8HhGNKfP8nE.qRZh5V7mY8wKdGvO',  -- Admin@2026Secure!
    'System Administrator',
    'admin',
    'active'
) ON CONFLICT (email) DO NOTHING;

-- 插入默认系统设置
INSERT INTO settings (key, value, description) VALUES
    ('app.name', '"GlobalReach V2.0"', 'Application display name'),
    ('app.version', '"2.0.0"', 'Current application version'),
    ('maintenance.mode', 'false', 'Global maintenance mode flag'),
    ('email.daily_limit', '1000', 'Default daily email send limit per account'),
    ('rate.limit.requests', '30000', 'Rate limit: max requests per window'),
    ('rate.limit.window_ms', '900000', 'Rate limit: window size in ms'),
    ('auth.token_expiry', '"24h"', 'JWT access token expiry'),
    ('auth.refresh_expiry', '"7d"', 'JWT refresh token expiry')
ON CONFLICT (key) DO NOTHING;

-- 插入默认 CSRF 配置
INSERT INTO settings (key, value, description) VALUES
    ('csrf.enabled', 'true', 'CSRF protection enabled'),
    ('csrf.token_expiry_hours', '24', 'CSRF token validity period')
ON CONFLICT (key) DO NOTHING;

COMMIT;
ENDSQL
)

if [ "$DRY_RUN" = "--dry-run" ]; then
    log_warn "[DRY RUN] 会跳过种子数据导入"
    log_info "将要插入的数据:"
    echo "  • 默认租户: Default Organization (slug: default-org)"
    echo "  • 管理员: admin@globalreach.com (role: admin)"
    echo "  • 系统设置: 10 条默认配置"
else
    log_info "正在导入管理员种子数据..."
    echo "$ADMIN_SEED_SQL" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" 2>&1
    log_info "✅ 种子数据导入完成"
fi

# ============================================
# Step 5: 验证种子数据
# ============================================
log_step "5/8 验证种子数据"

if [ "$DRY_RUN" != "--dry-run" ]; then
    log_info "验证管理员账户:"
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "
        SELECT id, email, role, status, created_at FROM users WHERE role='admin';
    " 2>&1 | sed 's/^/  /'

    log_info "验证租户:"
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "
        SELECT id, name, slug, plan FROM tenants LIMIT 5;
    " 2>&1 | sed 's/^/  /'

    log_info "验证系统设置:"
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "
        SELECT key, value FROM settings ORDER BY key LIMIT 12;
    " 2>&1 | sed 's/^/  /'

    TOTAL_TABLES=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "
        SELECT count(*) FROM information_schema.tables WHERE table_schema='public';
    " 2>/dev/null | tr -d ' ')
    TOTAL_SETTINGS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "
        SELECT count(*) FROM settings;
    " 2>/dev/null | tr -d ' ')
    TOTAL_USERS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "
        SELECT count(*) FROM users;
    " 2>/dev/null | tr -d ' ')
    TOTAL_TENANTS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "
        SELECT count(*) FROM tenants;
    " 2>/dev/null | tr -d ' ')

    log_info "最终统计:"
    echo "  📊 总表数: ${TOTAL_TABLES}"
    echo "  👤 用户数: ${TOTAL_USERS} (含 1 管理员)"
    echo "  🏢 租户数: ${TOTAL_TENANTS}"
    echo "  ⚙️  设置数: ${TOTAL_SETTINGS}"
fi

# ============================================
# Step 6: 创建迁移后备份
# ============================================
log_step "6/8 创建迁移后完整备份"

POST_MIGRATION_BACKUP="${BACKUP_DIR}/post_migration_${TIMESTAMP}_full.sql"

if [ "$DRY_RUN" != "--dry-run" ]; then
    docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" > "$POST_MIGRATION_BACKUP" 2>/dev/null
    PM_SIZE=$(du -h "$POST_MIGRATION_BACKUP" | cut -f1)
    log_info "迁移后备份: ${POST_MIGRATION_BACKUP} (${PM_SIZE})"

    # 同时导出 schema-only 备份 (不含数据，便于对比)
    SCHEMA_BACKUP="${BACKUP_DIR}/post_migration_${TIMESTAMP}_schema.sql"
    docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --schema-only > "$SCHEMA_BACKUP" 2>/dev/null
    log_info "Schema 备份: ${SCHEMA_BACKUP}"
fi

# ============================================
# Step 7: 全量验证报告
# ============================================
log_step "7/8 生成验证报告"

REPORT_FILE="${BACKUP_DIR}/migration_report_${TIMESTAMP}.md"

if [ "$DRY_RUN" != "--dry-run" ]; then
    cat > "$REPORT_FILE" <<EOF
# GlobalReach V2.0 — Migration Report

**Date**: $(date '+%Y-%m-%d %H:%M:%S')
**PostgreSQL**: 16.14-alpine
**Database**: ${PG_DB}
**User**: ${PG_USER}

## Schema Summary

| Category | Count |
|----------|-------|
| Total Tables | ${TOTAL_TABLES:-N/A} |
| Users | ${TOTAL_USERS:-N/A} |
| Tenants | ${TOTAL_TENANTS:-N/A} |
| Settings | ${TOTAL_SETTINGS:-N/A} |

## Tables Created

$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "\dt" 2>/dev/null)

## Indexes

$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "\di" 2>/dev/null)

## Backup Files
- Pre-migration: ${BACKUP_FILE}
- Post-migration full: ${POST_MIGRATION_BACKUP}
- Post-migration schema: ${SCHEMA_BACKUP}

## Admin Credentials
- **Email**: admin@globalreach.com
- **Password**: \`Admin@2026Secure!\`
- **Role**: admin
- **Change immediately after first login!**

## Rollback Command
\`\`\`bash
bash scripts/run-live-migration.sh --rollback
\`\`\`
EOF

    log_info "验证报告: ${REPORT_FILE}"
fi

# ============================================
# Step 8: 完成
# ============================================
log_step "8/8 迁移流程完成"

echo ""
echo "=============================================="
if [ "$DRY_RUN" = "--dry-run" ]; then
    echo -e "${YELLOW}[DRY RUN]${NC} 迁移预览完成 — 未做任何修改"
    echo "执行真实迁移请去掉 --dry-run 参数"
elif [ "$ROLLBACK" = "--rollback" ]; then
    echo -e "${YELLOW}[ROLLBACK]${NC} 数据库已回滚到迁移前状态"
else
    echo -e "${GREEN}[SUCCESS]${NC} 迁移成功完成!"
    echo ""
    echo "  📁 备份位置: ${BACKUP_DIR}/"
    echo "  📄 报告文件: ${REPORT_FILE}"
    echo ""
    echo "  🔑 管理员登录:"
    echo "     URL:    http://localhost:3000/api/v1/auth/login"
    echo "     Email:  admin@globalreach.com"
    echo "     Pass:   Admin@2026Secure!"
    echo "     ⚠️  请立即修改密码!"
fi
echo "=============================================="
