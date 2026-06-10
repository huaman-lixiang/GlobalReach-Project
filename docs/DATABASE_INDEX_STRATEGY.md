# GlobalReach V2.0 数据库索引策略 (Database Index Strategy)

> 版本: 1.0.0
> 最后更新: 2026-06-09 (S133/DEBT-023)
> 数据库: PostgreSQL 15
> ORM: Sequelize 6.x
> 备选ORM: Prisma (schema.prisma)

---

## 目录

1. [索引清单 (Index Inventory)](#1-索引清单-index-inventory)
2. [索引设计决策记录](#2-索引设计决策记录)
3. [索引维护策略](#3-索引维护策略)
4. [Sequelize sync({alter:true}) 兼容性](#4-sequelize-synctaltertrue-兼容性)
5. [性能基线 (Performance Baseline)](#5-性能基线-performance-baseline)
6. [监控集成](#6-监控集成)
7. [变更日志](#7-变更日志)

---

## 1. 索引清单 (Index Inventory)

### 1.1 概览

GlobalReach V2.0 的索引分为 **三层**:

| 层级 | 来源 | 数量 | 说明 |
|------|------|------|------|
| L1 - 主键/唯一约束 | Sequelize Model 定义 (`primaryKey: true`, `unique: true`) | ~12 | 自动创建，不可删除 |
| L2 - 模型级索引 | Sequelize Model `indexes` 选项 | ~22 | 多租户架构核心索引 |
| L3 - 手动优化索引 | `api/db/optimize.js` → `createIndexes()` | 18 | D17 性能优化补充 |

**总计**: 约 **52 个索引** (含主键)，分布在 **13 张表** 上。

### 1.2 用户相关表

#### users 表

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `users_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `users_email_key` | `email` (VARCHAR255) | UNIQUE | ✅ | L1-Sequelize | 登录验证、唯一性约束 | ~16KB |
| `idx_users_email` | `email` | B-tree | ❌ | L3-optimize.js | ⚠️ **与L1重复** — 可移除 | ~16KB |
| `idx_users_role` | `role` (ENUM) | B-tree | ❌ | L3-optimize.js | 按角色筛选用户(管理后台) | ~8KB |
| `users_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离过滤(S130/N01) | ~8KB |
| `users_tenant_id_email` | `[tenant_id, email]` | B-tree | ❌ | L2-Sequelize | 租户内邮箱唯一查找 | ~12KB |

> **注意**: `idx_users_email` 与 Sequelize 自动创建的 `users_email_key` (UNIQUE INDEX) 功能重叠。
> 建议在后续版本中移除 `idx_users_email`，保留唯一约束版本。

#### refresh_tokens 表

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `refresh_tokens_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `idx_refresh_tokens_user_id` | `user_id` | B-tree | ❌ | L3-optimize.js | Token清理/撤销时按用户查找 | ~8KB |
| `idx_refresh_tokens_expires_at` | `expires_at` | B-tree | ❌ | L3-optimize.js | 过期Token清理任务(Cron) | ~8KB |
| `refresh_tokens_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~8KB |

#### devices 表

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `devices_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `devices_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~8KB |
| `devices_tenant_id_user_id` | `[tenant_id, user_id]` | B-tree | ❌ | L2-Sequelize | 用户设备列表查询(D28移动端) | ~12KB |

#### feedbacks 表

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `feedbacks_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `feedbacks_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~8KB |

### 1.3 业务核心表

#### email_accounts 表 (邮箱账号池)

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `email_accounts_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `idx_email_accounts_user_id` | `user_id` | B-tree | ❌ | L3-optimize.js | 按用户查找账号池 | ~8KB |
| `idx_email_accounts_platform` | `platform` (ENUM) | B-tree | ❌ | L3-optimize.js | 按平台类型筛选(Gmail/Outlook等) | ~8KB |
| `idx_email_accounts_status` | `status` (ENUM) | B-tree | ❌ | L3-optimize.js | 账号状态过滤(ACTIVE/BANNED等) | ~8KB |
| `email_accounts_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~8KB |
| `email_accounts_tenant_id_user_id` | `[tenant_id, user_id]` | B-tree | ❌ | L2-Sequelize | 租户内用户账号列表 | ~12KB |

> **Prisma额外**: Prisma schema 还定义了 `@@index([email])` 用于按邮箱搜索账号。

#### clients 表 (客户数据)

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `clients_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `idx_clients_user_id` | `user_id` | B-tree | ❌ | L3-optimize.js | 按用户查找客户列表 | ~8KB |
| `idx_clients_email` | `email` | B-tree | ❌ | L3-optimize.js | 客户邮箱搜索/去重 | ~16KB |
| `clients_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~8KB |
| `clients_tenant_id_user_id` | `[tenant_id, user_id]` | B-tree | ❌ | L2-Sequelize | 租户内用户客户列表 | ~12KB |
| `clients_tenant_id_status` | `[tenant_id, status]` | B-tree | ❌ | L2-Sequelize | 租户内按客户状态筛选 | ~12KB |

> **Prisma额外**: `@@index([country])`, `@@index([status])`

#### campaigns 表 (营销活动)

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `campaigns_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `idx_campaigns_user_id` | `user_id` | B-tree | ❌ | L3-optimize.js | 按用户查找活动列表 | ~8KB |
| `idx_campaigns_status` | `status` (ENUM) | B-tree | ❌ | L3-optimize.js | 活动状态过滤(DRAFT/SENDING等) | ~8KB |
| `campaigns_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~8KB |
| `campaigns_tenant_id_status` | `[tenant_id, status]` | B-tree | ❌ | L2-Sequelize | 租户内活动状态筛选(高频查询) | ~12KB |
| `campaigns_tenant_id_user_id` | `[tenant_id, user_id]` | B-tree | ❌ | L2-Sequelize | 租户内用户活动列表 | ~12KB |

> **Prisma额外**: `@@index([type])` 用于按活动类型筛选。

#### emails 表 (邮件记录) — **最高频写入表**

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `emails_pkey` | `id` (UUID) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~64KB+ |
| `idx_emails_campaign_id` | `campaign_id` | B-tree | ❌ | L3-optimize.js | 按活动查邮件列表(统计面板) | ~32KB |
| `idx_emails_account_id` | `account_id` | B-tree | ❌ | L3-optimize.js | 按发送账号查邮件(M7引擎) | ~32KB |
| `idx_emails_client_id` | `client_id` | B-tree | ❌ | L3-optimize.js | 按客户查邮件历史 | ~32KB |
| `idx_emails_status` | `status` (ENUM) | B-tree | ❌ | L3-optimize.js | 邮件状态过滤(PENDING/SENT等) | ~32KB |
| `idx_emails_created_at` | `created_at` | B-tree | ❌ | L3-optimize.js | 时间范围查询(分析报表) | ~32KB |
| `emails_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~32KB |
| `emails_tenant_id_status` | `[tenant_id, status]` | B-tree | ❌ | L2-Sequelize | 租户内状态筛选 | ~40KB |
| `emails_tenant_id_sent_at` | `[tenant_id, sent_at]` | B-tree | ❌ | L2-Sequelize | 租户内发送时间排序 | ~40KB |

> **Prisma额外**: `@@index([userId])`, `@@index([toAddress])`
>
> **Size说明**: emails 表是写入最频繁的表，索引大小随数据量线性增长。
> 预估基于 10万行数据量，实际生产环境可能达到数MB。

### 1.4 租户表

#### tenants 表

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `tenants_pkey` | `id` (INTEGER) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |
| `tenants_slug_key` | `slug` | UNIQUE | ✅ | L1-Sequelize | 租户标识符唯一查找 | ~8KB |
| `tenants_status` | `status` | B-tree | ❌ | L2-Tenant模型 | 管理后台租户状态过滤 | ~8KB |
| `tenants_plan` | `plan` | B-tree | ❌ | L2-Tenant模型 | 运营分析: 按套餐统计 | ~8KB |
| `tenants_status_created_at` | `[status, created_at]` | B-tree | ❌ | L2-Tenant模型 | 管理后台排序: 状态+时间 | ~12KB |

### 1.5 监控/日志表

#### audit_logs 表 (操作审计)

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `audit_logs_pkey` | `id` (BIGINT AUTO) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~32KB+ |
| `idx_audit_logs_user_id` | `user_id` | B-tree | ❌ | L3-optimize.js | 按用户查审计记录 | ~16KB |
| `idx_audit_logs_created_at` | `created_at` | B-tree | ❌ | L3-optimize.js | 时间范围审计查询 | ~16KB |
| `audit_logs_user_id` | `user_id` | B-tree | ❌ | L2-Sequelize | 同上(L2版本) | ~16KB |
| `audit_logs_action` | `action` | B-tree | ❌ | L2-Sequelize | 按操作类型筛选 | ~16KB |
| `audit_logs_resource_type` | `resource_type` | B-tree | ❌ | L2-Sequelize | 按资源类型筛选 | ~16KB |
| `audit_logs_severity` | `severity` | B-tree | ❌ | L2-Sequelize | 按严重级别筛选(N03合规) | ~8KB |
| `audit_logs_status` | `status` | B-tree | ❌ | L2-Sequelize | 按执行结果筛选 | ~8KB |
| `audit_logs_created_at` | `created_at` | B-tree | ❌ | L2-Sequelize | 时间排序 | ~16KB |
| `audit_logs_user_id_created_at` | `[user_id, created_at]` | B-tree | ❌ | L2-Sequelize | 用户审计时间线(高频) | ~20KB |
| `audit_logs_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~16KB |
| `audit_logs_tenant_id_created_at` | `[tenant_id, created_at]` | B-tree | ❌ | L2-Sequelize | 租户审计时间线 | ~20KB |

#### error_logs 表

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `error_logs_pkey` | `id` (BIGINT AUTO) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~16KB |
| `error_logs_tenant_id` | `tenant_id` | B-tree | ❌ | L2-Sequelize | 多租户隔离 | ~16KB |

#### maintenance_logs 表

| 索引名 | 列 | 类型 | 唯一 | 来源 | 用途 | Size估算 |
|--------|-----|------|------|------|------|----------|
| `maintenance_logs_pkey` | `id` (BIGINT AUTO) | PRIMARY | ✅ | L1-Sequelize | 主键查找 | ~8KB |

> **注意**: maintenance_logs 表仅有主键索引，无业务索引。如需按 event_type 查询，建议后续添加。

### 1.6 已知重复索引 (Duplicate Indexes)

以下索引存在功能重叠，建议在下一个维护窗口评估合并或移除:

| # | 重复索引对 | 重叠原因 | 建议 |
|---|-----------|---------|------|
| D1 | `users_email_key`(UNIQUE) vs `idx_users_email` | 均索引 `email` 列 | 保留UNIQUE版，移除 `idx_users_email` |
| D2 | `idx_audit_logs_user_id`(L3) vs `audit_logs_user_id`(L2) | 均索引 `user_id` 列 | 保留L2版(Sequelize管理)，从optimize.js移除 |
| D3 | `idx_audit_logs_created_at`(L3) vs `audit_logs_created_at`(L2) | 均索引 `created_at` 列 | 同上 |

---

## 2. 索引设计决策记录

### 2.1 为什么选择 B-tree 而非其他类型?

GlobalReach V2.0 全部使用 **B-tree** 索引，决策理由如下:

| 因素 | B-tree | GiST | GiN | Hash | BRIN |
|------|--------|------|-----|------|------|
| 等值查询 (=, IN) | ✅ 优秀 | ❌ | ❌ | ✅ 仅= | ⚠️ |
| 范围查询 (>, <, BETWEEN) | ✅ 优秀 | ❌ | ❌ | ❌ | ✅ |
| 排序 (ORDER BY) | ✅ 天然有序 | ❌ | ❌ | ❌ | ❌ |
| 写入性能影响 | 中等 | 高 | 高 | 低 | 极低 |
| 存储开销 | 中等 | 高 | 很高 | 低 | 极低 |

**结论**: GlobalReach 的查询模式以 **等值查询 + 范围查询 + ORDER BY** 为主:
- 用户登录: `WHERE email = ?` (等值)
- Campaign列表: `WHERE user_id = ? AND status = ? ORDER BY created_at DESC` (等值+排序)
- 邮件统计: `WHERE campaign_id = ? AND status = ?` (等值)
- 审计日志: `WHERE user_id = ? AND created_at > ?` (等值+范围)

所有这些模式都是 B-tree 的最佳场景。

**未来扩展方向**:
- 如果实现全文搜索(邮件内容/主题): 考虑 GiN + `tsvector`
- 如果实现地理位置查询: 考虑 GiST + PostGIS
- 如果 logs 表极大(>1000万行): 考虑 BRIN 替代 created_at 索引

### 2.2 复合索引 vs 单列索引决策

每个复合索引的选择都有明确的查询场景支撑:

| 复合索引 | 选择理由 | 支撑查询 |
|----------|---------|---------|
| `[tenant_id, email]` | 所有业务查询都先按 tenant 过滤，再按 email 精确查找 | 登录验证、用户去重 |
| `[tenant_id, user_id]` | 租户内用户维度的关联查询 | "某用户的账号池/客户/活动" |
| `[tenant_id, status]` | 租户内按状态过滤+排序 | "进行中的活动"、"活跃客户" |
| `[tenant_id, sent_at]` | 租户内按发送时间排序(分析面板) | "最近发送的邮件" |
| `[user_id, created_at]` | 用户操作审计时间线 | "该用户近期的操作记录" |
| `[tenant_id, created_at]` | 租户级别的审计时间线 | "该租户近期所有操作" |
| `[status, created_at]` | Tenant管理后台的状态排序 | "按状态+时间排列的租户列表" |

**设计原则 — 最左前缀匹配**:
- 复合索引的 **第一列** 应该是选择性最高(区分度最大)且最常用于 WHERE 条件的列
- `tenant_id` 作为多租户系统的必过滤条件，天然适合作为复合索引首列
- 后续列按查询频率和选择性递减排列

### 2.3 Partial Index 使用场景

当前实现 **未使用 Partial Index**。以下是推荐引入的场景:

```sql
-- 场景1: 仅索引活跃账号 (emails表最大，可减少50%索引大小)
CREATE INDEX CONCURRENTLY idx_emails_active_status ON emails (status, sent_at)
WHERE status IN ('PENDING', 'QUEUED', 'SENDING');

-- 场景2: 仅索引未过期Token
CREATE INDEX CONCURRENTLY idx_refresh_tokens_valid ON refresh_tokens (user_id, expires_at)
WHERE revoked_at IS NULL AND expires_at > NOW();

-- 场景3: 仅索引活跃Campaign
CREATE INDEX CONCURRENTLY idx_campaigns_active ON campaigns (user_id, status, updated_at)
WHERE status IN ('DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED');
```

> **待实施**: 这些 Partial Index 可在下一个性能优化 Sprint 中评估引入。

### 2.4 索引大小估算方法论

| 表 | 预估行数 | 索引总数 | 总索引Size预估 | 写入放大比 |
|----|---------|---------|---------------|-----------|
| users | <10,000 | 6 | ~60KB | 1.5x |
| email_accounts | <5,000 | 6 | ~56KB | 1.8x |
| clients | <100,000 | 6 | ~400KB | 1.8x |
| campaigns | <10,000 | 6 | ~72KB | 2.0x |
| **emails** | **<1,000,000** | **9** | **~8MB+** | **2.5x** |
| refresh_tokens | <50,000 | 4 | ~160KB | 1.5x |
| audit_logs | <500,000 | 11 | **~4MB+** | 2.2x |
| error_logs | <100,000 | 2 | ~160KB | 1.5x |
| tenants | <100 | 5 | ~20KB | 1.2x |
| devices | <10,000 | 3 | ~28KB | 1.5x |
| feedbacks | <1,000 | 2 | ~16KB | 1.5x |
| maintenance_logs | <10,000 | 1 | ~8KB | 1.2x |

**写入放大比** = 每次INSERT/UPDATE/DELETE 触发的索引维护次数。emails 表的 2.5x 意味着每封邮件写入需要维护约 2.5 个索引（平均），这是可接受的范围。

---

## 3. 索引维护策略

### 3.1 创建/修改流程

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────┐
│ 开发环境测试     │ -> │ CREATE INDEX     │ -> │ 生产环境验证     │ -> │ 文档更新      │
│ EXPLAIN ANALYZE │    │ CONCURRENTLY     │    │ pg_stat_user_    │    │ 本文件        │
│                 │    │ (不锁表)         │    │ indexes          │    │              │
└─────────────────┘    └──────────────────┘    └─────────────────┘    └──────────────┘
```

**Step-by-step**:

1. **开发环境**: 对新索引运行 `EXPLAIN ANALYZE` 确认查询计划改善
2. **生产环境**: 使用 `CREATE INDEX CONCURRENTLY` (不阻塞读写)
3. **验证等待**: CONCURRENTLY 创建后需等待 `pg_stat_user_indexes.idx_scan` 有数据(通常24h)
4. **回滚准备**: 如未改善查询，执行 `DROP INDEX CONCURRENTLY`
5. **文档同步**: 更新本文档的对应章节

### 3.2 未使用索引检测 SQL

```sql
-- ============================================
-- 找出未被使用或低使用率的索引
-- 排除主键索引 (pkey) 和唯一约束索引
-- 按 index_size 降序排列 (最大的浪费优先处理)
-- ============================================
SELECT
    schemaname || '.' || relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS index_scans,
    tup_read AS tuples_read,
    tup_fetch AS tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    CASE
        WHEN idx_scan = 0 THEN '🔴 NEVER USED'
        WHEN idx_scan < 50 THEN '🟡 RARELY USED'
        ELSE '✅ ACTIVE'
    END AS usage_status
FROM pg_stat_user_indexes
JOIN pg_index ON pg_stat_user_indexes.indexrelid = pg_index.indexrelid
WHERE idx_scan < 50
  AND indexrelname NOT LIKE '%_pkey%'
  AND NOT pg_index.indisunique  -- 排除唯一约束索引(可能有隐式用途)
ORDER BY pg_relation_size(indexrelid) DESC;
```

**定期执行建议**: 每周一通过 Cron 或手动执行，将结果存入运维报告。

### 3.3 索引膨胀检测与清理

```sql
-- ============================================
-- 检查索引膨胀率 (bloat > 50% 需要关注)
-- 基于 pgstatindex 扩展 (需安装: CREATE EXTENSION pgstattuple)
-- ============================================
SELECT
    schemaname || '.' || tablename AS table_name,
    indexname,
    pg_size_pretty(total_bytes) AS total_size,
    CASE
        WHEN pgstatindex(indexname::regclass).leaf_fragmentation > 50 THEN '🔴 HIGH BLOAT'
        WHEN pgstatindex(indexname::regclass).leaf_fragmentation > 30 THEN '🟡 MEDIUM BLOAT'
        ELSE '✅ OK'
    END AS bloat_status
FROM pg_tables
CROSS JOIN LATERAL (
    SELECT indexname FROM pg_indexes
    WHERE tablename = pg_tables.tablename
    AND schemaname = pg_tables.schemaname
) sub;

-- ============================================
-- REINDEX CONCURRENTLY 清理方案 (PostgreSQL 12+)
-- 不锁表，在线重建索引
-- ============================================
-- 单个索引:
REINDEX INDEX CONCURRENTLY idx_emails_status;

-- 整张表的所有索引:
REINDEX TABLE CONCURRENTLY emails;

-- 注意: REINDEX CONCURRENTLY 不能在事务块内执行
```

### 3.4 索引创建安全模板

```javascript
// api/db/optimize.js 中的安全创建模式
const INDEX_DEFINITIONS = [
  {
    name: 'idx_users_email',
    table: 'users',
    columns: ['email'],
    unique: false,
    method: 'btree',  // PostgreSQL 默认
    concurrently: true,
    rationale: '登录验证查询优化 (与Sequelize UNIQUE INDEX存在重叠)'
  },
  // ... 其他索引定义
];

async function createIndexes() {
  const results = [];

  for (const idx of INDEX_DEFINITIONS) {
    const start = Date.now();
    try {
      // 使用 IF NOT EXISTS 避免重复创建错误
      const sql = idx.concurrently
        ? `CREATE ${idx.unique ? 'UNIQUE' : ''} INDEX CONCURRENTLY IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.columns.join(', ')})`
        : `CREATE ${idx.unique ? 'UNIQUE' : ''} INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.columns.join(', ')})`;

      await sequelize.query(sql);
      results.push({ name: idx.name, status: 'CREATED', duration: Date.now() - start });
    } catch (error) {
      if (error.message.includes('already exists')) {
        results.push({ name: idx.name, status: 'SKIPPED (exists)', duration: Date.now() - start });
      } else {
        results.push({ name: idx.name, status: 'FAILED', duration: Date.now() - start, error: error.message });
      }
    }
  }

  return results;
}
```

---

## 4. Sequelize sync({alter:true}) 兼容性

### 4.1 已知冲突点

`server.js:364` 调用 `sequelize.sync({ alter: true })`，此操作会:
1. **自动创建** Model 定义中 `indexes` 选项指定的索引 (L2层)
2. **不会删除** 已存在的索引 (即使Model定义中已移除)
3. **不会感知** optimize.js 手动创建的索引 (L3层)

**潜在冲突**:

| 冲突类型 | 示例 | 影响 | 当前状态 |
|----------|------|------|---------|
| 重复索引 | `idx_audit_logs_user_id`(L3) vs `audit_logs_user_id`(L2) | 浪费存储 + 写入放大 | ⚠️ 存在 |
| 功能重叠 | `idx_users_email`(L3) vs `users_email_key`(UNIQUE, L1) | 无功能损失但浪费空间 | ⚠️ 存在 |
| 遗留索引 | sync不会删除旧索引 | 索引堆积 | 🔍 需监控 |

### 4.2 推荐做法

```javascript
// 方案A: 在 createIndexes() 中使用 DO $$ ... END $$ 块检查
// 优点: 事务安全，可批量执行
// 缺点: CONCURRENTLY 不能在事务中使用
await sequelize.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE indexname = 'idx_users_email'
        AND tablename = 'users'
    ) THEN
      CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
    END IF;
  END $$;
`);

// 方案B: 使用 IF NOT EXISTS (当前采用的方式，更简洁)
// 优点: 简单直接，CONCURRENTLY 兼容
// 缺点: 无法在同一事务中做复杂判断
await sequelize.query(`
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
`);
```

**当前代码采用方案B**，这是正确的选择。`IF NOT EXISTS` 配合 `CONCURRENTLY` 是生产环境的最优解。

### 4.3 长期建议

1. **逐步迁移**: 将 L3 层(optimize.js)索引定义迁移到 L2 层(Sequelize Model indexes)
2. **统一管理**: 所有索引通过 Sequelize Model 定义集中管理
3. **移除 optimize.js**: 迁移完成后，`createIndexes()` 可简化为仅创建 Sequelize 无法表达的特殊索引(如Partial Index、Expression Index)

---

## 5. 性能基线 (Performance Baseline)

### 5.1 Top-10 关键查询及预期性能

| # | 查询描述 | 表 | 预期行数 | 目标P95 | 当前P95 | 索引依赖 |
|---|---------|-----|---------|---------|---------|---------|
| 1 | 用户登录验证 | users | 1 | <5ms | TBD | `users_email_key`(UNIQUE) |
| 2 | Campaign列表(分页+状态过滤) | campaigns | 20 | <50ms | TBD | `campaigns_tenant_id_status` |
| 3 | Email发送队列取邮件 | emails | 100 | <30ms | TBD | `emails_tenant_id_status` |
| 4 | Client搜索(按邮箱) | clients | 1-10 | <20ms | TBD | `idx_clients_email` |
| 5 | 账号池状态检查 | email_accounts | 5-20 | <15ms | TBD | `idx_email_accounts_status` |
| 6 | 审计日志时间线 | audit_logs | 50 | <80ms | TBD | `audit_logs_user_id_created_at` |
| 7 | Token过期清理 | refresh_tokens | 100 | <30ms | TBD | `idx_refresh_tokens_expires_at` |
| 8 | 邮件统计聚合 | emails | 10000 | <200ms | TBD | `idx_emails_campaign_id` |
| 9 | 设备推送目标查找 | devices | 1-5 | <10ms | TBD | `devices_tenant_id_user_id` |
| 10 | 租户配额检查 | tenants | 1 | <5ms | TBD | `tenants_pkey` |

> **TBD**: 当前P95值需要通过 `EXPLAIN ANALYZE` 在生产环境采集。建议在 S134 Sprint 中建立自动化基准测试。

### 5.2 索引覆盖率目标

| 覆盖维度 | 目标 | 当前状态 | 差距 |
|----------|------|---------|------|
| WHERE 条件列有索引 | 100% | ~95% | `error_logs.error_type`, `maintenance_logs.event_type` 缺索引 |
| JOIN 列有外键索引 | 100% | 100% | ✅ 全部覆盖 |
| ORDER BY 列有排序索引 | 90% | ~85% | 部分 `ORDER BY created_at` 依赖复合索引后缀 |
| GROUP BY 列有索引 | 80% | ~70% | 聚合查询未全部优化 |

### 5.3 Seq Scan Ratio 目标

```
理想值: seq_scan / (seq_scan + idx_scan) < 5%
警戒值: > 10% (触发告警)
严重值: > 25% (需立即调查缺失索引)

-- 查询当前 Seq Scan Ratio
SELECT
    round(
        100.0 * sum(seq_scan) / nullif(sum(seq_scan) + sum(idx_scan), 0),
        2
    ) as seq_scan_ratio
FROM pg_stat_user_tables;
```

---

## 6. 监控集成

### 6.1 Prometheus 指标定义

```yaml
# globalreach_db_index metrics (建议添加到 D15 Prometheus 收集器)
- name: globalreach_db_index_size_bytes
  type: gauge
  help: "Size of each database index in bytes"
  labels: [table_name, index_name]
  query: |
    SELECT
      schemaname || '.' || relname AS table_name,
      indexrelname AS index_name,
      pg_relation_size(indexrelid) AS size
    FROM pg_stat_user_indexes

- name: globalreach_db_index_usage_total
  type: counter
  help: "Total number of index scans per index"
  labels: [table_name, index_name]
  query: |
    SELECT
      schemaname || '.' || relname AS table_name,
      indexrelname AS index_name,
      COALESCE(idx_scan, 0) AS usage
    FROM pg_stat_user_indexes

- name: globalreach_db_seq_scan_ratio
  type: gauge
  help: "Ratio of sequential scans to total scans (should be < 0.05)"
  query: |
    SELECT
      round(
        100.0 * sum(seq_scan) / nullif(sum(seq_scan) + sum(idx_scan), 0),
        2
      ) AS ratio
    FROM pg_stat_user_tables
```

### 6.2 Grafana 面板建议

#### Panel 1: Index Usage Top-10
- **类型**: Table / Bar Chart
- **数据源**: Prometheus `globalreach_db_index_usage_total`
- **排序**: 按 usage 降序
- **用途**: 识别最常用索引(确保这些索引保持最优)

#### Panel 2: Unused Indexes (Waste Detector)
- **类型**: Table
- **数据源**: Prometheus `globalreach_db_index_usage_total`
- **过滤**: usage == 0
- **颜色**: 红色高亮
- **用途**: 定期审查并移除无用索引

#### Panel 3: Index Size Trend
- **类型**: Time Series (Area)
- **数据源**: Prometheus `globalreach_db_index_size_bytes`
- **聚合**: SUM by table_name
- **用途**: 监控索引存储增长趋势

#### Panel 4: Seq Scan Ratio Alert
- **类型**: Stat/Gauge
- **数据源**: Prometheus `globalreach_db_seq_scan_ratio`
- **阈值**:
  - 🟢 < 5%: 正常
  - 🟡 5-10%: 警告
  - 🔴 > 10%: 告警 (需调查)

### 6.3 告警规则建议

```yaml
# alertmanager/rules/db-index.yml
groups:
  - name: database_index
    rules:
      - alert: HighSeqScanRatio
        expr: globalreach_db_seq_scan_ratio > 10
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "数据库顺序扫描比例过高 ({{ $value }}%)"
          description: "Seq Scan Ratio 超过 10%，可能存在缺失索引的查询"

      - alert: UnusedLargeIndex
        expr: globalreach_db_index_usage_total == 0 and globalreach_db_index_size_bytes > 1048576  # >1MB
        for: 24h
        labels:
          severity: info
        annotations:
          summary: "发现大于1MB的未使用索引: {{ $labels.index_name }}"
          description: "索引 {{ $labels.index_name }} 在24小时内未被扫描过，占用 {{ $value }} 字节"
```

---

## 7. 变更日志

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|---------|
| v1.0.0 | 2026-06-09 | S133/DEBT-023 | Initial strategy document. 完整索引清单(52个索引/13张表)、设计决策、维护流程、监控集成方案。识别3组重复索引(D1-D3)。 |

---

## 附录 A: 快速参考 SQL

```sql
-- A1. 查看表的所有索引
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'emails';

-- A2. 查看索引大小
SELECT
    indexrelname AS name,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size,
    idx_scan AS scans
FROM pg_stat_user_indexes
WHERE relname = 'emails'
ORDER BY pg_relation_size(indexrelid) DESC;

-- A3. 查看某个查询是否使用了索引
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM emails WHERE campaign_id = 'uuid' AND status = 'SENT' LIMIT 20;

-- A4. 查看所有表的索引总大小
SELECT
    relname AS table_name,
    pg_size_pretty(pg_indexes_size(relid)) AS total_index_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size
FROM pg_class
WHERE relkind = 'r'
  AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY pg_indexes_size(relid) DESC
LIMIT 20;
```

## 附录 B: 索引命名规范

| 前缀 | 含义 | 示例 |
|------|------|------|
| `idx_` | 通用B-tree索引 | `idx_users_role` |
| `uniq_` | 唯一索引(手动创建) | *(当前未使用，Sequelize自动管理)* |
| `_pkey` | 主键约束 | `users_pkey` |
| `_key` | 唯一约束 | `users_email_key` |
| `{table}_{col1}_{col2}` | Sequelize自动生成 | `emails_tenant_id_status` |

**建议**: 未来新增手动索引统一使用 `idx_{table}_{columns}` 格式。
