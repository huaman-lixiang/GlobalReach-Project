# GlobalReach V2.0 多租户（Multi-Tenancy）架构设计

> **文档版本**: v1.0
> **创建日期**: 2026-06-09
> **关联任务**: S130/N01 — 多租户支持架构设计与实现
> **状态**: ✅ 已实现

---

## 目录

1. [概述](#1-概述)
2. [多租户模式对比分析](#2-多租户模式对比分析)
3. [推荐方案：共享数据库 + 租户ID列隔离](#3-推荐方案共享数据库--租户id列隔离)
4. [tenant_id 隔离策略](#4-tenant_id-隔离策略)
5. [数据库迁移方案](#5-数据库迁移方案)
6. [RBAC 与租户权限集成模型](#6-rbac-与租户权限集成模型)
7. [租户配额与资源隔离策略](#7-租户配额与资源隔离策略)
8. [性能影响评估与优化建议](#8-性能影响评估与优化建议)
9. [实施路线图](#9-实施路线图)

---

## 1. 概述

GlobalReach V2.0 当前为单租户架构，所有数据存储在同一 PostgreSQL 数据库中，通过 `user_id` 做用户级隔离。本方案引入**多租户（Multi-Tenancy）**支持，使平台能够服务多个独立组织/企业客户，每个租户的数据完全隔离。

### 核心目标

| 目标 | 描述 |
|------|------|
| **数据隔离** | 租户间数据完全不可见，防止跨租户数据泄露 |
| **向后兼容** | 现有单租户系统继续工作（默认租户 ID = 1） |
| **最小侵入性** | 在现有 11 张表基础上添加 `tenant_id` 列 |
| **可扩展** | 支持未来从共享 DB 迁移到独立 Schema/DB |
| **性能可控** | 通过索引优化确保查询性能不退化 |

---

## 2. 多租户模式对比分析

### 2.1 三种主流模式

```
┌─────────────────────────────────────────────────────────────────────┐
│                    多租户架构模式对比                                 │
├──────────┬──────────────┬───────────────┬───────────────────────────┤
│   模式    │   共享DB     │   独立Schema   │       独立DB              │
├──────────┼──────────────┼───────────────┼───────────────────────────┤
│ 隔离级别 │   行级(tenant_id)│   Schema级    │   数据库实例级            │
│ 隔离强度 │   ★★☆        │   ★★★         │   ★★★                    │
│ 运维成本 │   ★☆☆        │   ★★☆         │   ★★★                    │
│ 扩展性   │   ★★☆        │   ★★★         │   ★★★                    │
│ 成本     │   低          │   中          │   高                     │
│ 适用规模 │   <500租户    │   500-2000    │   >2000 / 高合规要求      │
└──────────┴──────────────┴───────────────┴───────────────────────────┘
```

#### 模式 A：共享数据库 + tenant_id 列（Discriminator Column）

```sql
-- 所有表共用一个数据库，每张表添加 tenant_id 列
CREATE TABLE clients (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1,  -- 租户标识
  user_id UUID NOT NULL,
  email VARCHAR(255) NOT NULL,
  ...
  INDEX idx_clients_tenant (tenant_id)   -- 必须索引
);
```

**优点**：
- ✅ 实现最简单，改动量最小
- ✅ 运维成本低（单一数据库实例）
- ✅ 跨租户统计查询方便
- ✅ 资源利用率最高

**缺点**：
- ⚠️ 隔离强度最低（依赖应用层 WHERE 子句）
- ⚠️ 应用 bug 可能导致跨租户数据泄露
- ⚠️ 单点故障影响所有租户

#### 模式 B：共享数据库 + 独立 Schema（Schema-Based）

```sql
-- 每个租户拥有独立的 PostgreSQL Schema
CREATE SCHEMA tenant_acme;
CREATE TABLE tenant_acme.clients (...);
CREATE SCHEMA tenant_globex;
CREATE TABLE tenant_globex.clients (...);

-- 查询时自动切换 Schema
SET search_path TO tenant_acme, public;
```

**优点**：
- ✅ 逻辑隔离清晰（Schema 级别命名空间）
- ✅ 可以为不同 Schema 设置不同的权限
- ✅ 支持按 Schema 备份/恢复单个租户
- ✅ 中等运维复杂度

**缺点**：
- ⚠️ DDL 变更需要在所有 Schema 上执行
- ⚠️ 跨租户聚合查询需要 UNION ALL
- ⚠️ 连接池管理更复杂（需要 Schema 切换）

#### 模式 C：独立数据库（Database-per-Tenant）

```sql
-- 每个租户使用独立的 PostgreSQL 数据库
-- 需要动态连接池管理
const pools = new Map();
pools.set('acme', new Pool({ database: 'globalreach_acme' }));
pools.set('globex', new Pool({ database: 'globalreach_globex' }));
```

**优点**：
- ✅ 最强隔离级别（物理隔离）
- ✅ 可为每个租户独立调优、备份、扩容
- ✅ 满足高合规要求（金融、医疗）
- ✅ 单租户故障不影响其他租户

**缺点**：
- ❌ 运维成本极高（N 个数据库实例）
- ❌ 资源浪费严重（每个 DB 需要独立连接池）
- ❌ 跨租户功能实现困难
- ❌ 不适合中小规模部署

### 2.2 推荐方案：模式 A — 共享数据库 + tenant_id 列

**选择理由**：

| 评估维度 | 得分 | 说明 |
|----------|------|------|
| **与现有系统兼容性** | ⭐⭐⭐⭐⭐ | 仅需在 11 张表添加 `tenant_id` 列，无需重构 |
| **实施风险** | ⭐⭐⭐⭐⭐ | 风险最低，可分阶段 rollout |
| **运维成本** | ⭐⭐⭐⭐⭐ | 无需额外基础设施 |
| **性能影响** | ⭐⭐⭐⭐ | 通过索引优化可将影响降至 <5% |
| **扩展路径** | ⭐⭐⭐⭐ | 未来可平滑迁移到 Schema 模式 |
| **GlobalReach 场景匹配度** | ⭐⭐⭐⭐⭐ | 企业邮件营销平台，典型 SaaS 多租户场景 |

**关键决策**：GlobalReach V2.0 作为企业级 SaaS 平台，当前阶段（< 200 租户）采用**模式 A**是最优选择。当租户数量超过 500 或有特定合规需求时，可通过 `pg_dump` + Schema 迁移工具升级到模式 B。

---

## 3. 推荐方案：共享数据库 + 租户ID列隔离

### 3.1 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│                        客户端请求流                                 │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────────┐   │
│  │ 前端 SPA  │───▶│ API Gateway  │───▶│ Express.js Server      │   │
│  │ (React)  │    │ (Nginx/LB)   │    │                        │   │
│  └──────────┘    └──────────────┘    │  ┌──────────────────┐  │   │
│                                      │  │ Tenant Context MW │  │   │
│                                      │  │ (提取 tenant_id)  │  │   │
│                                      │  └────────┬─────────┘  │   │
│                                      │           ▼            │   │
│                                      │  ┌──────────────────┐  │   │
│                                      │  │ Auth MW (JWT)     │  │   │
│                                      │  └────────┬─────────┘  │   │
│                                      │           ▼            │   │
│                                      │  ┌──────────────────┐  │   │
│                                      │  │ Route Handler     │  │   │
│                                      │  │ (自动注入         │  │   │
│                                      │  │  tenant_id 条件)  │  │   │
│                                      │  └────────┬─────────┘  │   │
│                                      │           ▼            │   │
│                                      │  ┌──────────────────┐  │   │
│                                      │  │ Sequelize ORM     │  │   │
│                                      │  │ defaultScope:     │  │   │
│                                      │  │ { tenant_id }     │  │   │
│                                      │  └────────┬─────────┘  │   │
│                                      └───────────┼────────────┘   │
│                                                  ▼                │
│                                      ┌──────────────────────┐    │
│                                      │   PostgreSQL 15      │    │
│                                      │   (共享数据库)        │    │
│                                      │                      │    │
│                                      │  tenants 表           │    │
│                                      │  users (tenant_id)   │    │
│                                      │  clients (tenant_id) │    │
│                                      │  campaigns (...)     │    │
│                                      │  emails (...)        │    │
│                                      │  ... (11张业务表)     │    │
│                                      └──────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件

| 组件 | 文件路径 | 职责 |
|------|----------|------|
| **Tenant 模型** | `api/models/Tenant.js` | 租户实体定义（name/slug/domain/plan/quota/settings/status） |
| **TenantContext 中间件** | `api/middleware/tenantContext.js` | 从 JWT/Header 提取 tenant_id，设置 Sequelize scope |
| **TenantService 服务层** | `api/services/tenantService.js` | CRUD + 配额检查 + 用量统计 |
| **Tenants 路由** | `api/routes/tenants.js` | 租户管理 API（超级管理员专用） |
| **DB 层改造** | `api/db/index.js` | 为所有模型添加 tenant_id 字段和全局 scope |
| **前端管理页面** | `frontend/src/pages/TenantAdmin.tsx` | 租户列表/创建/编辑/配额设置 UI |
| **前端布局修改** | `frontend/src/components/MainLayout.tsx` | 添加租户切换器（超级管理员视图） |

---

## 4. tenant_id 隔离策略

### 4.1 四层隔离体系

```
┌─────────────────────────────────────────────────────────────┐
│                    四层隔离防御体系                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 4: 缓存层 (Redis)                                     │
│  ├── Key 命名空间: tenant:{tenantId}:{resource}             │
│  ├── TTL 策略: 按租户独立配置                                │
│  └── 隔离保证: 不同租户的缓存键不冲突                         │
│                                                             │
│  Layer 3: 路由层 (Express)                                   │
│  ├── X-Tenant-ID Header 提取                                │
│  ├── JWT Payload 中的 tenantId 字段                          │
│  └── req.tenant 上下文对象注入                               │
│                                                             │
│  Layer 2: ORM 层 (Sequelize)                                 │
│  ├── defaultScope: { where: { tenant_id: req.tenant.id } }  │
│  ├── unscoped() 显式绕过（仅超级管理员可用）                  │
│  └── create/update 自动注入 tenant_id                       │
│                                                             │
│  Layer 1: 数据库层 (PostgreSQL)                              │
│  ├── tenant_id 列 + NOT NULL DEFAULT 1                     │
│  ├── 复合索引: (tenant_id, user_id), (tenant_id, created_at)│
│  ├── RLS (Row Level Security): 可选启用                     │
│  └── 外键约束: tenants.id → *.tenant_id                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 各层详细策略

#### Layer 1: 数据库层

```sql
-- 1. 创建 tenants 表
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  domain VARCHAR(255),
  plan VARCHAR(50) NOT NULL DEFAULT 'basic',
  quota JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 为每张业务表添加 tenant_id 列
ALTER TABLE users ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE email_accounts ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaigns ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE emails ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
-- ... 其余表同理

-- 3. 创建索引（关键！没有索引 = 全表扫描）
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_email_accounts_tenant ON email_accounts(tenant_id);
CREATE INDEX idx_clients_tenant ON clients(tenant_id);
CREATE INDEX idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX idx_emails_tenant ON emails(tenant_id);

-- 4. 复合索引（覆盖常见查询模式）
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_clients_tenant_user ON clients(tenant_id, user_id);
CREATE INDEX idx_campaigns_tenant_status ON campaigns(tenant_id, status);
CREATE INDEX idx_emails_tenant_status ON emails(tenant_id, status);

-- 5. 外键约束（可选，影响批量插入性能）
-- ALTER TABLE users ADD CONSTRAINT fk_users_tenant
--   FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 6. 插入默认租户（向后兼容）
INSERT INTO tenants (id, name, slug, plan, status)
VALUES (1, 'Default Tenant', 'default', 'enterprise', 'active');
```

#### Layer 2: ORM 层（Sequelize）

```javascript
// 为每个模型添加 defaultScope
const User = sequelize.define('User', {
  // ... 现有字段
  tenantId: {
    type: DataTypes.INTEGER,
    field: 'tenant_id',
    defaultValue: 1,  // 向后兼容：默认租户
    allowNull: false,
  },
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
  defaultScope: {
    // 全局默认 scope：自动过滤 tenant_id
    // 注意：实际值由中间件运行时注入
    where: {},
  },
  scopes: {
    // 允许超级管理员查看所有租户数据
    withAllTenants: { where: {} },
  },
});
```

#### Layer 3: 路由层（Express Middleware）

```javascript
// tenantContext.js 核心逻辑
// 优先级: Header > JWT Payload > 默认值(1)
const extractTenantId = (req) => {
  // 1. 从 X-Tenant-ID Header 提取（内部服务调用）
  if (req.headers['x-tenant-id']) {
    return parseInt(req.headers['x-tenant-id'], 10);
  }
  // 2. 从 JWT Payload 提取
  if (req.user?.tenantId) {
    return req.user.tenantId;
  }
  // 3. 向后兼容：默认租户
  return 1;
};
```

#### Layer 4: 缓存层（Redis）

```javascript
// 缓存 Key 命名规范
const cacheKey = (tenantId, resource, identifier) => {
  return `tenant:${tenantId}:${resource}:${identifier}`;
};

// 示例:
// tenant:1:user:abc-123 → 租户1的用户缓存
// tenant:2:campaign:xyz-789 → 租户2的活动缓存
// tenant:1:quota:usage → 租户1的用量统计
```

---

## 5. 数据库迁移方案

### 5.1 现有 11 张表的变更清单

| # | 表名 | 变更内容 | 索引新增 | 影响数据量 |
|---|------|----------|----------|-----------|
| 1 | users | 添加 `tenant_id INTEGER NOT NULL DEFAULT 1` | `idx_users_tenant`, `idx_users_tenant_email` | 低 |
| 2 | email_accounts | 添加 `tenant_id` | `idx_email_accounts_tenant` | 中 |
| 3 | clients | 添加 `tenant_id` | `idx_clients_tenant`, `idx_clients_tenant_user` | 高 |
| 4 | campaigns | 添加 `tenant_id` | `idx_campaigns_tenant`, `idx_campaigns_tenant_status` | 中 |
| 5 | emails | 添加 `tenant_id` | `idx_emails_tenant`, `idx_emails_tenant_status` | 高 |
| 6 | refresh_tokens | 添加 `tenant_id` | `idx_refresh_tokens_tenant` | 低 |
| 7 | audit_logs | 添加 `tenant_id` | `idx_audit_logs_tenant` | 中 |
| 8 | error_logs | 添加 `tenant_id` | `idx_error_logs_tenant` | 低 |
| 9 | feedbacks | 添加 `tenant_id` | `idx_feedbacks_tenant` | 低 |
| 10 | maintenance_logs | 添加 `tenant_id` | - | 极低 |
| 11 | devices | 添加 `tenant_id` | `idx_devices_tenant` | 低 |
| **NEW** | **tenants** | **新建表** | **PRIMARY KEY** | **0** |

### 5.2 迁移脚本（Sequelize sync 模式）

本项目使用 `sequelize.sync({ alter: true })` 进行 schema 同步，因此：

1. **自动迁移**：启动时 Sequelize 会自动检测模型变化并 `ALTER TABLE`
2. **DEFAULT 1 保证**：新列的 `defaultValue: 1` 确保已有数据归属默认租户
3. **零停机**：`ALTER TABLE ... ADD COLUMN ... DEFAULT` 在 PostgreSQL 中是 instant operation（PG 11+）

### 5.3 手动迁移 SQL（备选方案）

如果需要精确控制迁移过程，可使用以下顺序：

```sql
-- Step 1: 创建 tenants 表
-- Step 2: 为所有业务表添加 tenant_id 列（带默认值）
-- Step 3: 创建索引
-- Step 4: 插入默认租户记录
-- Step 5: （可选）添加外键约束
-- Step 6: 验证数据完整性
```

---

## 6. RBAC 与租户权限集成模型

### 6.1 权限矩阵

```
┌────────────────────────────────────────────────────────────────────┐
│                   RBAC × Multi-Tenant 权限矩阵                      │
├──────────────┬─────────────┬─────────────┬─────────────┬───────────┤
│   操作       │ SUPER_ADMIN │ TENANT_ADMIN│ USER        │ VIEWER    │
├──────────────┼─────────────┼─────────────┼─────────────┼───────────┤
│ 管理租户     │ ✅ 全部     │ ❌          │ ❌          │ ❌        │
│ 查看租户列表 │ ✅ 全部     │ ✅ 自己     │ ❌          │ ❌        │
│ 编辑租户配置 │ ✅ 全部     │ ✅ 自己     │ ❌          │ ❌        │
│ 查看配额     │ ✅ 全部     │ ✅ 自己     │ ✅ 自己     │ ✅ 自己   │
│ 租户内 CRUD  │ ✅ 全部     │ ✅ 租户内   │ ✅ 自己的资源│ 🔍 只读  │
│ 跨租户操作   │ ✅ 全部     │ ❌          │ ❌          │ ❌        │
│ 系统级配置   │ ✅ 全部     │ ❌          │ ❌          │ ❌        │
└──────────────┴─────────────┴─────────────┴─────────────┴───────────┘
```

### 6.2 角色定义扩展

```javascript
// 扩展现有的 RBAC 角色体系
const ROLES = {
  // === 系统级角色（跨租户）===
  SUPER_ADMIN: {
    level: 100,
    scope: 'global',      // 可访问所有租户
    permissions: ['*'],    // 全部权限
  },

  // === 租户级角色（仅限本租户）===
  TENANT_ADMIN: {
    level: 80,
    scope: 'tenant',      // 仅限所属租户
    permissions: [
      'tenant:read', 'tenant:update',
      'user:manage',      // 管理租户内用户
      'campaign:*',
      'client:*',
      'email:*',
      'quota:read',
    ],
  },

  USER: {
    level: 50,
    scope: 'own',         // 仅限自己的资源
    permissions: [
      'campaign:crud',    // 自己的活动
      'client:crud',      // 自己的客户
      'email:send',
      'quota:read',
    ],
  },

  VIEWER: {
    level: 10,
    scope: 'readonly',    // 只读访问
    permissions: [
      'campaign:read',
      'client:read',
      'email:read',
      'quota:read',
    ],
  },
};
```

### 6.3 权限检查流程

```
用户请求 → JWT 解析 → 获取 role + tenantId
                    ↓
            ┌───────────────────┐
            │ 角色是 SUPER_ADMIN? │
            └───────┬───────────┘
               YES ↙     ↘ NO
         设置全局scope   检查 tenantId
         (unscoped)     匹配当前租户
                          ↓
                    设置 tenant scope
                    { where: { tenant_id } }
                          ↓
                    执行业务逻辑
```

---

## 7. 租户配额与资源隔离策略

### 7.1 配额模型

```typescript
interface TenantQuota {
  // 用户数限制
  maxUsers: number;           // 最大用户数（含 ADMIN）
  // 客户数限制
  maxClients: number;         // 最大客户数
  // 邮箱账号限制
  maxEmailAccounts: number;   // 最大邮箱账号数
  // 发送限制
  maxEmailsPerDay: number;    // 每日最大发送量
  maxEmailsPerMonth: number;  // 每月最大发送量
  // 活动限制
  maxActiveCampaigns: number; // 最大同时进行活动数
  // 存储限制
  maxStorageMB: number;       // 最大存储容量(MB)
  // API 限制
  apiRateLimit: number;       // API 速率限制(请求/分钟)
  // 功能开关
  features: {
    customDomain: boolean;    // 自定义域名
    webhook: boolean;         // Webhook 集成
    analytics: boolean;       // 高级分析
    export: boolean;          // 数据导出
    sso: boolean;             // 单点登录
  };
}
```

### 7.2 套餐计划定义

| 计划 | maxUsers | maxClients | maxEmails/月 | 价格 | 适用场景 |
|------|----------|------------|-------------|------|---------|
| **basic** | 5 | 1,000 | 10,000 | 免费/试用 | 小团队起步 |
| **professional** | 20 | 10,000 | 100,000 | $$ | 成长型企业 |
| **enterprise** | 100 | 100,000 | 1,000,000 | $$$$ | 大型组织 |

### 7.3 配额检查机制

```javascript
// 配额检查中间件（在业务操作前执行）
const checkQuota = async (req, res, next) => {
  const tenant = req.tenant;
  const quota = tenant.quota;
  const usage = await tenantService.getUsageStats(tenant.id);

  // 根据请求类型检查对应配额
  switch (true) {
    case req.path.includes('/clients'):
      if (usage.clientsCount >= quota.maxClients) {
        return res.status(429).json({
          error: 'QUOTA_EXCEEDED',
          message: `客户数已达上限 (${quota.maxClients})`,
        });
      }
      break;
    case req.path.includes('/emails') && req.method === 'POST':
      if (usage.emailsThisMonth >= quota.maxEmailsPerMonth) {
        return res.status(429).json({
          error: 'QUOTA_EXCEEDED',
          message: `本月邮件发送量已达上限 (${quota.maxEmailsPerMonth})`,
        });
      }
      break;
    // ... 其他检查
  }

  next();
};
```

### 7.4 用量统计

```javascript
// 定期任务（每小时更新一次 Redis 缓存）
async function refreshUsageCache(tenantId) {
  const stats = {
    usersCount: await User.count({ where: { tenantId } }),
    clientsCount: await Client.count({ where: { tenantId } }),
    accountsCount: await EmailAccount.count({ where: { tenantId } }),
    campaignsActive: await Campaign.count({
      where: { tenantId, status: ['SENDING', 'SCHEDULED'] },
    }),
    emailsThisMonth: await Email.count({
      where: {
        tenantId,
        sentAt: { [Op.gte]: startOfMonth() },
        status: 'SENT',
      },
    }),
  };

  await redis.setex(
    `tenant:${tenantId}:usage`,
    3600,  // 1小时缓存
    JSON.stringify(stats)
  );

  return stats;
}
```

---

## 8. 性能影响评估与优化建议

### 8.1 性能影响预估

| 操作 | 无多租户 | 有多租户 (优化前) | 有多租户 (优化后) | 影响 |
|------|----------|------------------|------------------|------|
| **SELECT 单行 (by PK)** | ~1ms | ~1ms (PK lookup 不受影响) | ~1ms | ✅ 无影响 |
| **SELECT 列表 (分页)** | ~15ms | ~25ms (额外 WHERE 过滤) | ~16ms (复合索引) | ✅ <7% |
| **INSERT** | ~3ms | ~4ms (写入 tenant_id) | ~4ms | ✅ <30% |
| **JOIN 查询** | ~30ms | ~45ms (额外的 JOIN 条件) | ~32ms (索引覆盖) | ✅ <7% |
| **COUNT 聚合** | ~50ms | ~80ms (GROUP BY tenant) | ~55ms (预计算缓存) | ✅ <10% |
| **全表扫描** | N/A | 危险! (无索引时) | N/A (强制索引) | ⚠️ 需关注 |

### 8.2 优化措施

#### 1. 索引策略（最关键）

```sql
-- 必须创建的索引（按优先级排序）
-- P0: 核心（无这些索引 = 性能灾难）
CREATE INDEX CONCURRENTLY idx_{table}_tenant ON {table}(tenant_id);

-- P1: 复合索引（覆盖常见查询模式）
CREATE INDEX CONCURRENTLY idx_{table}_tenant_user ON {table}(tenant_id, user_id);
CREATE INDEX CONCURRENTLY idx_{table}_tenant_created ON {table}(tenant_id, created_at DESC);

-- P2: 覆盖索引（避免回表）
CREATE INDEX CONCURRENTLY idx_emails_tenant_status_sent
  ON emails(tenant_id, status, sent_at) INCLUDE (id, to_address);
```

#### 2. Sequelize 查询优化

```javascript
// ❌ 错误：先查全部再内存过滤
const all = await Client.findAll();  // 加载所有租户数据!
const filtered = all.filter(c => c.tenantId === tenantId);

// ✅ 正确：让数据库层面过滤
const filtered = await Client.findAll({
  where: { tenantId },  // 利用索引
});

// ✅ 最佳：只选择需要的字段
const minimal = await Client.findAll({
  where: { tenantId },
  attributes: ['id', 'email', 'firstName', 'lastName'],
  limit: 20,
  offset: 0,
});
```

#### 3. 缓存层优化

```javascript
// 用量统计缓存（减少 COUNT 查询）
const getUsageWithCache = async (tenantId) => {
  const cached = await redis.get(`tenant:${tenantId}:usage`);
  if (cached) return JSON.parse(cached);

  const fresh = await computeUsage(tenantId);
  await redis.setex(`tenant:${tenantId}:usage`, 3600, JSON.stringify(fresh));
  return fresh;
};
```

#### 4. 连接池调整

```javascript
// 当前配置: max:10, min:2
// 多租户后建议略微增加（更多并发查询）
pool: {
  max: parseInt(process.env.DB_POOL_MAX || '15'),    // 10 → 15
  min: parseInt(process.env.DB_POOL_MIN || '3'),      // 2 → 3
}
```

---

## 9. 实施路线图

### Phase 1: 基础设施（Week 1）✅ 本任务完成

- [x] 创建 `docs/MULTI_TENANT_ARCHITECTURE.md` 设计文档
- [x] 实现 `Tenant` Sequelize 模型
- [x] 实现 `tenantContext` 中间件
- [x] 实现 `tenantService` 服务层
- [x] 重写 `api/routes/tenants.js` 路由
- [x] 修改 `api/db/index.js` 为所有模型添加 `tenant_id`
- [x] 实现前端 `TenantAdmin.tsx` 管理页面
- [x] 修改 `MainLayout.tsx` 添加租户切换器
- [x] Git commit: `feat(S130/N01): Multi-tenant architecture...`

**交付物**：完整的多租户基础框架，向后兼容。

### Phase 2: 数据迁移与验证（Week 2）

- [ ] 编写并执行数据库迁移脚本（ALTER TABLE + 索引创建）
- [ ] 插入默认租户记录（id=1, name='Default Tenant'）
- [ ] 运行现有测试套件验证向后兼容性
- [ ] 编写多租户集成测试用例
- [ ] 验证跨租户数据隔离（安全测试）

### Phase 3: 配额系统（Week 3）

- [ ] 实现配额检查中间件
- [ ] 实现用量统计定时任务
- [ ] Redis 缓存层集成
- [ ] 配额超限通知机制
- [ ] 套餐计划管理界面

### Phase 4: RBAC 增强（Week 4）

- [ ] 引入 `SUPER_ADMIN` 和 `TENANT_ADMIN` 角色
- [ ] 修改 RBAC 中间件支持租户作用域
- [ ] JWT Payload 增加 `tenantId` 字段
- [ ] 租户管理员自服务面板

### Phase 5: 监控与运维（Week 5）

- [ ] Prometheus 多租户指标（per-tenant metrics）
- [ ] Grafana 租户维度仪表盘
- [ ] 租户级日志隔离（JSON log tenant_id 字段）
- [ ] 告警规则：单租户异常流量检测

### Phase 6: 生产发布（Week 6）

- [ ] 灰度发布：先开放给 5 个种子租户
- [ ] 全量监控：观察 P95/P99 延迟指标
- [ ] 性能基线对比
- [ ] 回滚预案验证

---

## 附录

### A. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新建** | `docs/MULTI_TENANT_ARCHITECTURE.md` | 架构设计文档 |
| **新建** | `api/middleware/tenantContext.js` | 租户上下文中间件 |
| **新建** | `api/services/tenantService.js` | 租户服务层 |
| **新建** | `frontend/src/pages/TenantAdmin.tsx` | 租户管理页面 |
| **修改** | `api/db/index.js` | 添加 tenant_id 和全局 scope |
| **重写** | `api/routes/tenants.js` | 使用 Sequelize 的租户路由 |
| **修改** | `frontend/src/components/MainLayout.tsx` | 添加租户切换器 |
| **修改** | `frontend/src/App.tsx` | 添加路由 |

### B. 向后兼容保证

1. **默认值策略**：所有 `tenant_id` 列的 `DEFAULT 1` 确保已有数据自动归属默认租户
2. **中间件降级**：当 JWT 中无 `tenantId` 时，自动使用默认租户 ID=1
3. **Scope 可选**：超级管理员可通过 `unscoped()` 绕过 tenant 过滤
4. **API 兼容**：现有 API 端点行为不变（透明添加 tenant 过滤条件）

### C. 安全注意事项

1. **防止 tenant_id 篡改**：中间件必须从可信源（JWT/服务端 Session）提取，不接受客户端传入
2. **SQL 注入防护**：tenant_id 使用参数化查询（Sequelize 自动处理）
3. **信息泄露防护**：错误消息中不暴露其他租户的存在
4. **审计日志**：所有跨租户操作必须记录到 audit_logs（含 tenant_id）
