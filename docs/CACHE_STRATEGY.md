# GlobalReach V2.0 Redis 缓存策略 (Cache Strategy)

> 版本: 1.0.0
> 最后更新: 2026-06-09 (S133/DEBT-024)
> 缓存层: Redis 7.4.9
> 封装: api/services/cacheService.js
> 技术债务编号: DEBT-024

## 1. 架构概览

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│   API Layer │────▶│ cacheService │────▶│   Redis   │
│ (routes/    │     │ (Redis       │     │ 7.4.9    │
│  services)  │     │  Wrapper)    │     │          │
│  middleware)│     │              │     │ 128MB    │
└─────────────┘     └──────────────┘     └──────────┘
                           │
                    ┌──────┴──────┐
                    │ TTL Policy  │
                    │ Key Naming  │
                    │ Invalidation│
                    │ Monitoring  │
                    └─────────────┘
```

### 1.1 调用关系图

```
api/server.js
  ├── 初始化 cacheService.connect()
  └── 注入 app.set('cacheService', cacheService)
        │
        ├── api/routes/stats.js           → stats:overview:{userId}
        ├── api/middleware/tenantContext.js → tenant:{tenantId}:info
        └── api/services/tenantService.js   → tenant:{tenantId}:usage
                                            → tenant:{tenantId}:info

api/services/cacheService.js (内置 Key 生成器)
  ├── stats:{userId}:{statType}            → getCachedStats/setCachedStats
  ├── dashboard:{userId}                   → getCachedDashboard/setCachedDashboard
  └── campaign:{campaignId}                → getCampaignKey
```

### 1.2 当前配置摘要

| 配置项 | 值 | 来源 |
|--------|-----|------|
| Redis 版本 | 7.4.9-alpine | docker-compose.prod.yml |
| maxmemory | **128mb** | docker-compose.prod.yml 第35行 |
| maxmemory-policy | **allkeys-lru** | docker-compose.prod.yml 第35行 |
| 认证方式 | requirepass (REDIS_PASSWORD 环境变量) | DEBT-002 已修复 |
| 默认 TTL | 300s (5分钟) | cacheService.js 第7行 |
| 连接超时 | 3000ms | cacheService.js 第44行 |

---

## 2. Cache Key 命名规范 (Naming Convention)

### 2.1 格式规则

```
{prefix}:{entityId}:{suffix}
```

> **注意**: 当前实现中 key 命名**未包含 tenantId 前缀**（DEBT-016 多租户隔离问题）。
> 以下为当前实际使用的格式 + 推荐的改进格式。

### 2.2 各模块 Key 设计（基于实际代码审计）

#### 2.2.1 用户统计 Dashboard (stats.js)

| 属性 | 值 |
|------|-----|
| **实际格式** | `stats:overview:{userId}` |
| **代码位置** | api/routes/stats.js 第15行 |
| **TTL** | 120s (2分钟) |
| **示例** | `stats:overview:42` |
| **写入时机** | DB 查询完成后回填缓存 |
| **读取时机** | 请求进入时优先读缓存 |

```javascript
// api/routes/stats.js 第15行
const cacheKey = `stats:overview:${userId}`;
const cachedData = await cacheService.get(cacheKey);
// ... DB 查询 ...
await cacheService.set(cacheKey, resultData, 120); // TTL=120s
```

#### 2.2.2 租户信息 (tenantContext 中间件)

| 属性 | 值 |
|------|-----|
| **实际格式** | `tenant:{tenantId}:info` |
| **代码位置** | api/middleware/tenantContext.js 第67行、第107行 |
| **TTL** | 300s (5分钟) |
| **示例** | `tenant:1:info` |
| **失效策略** | Time-based (TTL 自动过期) |
| **备注** | 每次请求经过中间件时读取；DB 未命中时回填 |

```javascript
// api/middleware/tenantContext.js 第67行
const cacheKey = `tenant:${tenantId}:info`;
const cached = await req.app.get('cacheService').get(cacheKey);
// ... DB findByPk ...
await req.app.get('cacheService').setex(cacheKey, 300, JSON.stringify(tenant));
```

#### 2.2.3 租户用量统计 (tenantService)

| 属性 | 值 |
|------|-----|
| **实际格式** | `tenant:{tenantId}:usage` |
| **代码位置** | api/services/tenantService.js 第344行 |
| **TTL** | 3600s (1小时) |
| **示例** | `tenant:1:usage` |
| **写入时机** | DB 聚合查询完成后 |
| **支持强制刷新** | forceRefresh=true 时跳过缓存 |

```javascript
// api/services/tenantService.js 第344行
const cacheKey = `tenant:${tenantId}:usage`;
const cached = await cacheService.get(cacheKey);
// ... 并行 count 查询 ...
await cacheService.setex(cacheKey, 3600, JSON.stringify(stats));
```

#### 2.2.4 内置 Key 生成器 (cacheService.js)

| 方法 | Key 格式 | 默认 TTL | 用途 |
|------|----------|----------|------|
| `getStatsKey(userId, statType)` | `stats:{userId}:{statType}` | 60s | 用户统计数据 |
| `getDashboardKey(userId)` | `dashboard:{userId}` | 120s | 用户仪表盘 |
| `getCampaignKey(campaignId)` | `campaign:{campaignId}` | 300s (default) | Campaign 数据 |

```javascript
// api/services/cacheService.js 第126-136行
getStatsKey(userId, statType) {
  return `stats:${userId}:${statType}`;         // e.g. "stats:42:today"
}
getDashboardKey(userId) {
  return `dashboard:${userId}`;                  // e.g. "dashboard:42"
}
getCampaignKey(campaignId) {
  return `campaign:${campaignId}`;               // e.g. "campaign:10086"
}
```

#### 2.2.5 用户缓存批量失效

| 属性 | 值 |
|------|-----|
| **涉及 Key** | `dashboard:{userId}`, `stats:{userId}:today`, `stats:{userId}:weekly`, `stats:{userId}:monthly` |
| **代码位置** | api/services/cacheService.js 第158-166行 |
| **触发场景** | 用户数据变更后主动清除 |

```javascript
// api/services/cacheService.js 第158-166行
invalidateUserCache(userId) {
  const keys = [
    this.getDashboardKey(userId),
    this.getStatsKey(userId, 'today'),
    this.getStatsKey(userId, 'weekly'),
    this.getStatsKey(userId, 'monthly'),
  ];
  return Promise.all(keys.map(key => this.del(key)));
}
```

#### 2.2.6 租户缓存批量失效

| 属性 | 值 |
|------|-----|
| **涉及 Key** | `tenant:{tenantId}:info`, `tenant:{tenantId}:usage` |
| **代码位置** | api/services/tenantService.js 第450-463行 |
| **触发场景** | 租户信息/配额变更后主动清除 |

```javascript
// api/services/tenantService.js 第456-458行
await Promise.all([
  cacheService.del(`tenant:${tenantId}:info`),
  cacheService.del(`tenant:${tenantId}:usage`),
]);
```

### 2.3 Collision Risk & Mitigation

| 风险点 | 当前状态 | 风险等级 | 缓解措施 |
|--------|---------|---------|---------|
| userId 与 tenantId 数值冲突 | `stats:` vs `tenant:` prefix 不同 | 🟢 低 | 前缀隔离 |
| statType 值冲突 ("today"/"weekly"/"monthly") | 固定枚举值 | 🟢 低 | 限定范围 |
| 缺少 tenantId 隔离前缀 | 多租户下 userId 可能重复 | 🔴 **高** | **需修复 (DEBT-016)** |
| Key 最大长度 | 当前最长约 30 字符 | 🟢 低 | 远低于 Redis 250B 限制 |
| 冒号分隔符一致性 | 全部使用 `:` 分隔 | 🟢 低 | 统一格式 |

### 2.4 推荐的统一命名规范（未来改进）

```
{prefix}:{tenantId}:{entityType}:{entityId}:{suffix}
```

| 组成部分 | 说明 | 示例 |
|----------|------|------|
| prefix | 服务/模块标识 | `session`, `stats`, `tenant`, `campaign`, `rate` |
| tenantId | 租户ID (多租户隔离) | `t001`, `1`, `default` |
| entityType | 实体类型 | `user`, `campaign`, `dashboard`, `account` |
| entityId | 实体唯一ID | `12345`, `current`, `overview` |
| suffix | 变体标识 | `profile`, `list`, `count`, `info`, `usage` |

---

## 3. TTL 策略矩阵 (TTL Strategy Matrix)

### 3.1 当前实际 TTL 配置

| 数据类别 | Key Pattern | 实际 TTL | 代码位置 | 访问频率 | 理由 |
|----------|------------|----------|----------|---------|------|
| Dashboard Overview | `stats:overview:{userId}` | **120s** | stats.js:119 | 高 (每次进Dashboard) | 聚合查询代价高，2分钟可接受延迟 |
| Tenant Info | `tenant:{tenantId}:info` | **300s** | tenantContext.js:109 | **极高** (每次API请求) | 租户信息低频变更，5分钟够用 |
| User Stats | `stats:{userId}:{statType}` | **60s** | cacheService.js:145 | 高 | 统计数据近实时需求 |
| User Dashboard | `dashboard:{userId}` | **120s** | cacheService.js:155 | 高 | 同Overview |
| Tenant Usage | `tenant:{tenantId}:usage` | **3600s** | tenantService.js:404 | 中 (管理面板) | 用量统计按小时粒度足够 |
| Campaign Data | `campaign:{campaignId}` | **300s** (default) | cacheService.js:77 | 中 | 默认TTL回退值 |
| Rate Limiting Counter | `rate:*:*:*` | 动态 (匹配窗口) | N/A (未用Redis) | 极高 | 匹配限流窗口 15s/60s/900s |

### 3.2 TTL 选择原则

```
┌─────────────────────────────────────────────────────────────────┐
│                     TTL 选择决策树                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  数据访问频率?                                                   │
│    ├── >100 QPS (热点)  → TTL 30s ~ 2min                       │
│    │   └── 例: tenant info (每次请求), dashboard overview        │
│    │                                                          │
│    ├── 10~100 QPS (温热) → TTL 2min ~ 10min                   │
│    │   └── 例: user stats, campaign data                        │
│    │                                                          │
│    ├── <10 QPS (冷)      → TTL 10min ~ 1h                     │
│    │   └── 例: tenant usage stats                              │
│    │                                                          │
│    └── <1 QPS (极冷)     → TTL 1h ~ 24h                       │
│        └── 例: email template, system config                   │
│                                                                 │
│  数据新鲜度要求?                                                 │
│    ├── 近实时 (<5s)    → 不缓存 或 TTL<30s + stale-while-reval  │
│    ├── 准实时 (30s~5min)→ 当前大多数场景                         │
│    └── 最终一致 (>5min) → 长 TTL + 主动失效                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 禁止事项

- ❌ **永不失效的 key**: 所有 key 必须设 TTL，防止内存泄漏
- ❌ **TTL=0 的 set 操作**: cacheService.set() 允许 ttl=0（无过期），生产环境应禁止
- ⚠️ **当前 defaultTTL=300s 作为兜底**: 新增缓存调用应显式指定 TTL

### 3.4 推荐 TTL 参考表（新增缓存时使用）

| 场景 | 推荐 TTL | 说明 |
|------|---------|------|
| 会话/Token 元数据 | 24h | 匹配 JWT_EXPIRES_IN |
| 用户 Profile | 1h | 低频变更 |
| 权限/角色 | 30min | 安全敏感，较短TTL |
| Campaign 列表 | 5min | 高频访问热数据 |
| Campaign 详情 | 5min | 单个Campaign数据 |
| Email Account Pool | 30s | 共享状态高频变动 |
| Email Template | 1h | 极低频变更 |
| 系统 Config | 10min | 管理操作时主动失效 |
| 限流计数器 | 动态 | 匹配限流窗口 |
| 公共配置/字典 | 1h | 极少变动 |

---

## 4. 失效策略 (Invalidation Strategy)

### 4.1 当前实现的失效模式

#### 4.1.1 Time-based (TTL 自动过期) — 主要模式

当前**绝大多数**缓存依赖 TTL 自动过期，无主动失效逻辑：

| Key Pattern | TTL | 失效方式 |
|------------|-----|---------|
| `stats:overview:{userId}` | 120s | 到期自动删除 |
| `tenant:{tenantId}:info` | 300s | 到期自动删除 |
| `stats:{userId}:{statType}` | 60s | 到期自动删除 |
| `dashboard:{userId}` | 120s | 到期自动删除 |
| `tenant:{tenantId}:usage` | 3600s | 到期自动删除 |

#### 4.1.2 Active Invalidation (主动删除) — 少量使用

仅在数据变更时显式调用 del():

**用户级缓存清理** (`invalidateUserCache`):
```
触发条件: 用户相关数据变更
清理目标: dashboard:{userId} + stats:{userId}:{today|weekly|monthly}
```

**租户级缓存清理** (`invalidateCache` in tenantService):
```
触发条件: 租户信息/配额变更
清理目标: tenant:{tenantId}:info + tenant:{tenantId}:usage
```

### 4.2 策略选择矩阵

| 场景 | 当前策略 | 推荐策略 | 实现优先级 |
|------|---------|---------|-----------|
| 用户资料更新 | ❌ 无 (依赖TTL) | Write-through (更新DB后同步DEL) | P1 |
| Campaign状态变更 | ❌ 无 (依赖TTL) | Active invalidation (DEL pattern) | P1 |
| 统计数据聚合 | ✅ Time-based (TTL) | 保持现状 + 可选缩短TTL | P0 (OK) |
| 批量导入完成 | ❌ 无 | Active invalidation (SCAN+DEL) | P2 |
| 租户信息变更 | ✅ Active DEL | 保持现状 | P0 (OK) |
| 邮件发送完成 | ❌ 无 | Pub/Sub (Keyspace Notification) | P2 |

### 4.3 Cache Stampede 击穿保护

> **当前状态**: cacheService.js **未实现**任何 stampede 保护机制。
> 当高并发请求同时遇到缓存 miss 时，会全部穿透到数据库。

#### 4.3.1 问题场景

```
时间线:
  t0: tenant:{1}:info 过期 (TTL=300s)
  t1: 请求A到达 → cache miss → 查询DB (耗时50ms)
  t2: 请求B到达 → cache miss → 查询DB (耗时50ms) ← 重复查询!
  t3: 请求C到达 → cache miss → 查询DB (耗时50ms) ← 重复查询!
  ... N个请求全部穿透DB
```

#### 4.3.2 推荐方案: Stale-While-Revalidate

```javascript
/**
 * 带击穿保护的缓存读取 (推荐实现)
 *
 * 策略:
 *   1. 尝试获取 fresh value → 命中则返回
 *   2. 尝试获取 stale value → 命中则立即返回，后台异步刷新
 *   3. 完全未命中 → 同步获取并存储 (fresh + stale backup)
 */
async function getWithStampedeProtection(key, fetchFn, ttl, options = {}) {
  const { staleWhileRevalidate = Math.floor(ttl * 0.2) } = options;
  const start = Date.now();

  // 1. Try fresh value
  let value = await redis.get(key);
  if (value) {
    log.debug(`Cache HIT key=${key} duration=${Date.now()-start}ms`);
    return JSON.parse(value);
  }

  // 2. Check stale backup (stale-while-revalidate)
  const staleKey = `${key}:stale`;
  const stale = await redis.get(staleKey);
  if (stale) {
    // Return stale immediately, revalidate in background
    log.debug(`Cache STALE-HIT key=${key}, refreshing in background`);
    setImmediate(() => refreshInBackground(key, fetchFn, ttl, staleKey, staleWhileRevalidate));
    return JSON.parse(stale);
  }

  // 3. Cold cache - fetch from source
  log.debug(`Cache MISS key=${key}, fetching from source`);
  value = await fetchFn();

  // Store both fresh and stale
  const serialized = JSON.stringify(value);
  await redis.setex(key, ttl, serialized);                          // Fresh: TTL
  await redis.setex(staleKey, ttl + staleWhileRevalidate, serialized); // Stale: TTL + buffer

  log.debug(`Cache STORE key=${key} ttl=${ttl} duration=${Date.now()-start}ms`);
  return value;
}

async function refreshInBackground(key, fetchFn, ttl, staleKey, swr) {
  try {
    const value = await fetchFn();
    const serialized = JSON.stringify(value);
    await redis.setex(key, ttl, serialized);
    await redis.setex(staleKey, ttl + swr, serialized);
  } catch (err) {
    log.warn(`Background refresh failed key=${key} error=${err.message}`);
  }
}
```

#### 4.3.3 备选方案: Mutex Lock (分布式锁)

对于必须强一致性的场景（如限流计数器）：

```javascript
async function getWithLock(key, fetchFn, ttl, lockTimeout = 5000) {
  const value = await redis.get(key);
  if (value) return JSON.parse(value);

  const lockKey = `${key}:lock`;
  const acquired = await redis.set(lockKey, '1', { NX, EX: lockTimeout / 1000 });

  if (acquired) {
    try {
      const data = await fetchFn();
      await redis.setex(key, ttl, JSON.stringify(data));
      return data;
    } finally {
      await redis.del(lockKey);
    }
  } else {
    // Another request is fetching; wait briefly then retry
    await new Promise(r => setTimeout(r, 50));
    const retryValue = await redis.get(key);
    return retryValue ? JSON.parse(retryValue) : await fetchFn();
  }
}
```

### 4.4 批量失效工具函数

> **当前状态**: cacheService.js **缺少** pattern-based 批量失效能力。
> `invalidateUserCache()` 和 `invalidateCache()` 只能精确匹配已知 key。

```javascript
/**
 * 基于 SCAN 模式的批量缓存失效
 * ⚠️ 生产环境禁用 KEYS *，必须使用 SCAN
 *
 * @param {string} pattern - glob 模式, 如 "tenant:1:*"
 * @param {number} [batchSize=100] - 每次 SCAN 返回数量
 * @returns {Promise<number>} 删除的 key 数量
 */
async function invalidatePattern(pattern, batchSize = 100) {
  const start = Date.now();
  let cursor = '0';
  let totalDeleted = 0;

  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
    cursor = result[0];
    const keys = result[1];

    if (keys.length > 0) {
      await redis.del(...keys);
      totalDeleted += keys.length;
    }
  } while (cursor !== '0');

  log.debug(`Cache INVALIDATE_PATTERN pattern=${pattern} deleted=${totalDeleted} duration=${Date.now()-start}ms`);
  return totalDeleted;
}

// 使用示例:
// await invalidatePattern('tenant:1:*');        // 清除租户1所有缓存
// await invalidatePattern('stats:42:*');         // 清除用户42所有统计缓存
// await invalidatePattern('dashboard:*');        // 清除所有dashboard缓存
```

---

## 5. 监控 (Monitoring)

### 5.1 当前状态

> **严重不足**: cacheService.js 当前仅有 `console.error/warn` 错误日志，
> **完全没有** hit/miss 计数、延迟指标、内存监控等可观测性能力。

### 5.2 核心 Metrics 定义

| Metric 名称 | 类型 | PromQL 类型 | 描述 | 告警阈值 |
|-------------|------|------------|------|---------|
| `globalreach_cache_ops_total` | Counter | counter | 缓存操作总数 (分 result="hit"\|"miss"\|"set"\|"del") | - |
| `globalreach_cache_hit_ratio` | Gauge | gauge | 缓存命中率 (5m滚动窗口) | <80% WARN, <70% CRIT |
| `globalreach_cache_latency_ms` | Histogram | histogram | 缓存操作延迟分布 | P99 > 10ms WARN |
| `globalreach_cache_memory_bytes` | Gauge | gauge | Redis 已用内存 (from INFO) | >80% maxmemory WARN |
| `globalreach_cache_keys_total` | Gauge | gauge | Redis key 总数 (dbsize) | 异常增长告警 |
| `globalreach_cache_evictions_total` | Counter | counter | LRU 淘汰次数 | >0 即关注 |

### 5.3 Prometheus Recording Rules

```yaml
# 文件路径: prometheus/rules/cache_rules.yml
groups:
  - name: cache_metrics
    interval: 60s
    rules:
      # 缓存命中率计算 (5分钟滚动窗口)
      - record: globalreach_cache_hit_ratio
        expr: >
          sum(rate(globalreach_cache_ops_total{result="hit"}[5m]))
          /
          sum(rate(globalreach_cache_ops_total[5m]))

      # 每秒操作数
      - record: globalreach_cache_ops_per_second
        expr: >
          sum(rate(globalreach_cache_ops_total[5m]))
          by (operation)

      # 内存使用率 (相对于 maxmemory 128MB)
      - record: globalreach_cache_memory_usage_ratio
        expr: >
          globalreach_cache_memory_bytes
          /
          (128 * 1024 * 1024)
```

### 5.4 Prometheus Alert Rules

```yaml
# 文件路径: prometheus/rules/cache_alerts.yml
groups:
  - name: cache_alerts
    rules:
      # 命中率过低警告
      - alert: CacheHitRatioLow
        expr: globalreach_cache_hit_ratio < 0.8
        for: 15m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Cache hit ratio below 80% (current: {{ $value | humanizePercentage }})"
          description: >
            Cache hit ratio has been below 80% for 15 minutes.
            Current value: {{ $value | humanizePercentage }}.
            Target: >90%. Check for TTL misconfiguration or cache busting.
          runbook_url: "https://docs.globalreach.internal/runbooks/rb-003-redis"

      # 命中率严重过低
      - alert: CacheHitRatioCritical
        expr: globalreach_cache_hit_ratio < 0.7
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "CRITICAL: Cache hit ratio below 70%"
          description: >
            Immediate action required. Hit ratio at {{ $value | humanizePercentage }}.
            Investigate potential cache flooding or Redis connectivity issues.

      # Redis 内存使用过高
      - alert: RedisMemoryHigh
        expr: globalreach_cache_memory_usage_ratio > 0.8
        for: 10m
        labels:
          severity: warning
          team: infra
        annotations:
          summary: "Redis memory usage above 80% of maxmemory (128MB)"
          description: >
            Redis is using {{ $value | humanizePercentage }} of configured maxmemory.
            Consider increasing maxmemory or reviewing TTL policies.
            Run: redis-cli --hotkeys to find large keys.

      # Redis 内存接近上限
      - alert: RedisMemoryCritical
        expr: globalreach_cache_memory_usage_ratio > 0.9
        for: 5m
        labels:
          severity: critical
          team: infra
        annotations:
          summary: "CRITICAL: Redis memory usage above 90%"
          description: >
            Redis at {{ $value | humanizePercentage }} capacity.
            Immediate risk of eviction storm. Scale up maxmemory ASAP.

      # LRU 淘汰异常增加
      - alert: CacheEvictionSpike
        expr: increase(globalreach_cache_evictions_total[15m]) > 100
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "High cache eviction rate detected"
          description: >
            {{ $value }} evictions in last 15min.
            Review TTL settings and consider increasing maxmemory.
```

### 5.5 Grafana 面板建议

```
Dashboard: GlobalReach - Cache Monitoring
==========================================

Row 1: 核心概览 (KPI Cards)
┌─────────────────┬─────────────────┬─────────────────┐
│  Hit Ratio %    │  Memory Used    │  Total Keys     │
│  (Gauge, 目标>90%)│ (Gauge, /128MB)│  (Stat)         │
│  🟢 94.2%       │  🟡 78.3 MB     │  12,847         │
└─────────────────┴─────────────────┴─────────────────┘

Row 2: 操作趋势 (Time Series, Area Chart)
┌──────────────────────────────────────────────────┐
│  Ops/sec Trend (stacked area)                    │
│  ├─ hit  ████████████████████ (绿色)             │
│  ├─ miss ████ (红色)                             │
│  └─ set  ██ (蓝色)                               │
│  X: 时间  Y: ops/sec                            │
└──────────────────────────────────────────────────┘

Row 3: 延迟分布 (Heatmap / Percentile Lines)
┌──────────────────────────────────────────────────┐
│  Cache Latency                                   │
│  P50: 0.8ms  P95: 3.2ms  P99: 8.7ms             │
│  (阈值线: P99 > 10ms = WARN)                     │
└──────────────────────────────────────────────────┘

Row 4: Miss Rate by Key Prefix (Pie Chart)
┌─────────────────┬─────────────────┐
│  tenant:*  45%  │  stats:*   35%  │
│  dashboard:* 15%│  campaign:* 5%  │
└─────────────────┴─────────────────┘

Row 5: 内存 & 淘汰趋势 (Dual Axis)
┌──────────────────────────────────────────────────┐
│  ┃ Memory (MB)  ━━━━ Evictions/sec               │
│  ┃ 78MB                                          │
│  ┃     ╲     _  2                                │
│  ┃ 65MB  ╲   / \                                 │
│  ┃       ╲_/   ╲_  0                             │
│  ┃ 50MB                                           │
└──────────────────────────────────────────────────┘
```

### 5.6 cacheService.js 嵌入式 Metrics 收集建议

```javascript
// 在 cacheService.js 中添加嵌入式 metrics 收集
class CacheService {
  constructor() {
    // ... existing props ...
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  async get(key) {
    const start = Date.now();
    // ... existing logic ...
    if (value !== null) {
      this.metrics.hits++;
      this._logDebug('get', key, 'hit', Date.now() - start);
      return parsed;
    }
    this.metrics.misses++;
    this._logDebug('get', key, 'miss', Date.now() - start);
    return null;
  }

  // Expose metrics for /metrics endpoint
  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      hitRatio: total > 0 ? (this.metrics.hits / total).toFixed(4) : 'N/A',
      totalOps: total + this.metrics.sets + this.metrics.deletes,
    };
  }

  _logDebug(operation, key, result, duration) {
    // 使用 DEBUG level，生产环境默认不输出
    // 可通过 LOG_LEVEL=debug 开启
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(
        `[CacheService] ${operation.toUpperCase()} ` +
        `key=${key} result=${result} duration=${duration}ms`
      );
    }
  }
}
```

---

## 6. 内存管理 (Memory Management)

### 6.1 当前配置

```yaml
# docker-compose.prod.yml 第35行 (redis service)
command: >
  redis-server
  --requirepass ${REDIS_PASSWORD}
  --maxmemory 128mb
  --maxmemory-policy allkeys-lru
```

| 参数 | 值 | 说明 |
|------|-----|------|
| maxmemory | **128mb** | Redis 最大可用内存 |
| maxmemory-policy | **allkeys-lru** | 内存满时淘汰最久未访问的 key (所有key都有TTL) |
| 持久化 | **未配置** | 无 RDB/AOF，纯内存缓存 (容器重启丢失) |

### 6.2 allkeys-lru 策略说明

```
淘汰算法工作流程:

  Redis 内存使用达到 128MB
       ↓
  触发 eviction cycle
       ↓
  从所有 key 中选取 lru (Least Recently Used) 候选
       ↓
  淘汰候选 key (释放内存)
       ↓
  继续服务新请求

⚠️ 关键影响:
  - 最久未被访问的 key 优先被淘汰 (即使 TTL 未到)
  - 热点 key (如 tenant:*, stats:overview:*) 因频繁访问而受保护
  - 冷门 key 即使 TTL 很长也会被提前淘汰
  - eviction 会导致命中率的"假下降" (非真正的 miss)
```

### 6.3 内存预警线

| 级别 | 阈值 (相对 128MB) | 绝对值 | 动作 |
|------|-------------------|--------|------|
| 🟢 GREEN | < 50% | < 64 MB | 正常运行 |
| 🟡 YELLOW | 50% - 75% | 64 - 96 MB | 观察，检查大 key |
| 🟠 ORANGE | 75% - 90% | 96 - 115 MB | 主动审查低优先级缓存 TTL |
| 🔴 RED | > 90% | > 115 MB | **告警** + 评估扩容至 256MB |

### 6.4 大 Key 诊断命令

```bash
# 登录 Redis CLI (在 Docker 容器内)
docker exec -it globalreach-redis redis-cli -a ${REDIS_PASSWORD}

# 查看 memory 使用概况
INFO memory

# 扫描 Top-10 大 Key (Redis 4.0+, 使用 --bigkeys)
redis-cli --bigkeys -i 0.1

# 按 prefix 统计 key 数量和内存
# (需要自行脚本或使用 redis-memory-for-key 工具)

# 查看特定 key 的内存占用
MEMORY USAGE stats:overview:42
MEMORY USAGE tenant:1:info
```

### 6.5 内存估算模型

基于当前 key 设计的预估内存占用：

| Key Pattern | 单条大小估算 | 预估数量 | 小计 |
|-------------|------------|---------|------|
| `stats:overview:{userId}` (~100用户) | ~2KB | 100 | ~200KB |
| `tenant:{tenantId}:info` (~10租户) | ~0.5KB | 10 | ~5KB |
| `tenant:{tenantId}:usage` (~10租户) | ~1KB | 10 | ~10KB |
| `dashboard:{userId}` (~100用户) | ~1.5KB | 100 | ~150KB |
| `stats:{userId}:{statType}` (×3类型) | ~1KB | 300 | ~300KB |
| `campaign:{campaignId}` (~50活动) | ~3KB | 50 | ~150KB |
| **合计 (基础负载)** | | | **~815KB** |
| Redis 自身开销 (~20%) | | | ~163KB |
| **总计** | | | **~1MB** |

> **结论**: 当前 128MB 限制对现有缓存负载**非常充裕** (利用率 <1%)。
> 但随着业务增长和新增缓存场景，需持续监控。

### 6.6 扩容评估标准

当满足以下任一条件时考虑扩容：

- [ ] 内存使用持续 > 75% (96MB)
- [ ] eviction 次数 > 10/min (说明容量不足)
- [ ] 新增大对象缓存需求 (如邮件模板、报告快照 >10KB/条)
- [ ] 新增多租户部署 (每租户增加 ~2-5KB 基础开销)

**推荐扩容路径**: 128mb → 256mb → 512mb

---

## 7. 最佳实践与禁忌

### DO ✅ 必须遵守

- [x] **所有 key 必须设置 TTL** — 禁止永不过期的 key
- [x] **使用统一的 key naming convention** — 参考 §2.2 各模块设计
- [x] **使用 SCAN 代替 KEYS*** — 生产环境 KEYS * 是 O(N) 阻塞操作
- [x] **敏感数据加密后存储** — 密码/token 不明文存入 Redis
- [x] **监控 hit ratio 和 memory usage** — 参考 §5 监控体系
- [x] **错误降级处理** — Redis 不可用时返回 null/走 DB (当前已实现)
- [x] **连接超时保护** — 当前 3000ms 超时合理
- [x] **序列化异常容错** — JSON.parse 失败时返回原始字符串 (当前已实现)

### DON'T ❌ 严格禁止

- [ ] **永不失效的 key** — 导致内存泄漏，最终 OOM
- [ ] **KEYS *** 命令 — 生产环境绝对禁止 (阻塞 Redis 主线程)
- [ ] **存储超大对象** — 单条 >1MB 应考虑压缩或拆分
- [ ] **忽略缓存一致性** — 写入 DB 后必须考虑缓存何时失效
- [ ] **循环中逐个操作 Redis** — 使用 Pipeline/MSET 批量操作
- [ ] **TTL 设为 0** — cacheService.set(key, val, 0) 会创建永不过期的 key
- [ ] **在 key 中包含不可预测的长随机串** — 增加 hash slot 计算负担

### 代码层面 Checklist

```javascript
// ✅ 正确: 显式指定 TTL
await cacheService.set(cacheKey, data, 120);

// ❌ 错误: 使用默认 TTL (300s) 可能不符合业务语义
await cacheService.set(cacheKey, data);

// ✅ 正确: 缓存读取失败时降级到 DB
const cached = await cacheService.get(key);
if (cached) return cached;
return await dbQuery();  // 降级

// ✅ 正确: 缓存写入失败不影响主流程
try {
  await cacheService.set(key, data, ttl);
} catch (_) {
  // 静默失败，主流程继续
}

// ⚠️ 注意: tenantService 使用了 cacheService.setex() 方法
// 但当前 cacheService.js 实现**没有** setex 方法!
// 应使用 cacheService.set(key, value, ttl) 替代
```

---

## 8. 已知问题与技术债务关联

| 编号 | 描述 | 影响 | 建议 |
|------|------|------|------|
| **DEBT-002** | Redis 认证 | ✅ 已修复 (requirepass) | 保持现状 |
| **DEBT-016** | 多租户 key 隔离缺失 | 🔴 key 无 tenantId 前缀 | 迁移到 `{prefix}:{tenantId}:...` 格式 |
| **DEBT-024** (本文档) | 缓存策略未文档化 | ✅ 本文档解决 | - |
| **Bug** | tenantService 调用不存在的 `setex()` | 🟡 运行时报错 | 改用 `set(key, val, ttl)` |
| **Gap** | 无 hit/miss metrics | 🟡 无法观测命中率 | 添加 Prometheus metrics |
| **Gap** | 无 stampede 保护 | 🟡 高并发可能穿透 | 实现 SWR 或 mutex lock |
| **Gap** | 无 DEBUG 日志 | 🟡 排障困难 | 添加操作日志 (见 §5.6) |
| **Gap** | 无持久化配置 | 🟡 容器重启全丢 | 根据 RTO/RPO 要求决定是否加 AOF |

---

## 9. 与其他文档的协同

| 协同文档 | 关联内容 |
|---------|---------|
| `docs/RB-003_REDIS.md` | Redis 运维 Runbook (重启/故障排查/备份) |
| `docs/CAPACITY_PLANNING_AUTOMATION.md` | 容量规划中的 Redis 分析器 |
| `docs/MULTI_TENANT_ARCHITECTURE.md` | 多租户 key 隔离策略 (DEBT-016) |
| `docs/TECHNICAL_DEBT_REGISTER.md` | 技术债务追踪 (DEBT-024 条目) |
| `docs/TT-003_HIGH_MEMORY_USAGE.md` | 内存高占用故障树 |
| `prometheus/prometheus.yml` | Prometheus 采集配置 (需添加 cache metrics) |
| `docker-compose.prod.yml` | Redis 服务定义 (maxmemory 配置) |

---

## 10. 变更日志

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0.0 | 2026-06-09 | Initial strategy document (S133/DEBT-024) — 基于代码审计完整记录当前 key 命名、TTL 配置、失效策略、监控缺口 | S133 |

---

## 附录 A: 快速参考卡 (Quick Reference)

```
╔══════════════════════════════════════════════════════════╗
║        GlobalReach Cache Strategy — Quick Reference       ║
╠══════════════════════════════════════════════════════════╣
║  Redis: 7.4.9-alpine  |  MaxMem: 128MB  |  Policy: LRU   ║
║                                                          ║
║  Key Patterns (当前):                                     ║
║    stats:overview:{uid}        TTL=120s                  ║
║    tenant:{tid}:info           TTL=300s                  ║
║    tenant:{tid}:usage          TTL=3600s                 ║
║    stats:{uid}:{type}          TTL=60s                   ║
║    dashboard:{uid}             TTL=120s                  ║
║    campaign:{cid}              TTL=300s (default)        ║
║                                                          ║
║  Targets:                                                ║
║    Hit Ratio  > 90%  |  Alert < 80%(W) / < 70%(C)       ║
║    Memory     < 75%  |  Alert > 80%(W) / > 90%(C)       ║
║    Latency P99< 10ms |  Alert > 10ms(W)                 ║
║                                                          ║
║  Commands:                                               ║
║    Diagnose:  docker exec redis redis-cli --bigkeys      ║
║    Memory:    docker exec redis redis-cli INFO memory    ║
║    Flush:     cacheService.flush() (dev only!)          ║
╚══════════════════════════════════════════════════════════╝
```
