# RB-002 PostgreSQL 运行手册

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **组件**: postgres (globalreach-postgres)
> **最后更新**: 2026-06-09

---

## 1. 组件身份卡

| 属性 | 值 |
|------|-----|
| 容器名称 | globalreach-postgres |
| 镜像 | postgres:15-alpine |
| PostgreSQL 版本 | **15** (固定版本，升级需 pg_upgrade 或 dump/restore) |
| 监听端口 | 5432 (仅容器内部网络) |
| 数据库名称 | globalreach_prod (可通过 DB_NAME 覆盖) |
| 默认用户 | globalreach_user (可通过 DB_USER 覆盖) |
| 数据卷 | postgres_data → /var/lib/postgresql/data |
| 健康检查 | `pg_isready -U globalreach_user -d globalreach_prod` (30s间隔, 10s超时, 3次重试) |
| 重启策略 | unless-stopped |
| 网络 | globalreach-network (内部网络，不暴露到宿主机) |

### 安全备注
- gosu 存在 CVE-2025-68121 (LOW-RISK CRITICAL)
- 缓解措施: gosu 仅在容器启动时运行，无网络暴露
- 升级路径: `pg_dumpall > backup.sql` → 更换镜像 → `psql < backup.sql`

---

## 2. 快速命令参考

| 操作 | 命令 |
|------|------|
| 查看状态 | `docker compose -f docker-compose.prod.yml ps postgres` |
| 查看日志 | `docker compose -f docker-compose.prod.yml logs -f --tail=50 postgres` |
| 连接数据库 | `docker exec -it globalreach-postgres psql -U globalreach_user -d globalreach_prod` |
| 重启服务 | `docker compose -f docker-compose.prod.yml restart postgres` |
| 停止服务 | `docker compose -f docker-compose.prod.yml stop postgres` |
| 备份全部数据库 | `docker exec globalreach-postgres pg_dumpall -U globalreach_user > backup_$(date +%Y%m%d_%H%M%S).sql` |
| 备份单个库 | `docker exec globalreach-postgres pg_dump -U globalreach_user globalreach_prod > db_backup.sql` |
| 查看表大小 | 见下方「常用维护 SQL」章节 |
| 查看连接数 | `docker exec globalreach-postgres psql -U globalreach_user -c "SELECT count(*) FROM pg_stat_activity;"` |
| 终止空闲连接 | `docker exec globalreach-postgres psql -U globalreach_user -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND query_start < NOW() - INTERVAL '30 min';"` |

---

## 3. 数据库结构概览 (11 张表)

| 序号 | 表名 | 用途 | 主要字段 | 预估数据量级 | 多租户字段 |
|-----|------|------|---------|------------|-----------|
| 1 | users | 用户账户 | id(UUID), email, password_hash, name, role, is_active, tenant_id | 小 (~1000) | ✅ tenant_id |
| 2 | email_accounts | 邮箱账号池 | id, user_id, platform(GMAIL/OUTLOOK/QQ/163/CUSTOM_SMTP), status, daily_limit, health_score | 中 (~5000) | ✅ tenant_id |
| 3 | clients | 客户/联系人 | id, user_id, email, status(PROSPECT/LEAD/CUSTOMER/CHURNED), tags | 大 (~10万+) | ✅ tenant_id |
| 4 | campaigns | 营销活动 | id, user_id, name, type, status(DRAFT→COMPLETED), subject_template, stats | 中 (~5000) | ✅ tenant_id |
| 5 | emails | 邮件记录 | id, campaign_id, to_address, from_address, status(PENDING→BOUNCED/FAILED), sent_at | 很大 (~100万+) | ✅ tenant_id |
| 6 | refresh_tokens | 刷新令牌 | id, user_id, token_hash, expires_at, revoked_at | 小 | ✅ tenant_id |
| 7 | audit_logs | 审计日志 | id(BIGINT auto_increment), action, resource_type, severity, ip_address | 大 (持续增长) | ✅ tenant_id |
| 8 | error_logs | 错误日志 | id(BIGINT auto_increment), error_type, error_message, stack_trace, request_url | 大 (持续增长) | ✅ tenant_id |
| 9 | feedbacks | 用户反馈 | id, user_id, type(bug/feature/improvement), title, message | 小 | ✅ tenant_id |
| 10 | maintenance_logs | 维护日志 | id(BIGINT auto_increment), event_type, message, details | 小 | ✅ tenant_id |
| 11 | devices | 移动设备 | id, user_id, device_token, platform(ios/android), device_id | 小 | ✅ tenant_id |

### 关系概览
```
User (1) ──── (N) EmailAccount
User (1) ──── (N) Client
User (1) ──── (N) Campaign
User (1) ──── (N) Email
User (1) ──── (N) RefreshToken
User (1) ──── (N) AuditLog
User (1) ──── (N) ErrorLog
User (1) ──── (N) Feedback
User (1) ──── (N) Device

EmailAccount (1) ──── (N) Email
Campaign (1) ──── (N) Email
Client (1) ──── (N) Email (CASCADE delete)

Tenant (多租户) ──→ 所有业务表均有 tenant_id 字段
```

### 重要索引

所有业务表均包含多租户索引：
- `{tenant_id}` — 加速租户过滤
- 复合索引如 `{tenant_id, email}`, `{tenant_id, status}`, `{tenant_id, user_id}` 等

AuditLog 额外索引：`user_id`, `action`, `resource_type`, `severity`, `status`, `created_at`

---

## 4. 常用维护 SQL

### 4.1 VACUUM（清理死元组）

```sql
-- 分析整个数据库（推荐每周执行一次）
VACUUM ANALYZE VERBOSE;

-- 仅清理特定大表（emails 表增长最快）
VACUUM ANALYZE VERBOSE emails;

-- 激进清理（回收空间给操作系统，会排他锁表，需在低峰期执行）
VACUUM FULL VERBOSE emails;

-- 注意: VACUUM FULL 会锁表，生产环境建议使用 pg_repack 或在维护窗口执行
```

### 4.2 ANALYZE（更新统计信息）

```sql
-- 更新全库统计信息
ANALYZE VERBOSE;

-- 更新特定表的统计信息
ANALYZE VERBOSE emails;
ANALYZE VERBOSE clients;
ANALYZE VERBOSE audit_logs;
```

### 4.3 REINDEX（重建索引）

```sql
-- 重建特定表的索引（当索引膨胀严重时）
REINDEX TABLE CONCURRENTLY emails;
REINDEX TABLE CONCURRENTLY clients;
REINDEX TABLE CONCURRENTLY audit_logs;

-- 注意: CONCURRENTLY 不会锁表，但耗时更长
```

### 4.4 表空间和大小查询

```sql
-- 各表大小排名（TOP 10）
SELECT relname AS table_name,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       pg_size_pretty(pg_relation_size(relid)) AS data_size,
       pg_size_pretty(pg_indexes_size(relid)) AS index_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;

-- 数据库总大小
SELECT pg_size_pretty(pg_database_size('globalreach_prod'));

-- 按 schema 统计
SELECT nspname,
       pg_size_pretty(sum(pg_total_relation_size(relid))) as schema_size
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
GROUP BY nspname ORDER BY sum(pg_total_relation_size(relid)) DESC;
```

### 4.5 连接池状态查询

```sql
-- 当前连接详情
SELECT pid, usename, application_name, client_addr, state,
       query_start, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE datname = 'globalreach_prod'
ORDER BY query_start;

-- 按状态统计
SELECT state, count(*) FROM pg_stat_activity WHERE datname = 'globalreach_prod' GROUP BY state;

-- 空闲超过 30 分钟的连接（可能是泄漏）
SELECT pid, usename, now() - query_start as idle_time, client_addr
FROM pg_stat_activity
WHERE state = 'idle'
  AND query_start < NOW() - INTERVAL '30 minutes';

-- 等待事件分析（排查锁竞争）
SELECT wait_event_type, wait_event, count(*)
FROM pg_stat_activity WHERE wait_event IS NOT NULL
GROUP BY wait_event_type, wait_event ORDER BY count(*) DESC;
```

### 4.6 慢查询排查

```sql
-- 需要先确保 pg_stat_statements 扩展已启用
-- 查询平均耗时 TOP 10
SELECT query, calls, total_exec_time,
       mean_exec_time,
       rows,
       shared_blks_hit,
       shared_blks_read
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 总耗时 TOP 10（找出高频+慢的组合）
SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- 开启慢查询日志（需修改 postgresql.conf 或通过 ALTER SYSTEM）
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- 记录超过 1s 的查询
SELECT pg_reload_conf();
```

---

## 5. 架构关系图

```
┌─────────────────────────────────────────────────────────┐
│                  PostgreSQL 15 (Alpine)                 │
│              globalreach-postgres :5432                 │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │  users   │ │  emails  │ │campaigns │  ... (11 tables)│
│  └────┬─────┘ └────┬─────┘ └────┬─────┘               │
│       │            │            │                       │
│  ┌────┴────────────┴────────────┴─────┐                │
│  │        Sequelize Connection Pool     │                │
│  │   max:10 / min:2 / acquire:30s      │                │
│  │   idle:10s / evict:5s               │                │
│  └──────────────┬──────────────────────┘                │
│                 │                                       │
└─────────────────┼───────────────────────────────────────┘
                  │ :5432
                  ▼
        ┌─────────────────┐
        │  API Service    │  (唯一客户端)
        │  (Sequelize ORM) │
        └─────────────────┘

导出者: postgres-exporter (prometheuscommunity/postgres-exporter:v0.19.1)
  → 暴露指标: pg_up, pg_stat_activity_count, pg_* 系列指标
  → Prometheus 抓取间隔: 30s (继承 globalreach-critical group)
```

---

## 6. 健康检查清单

- [ ] **容器状态**: `docker ps \| grep globalreach-postgres` — Up
- [ ] **pg_isready**: 健康检查通过 (容器内置)
- [ ] **可接受连接**: `docker exec globalreach-postgres psql -U globalreach_user -c "SELECT 1;"` — 返回 1
- [ ] **连接数正常**: 活跃连接 < 80 (PostgresConnectionHigh 告警阈值)
- [ ] **磁盘空间**: 数据目录所在磁盘可用空间 > 20%
- [ ] **WAL 文件**: 无异常增长的 WAL 文件堆积
- [ ] **复制延迟**: N/A (单节点部署，未来 HA 时关注)
- [ ] **最长事务**: 无运行超过 1 小时的活跃事务
- [ ] **死锁**: 最近 1 小时无死锁发生
- [ ] **备份完整性**: 最近备份文件存在且可校验

---

## 7. 故障排查场景

### 场景 1: 连接拒绝 (Connection Refused)

**症状**: API 报错 `ECONNREFUSED` 或 `SequelizeConnectionError`

**可能原因**:
1. PostgreSQL 容器未启动
2. 容器启动中 (数据库恢复过程中)
3. 端口绑定冲突
4. Docker 网络不通

**诊断步骤**:
```bash
# 1. 容器状态
docker ps -a | grep globalreach-postgres

# 2. 容器内进程监听
docker exec globalreach-postgres ss -tlnp | grep 5432

# 3. 健康检查历史
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' globalreach-postgres | tail -5

# 4. 从 API 容器测试连通性
docker exec globalreach-api-prod sh -c "echo > /dev/tcp/postgres/5432" && echo "OK" || echo "FAIL"
```

**解决方案**: 启动 postgres 容器，等待健康检查通过后 API 会自动重连。

---

### 场景 2: 连接池耗尽

**症状**: 新请求获取数据库连接超时，API 报 `acquire connection timeout`

**可能原因**:
1. 长事务占用连接不释放
2. 慢查询阻塞连接池
3. 连接泄漏（代码 bug 导致连接未归还）
4. max_connections 设置过低

**诊断步骤**:
```sql
-- 在 psql 中执行
-- 查看所有活跃连接及其查询
SELECT pid, now() - query_start as duration, state, query
FROM pg_stat_activity
WHERE datname = 'globalreach_prod' AND state != 'idle'
ORDER BY duration DESC;

-- 查看连接分布
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = 'globalreach_prod'
GROUP BY state;

-- 检查是否有长事务
SELECT pid, now() - xact_start as tx_duration, query
FROM pg_stat_activity
WHERE datname = 'globalreach_prod'
  AND state IN ('active', 'idle in transaction')
  AND xact_start < NOW() - INTERVAL '5 minutes';
```

**解决方案**:
- 长事务 → 终止僵死的 PID: `SELECT pg_terminate_backend(pid)`
- 慢查询 → 优化 SQL 或添加索引
- 连接泄漏 → 排查代码层面 bug
- 参数调优 → 增大 `DB_POOL_MAX` 或 PG 的 `max_connections`

---

### 场景 3: 磁盘空间不足

**症状**: 写入失败，WAL 文件无法归档，PG 可能进入只读模式

**可能原因**:
1. 数据量自然增长（emails/audit_logs/error_logs 表）
2. VACUUM 未及时执行导致死元组占用空间
3. WAL 文件堆积（归档失败或未配置归档）
4. 临时文件/排序文件占用过多空间

**诊断步骤**:
```bash
# 1. 检查磁盘使用
df -h

# 2. PG 数据目录大小
docker exec globalreach-postgres du -sh /var/lib/postgresql/data

# 3. 各表大小（在 psql 中执行上面的表大小查询 SQL）

# 4. WAL 目录大小
docker exec globalreach-postgres du -sh /var/lib/postgresql/data/pg_wal

# 5. 死元组占比（高占比说明需要 VACUUM）
SELECT relname, n_dead_tup, n_live_tup,
       round(100.0 * n_dead_tup / (n_dead_tup + n_live_tup), 1) as dead_ratio
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY dead_ratio DESC
LIMIT 10;
```

**解决方案**:
- 数据量大 → 归档旧数据（audit_logs/error_logs 按时间分区归档）
- 死元组多 → 执行 `VACUUM ANALYZE`
- WAL 堆积 → 检查归档配置，手动 checkpoint: `CHECKPOINT;`
- 紧急释放空间 → `VACUUM FULL` (需要排他锁，停机窗口)

**预防措施**: 配置 NodeFileSystemFull 告警 (<15% free)，定期执行 VACUUM

---

### 场景 4: 查询性能突降

**症状**: 特定 API 端点响应变慢，PG CPU 使用率飙升

**可能原因**:
1. 缺失索引（新增查询未建索引）
2. 统计信息过时（ANALYZE 未执行）
3. 索引膨胀（大量 UPDATE/DELETE 导致）
4. 锁竞争（并发事务互相阻塞）
5. 全表扫描（计划选择不当）

**诊断步骤**:
```sql
-- 1. 当前慢查询 TOP 10
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

-- 2. 检查锁等待
SELECT blocked_locks.pid AS blocked_pid,
       blocking_locks.pid AS blocking_pid,
       blocked_activity.query AS blocked_query,
       blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
  AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- 3. 检查序列扫描（全表扫描）
SELECT relname, seq_scan, idx_scan,
       round(100.0 * seq_scan / (seq_scan + idx_scan), 1) as seq_ratio
FROM pg_stat_user_tables
WHERE seq_scan + idx_scan > 0
ORDER BY seq_scan DESC
LIMIT 10;

-- 4. 查看特定查询的执行计划
EXPLAIN ANALYZE <你的查询语句>;
```

**解决方案**:
- 缺索引 → 根据查询模式添加复合索引
- 统计信息过时 → `ANALYZE VERBOSE`
- 索引膨胀 → `REINDEX TABLE CONCURRENTLY`
- 锁竞争 → 减少长事务，优化事务范围
- 全表扫描 → 调整 `random_page_cost` 或 `cpu_tuple_cost` 引导优化器

---

### 场景 5: 数据损坏

**症状**: 查询返回错误数据或报 `corruption detected` 错误

**可能原因**:
1. 磁盘 I/O 错误（硬件故障）
2. 异常关机导致页面写入不完整
3. 文件系统损坏

**诊断步骤**:
```bash
# 1. 使用 pg_verifychecksums 检查数据页完整性（PG 15 支持）
docker exec globalreach-postgres pg_verifychecksums -D /var/lib/postgresql/data

# 2. 检查 dmesg 中的 I/O 错误
dmesg | grep -iE "(error|fail|i/o)" | tail -20

# 3. PG 日志中的错误
docker logs --tail=100 globalreach-postgres | grep -iE "(corrupt|fatal|panic|invalid)"
```

**解决方案**:
- 单表损坏 → 从最近的 pg_dump 恢复该表
- 系统级损坏 → 从完整备份恢复
- 硬件故障 → 更换硬件后从备份恢复

**预防措施**: 定期备份 + 备份校验 + 启用 checksums（PG 15 默认开启）

---

### 场景 6: 备份失败

**症状**: 定时备份任务失败或备份文件不完整

**可能原因**:
1. 磁盘空间不足
2. PG 正在进行大规模写操作导致备份不一致
3. 备份脚本权限问题
4. 网络存储不可达（远程备份场景）

**诊断步骤**:
```bash
# 1. 检查最近备份文件
ls -lh /path/to/backups/ | tail -10

# 2. 尝试手动备份并观察输出
docker exec globalreach-postgres pg_dumpall -U globalreach_user > /tmp/test_backup.sql 2>&1
echo "Exit code: $?"

# 3. 检查备份文件大小是否合理
ls -lh /tmp/test_backup.sql

# 4. 验证备份可恢复（不实际导入，仅语法检查）
docker exec -i globalreach-postgres psql -U globalreach_user -f - < /tmp/test_backup.sql >/dev/null 2>&1
echo "Restore test exit code: $?"
```

**解决方案**: 参考 `docs/REMOTE_BACKUP_STRATEGY.md` 中的备份策略详细流程

---

## 8. 备份/恢复快速参考

### 备份

```bash
# === 逻辑备份 (pg_dump/pg_dumpall) ===
# 全部数据库（含角色/权限）
docker exec globalreach-postgres pg_dumpall -U globalreach_user > full_backup_$(date +%Y%m%d).sql

# 仅业务数据库
docker exec globalreach-postgres pg_dump -U globalreach_user \
  --format=custom --compress=9 \
  -f /tmp/globalreach_prod.backup globalreach_prod
docker cp globalreach-postgres:/tmp/globalreach_prod.backup ./backup_$(date +%Y%m%d).backup

# === 物理备份 (base backup, 用于 PITR) ===
# 需要 wal_level = replica 且配置归档
docker exec globalreach-postgres psql -U globalreach_user -c "SELECT pg_start_backup('manual_backup');"
tar -cf pg_data_backup.tar -C /path/to/host/volume postgres_data/
docker exec globalreach-postgres psql -U globalreach_user -c "SELECT pg_stop_backup();"
```

### 恢复

```bash
# === 从逻辑备份恢复 ===
# 全量恢复
cat full_backup_20260609.sql | docker exec -i globalreach-postgres psql -U globalreach_user

# 从 custom format 恢复
docker cp ./backup_20260609.backup globalreach-postgres:/tmp/restore.backup
docker exec globalreach-postgres pg_restore -U globalreach_user -d globalreach_prod --clean --if-exists /tmp/restore.backup

# === 恢复单张表 ===
docker exec globalreach-postgres pg_dump -U globalreach_user -t emails globalreach_prod > emails_table.sql
# 编辑后恢复
docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod < emails_table.sql
```

### 重要提醒
- **恢复前务必备份当前数据**
- 恢复操作会导致**数据丢失**（覆盖当前状态）
- 生产环境恢复应在维护窗口进行
- 详细策略见 `docs/REMOTE_BACKUP_STRATEGY.md` 和 `docs/DISASTER_RECOVERY_DRILL_PLAN.md`

---

## 9. 关键指标基线

| 指标 | 正常范围 | 警告阈值 | 严重阈值 | 说明 |
|------|---------|---------|---------|------|
| 活跃连接数 | < 40 | > 60 | > 80 | PostgresConnectionHigh 告警 |
| 查询平均耗时 | < 50ms | > 200ms | > 1000ms | pg_stat_statements.mean_exec_time |
| 死元组比例 | < 10% | > 20% | > 40% | 需要执行 VACUUM |
| 索引命中率 | > 99% | < 98% | < 95% | pg_stat_user_tables.seq_scan 比例 |
| 磁盘使用率 | < 70% | > 85% | > 95% | 含 WAL 和数据文件 |
| Checkpoint 时间 | < 30s | > 60s | > 120s | I/O 压力指标 |
| TPS (每秒事务) | 基线 | 突增/骤降 | 异常波动 | 业务负载指标 |
| 锁等待次数 | 0 | > 5/min | > 20/min | 并发竞争指标 |
| 复制延迟 | N/A | N/A | N/A | 单节点暂不适用 |

---

## 10. 相关资源

### 关联 Runbook
- [RB-001 API 服务运行手册](RB-001_API_SERVICE.md) — API 层面的 DB 问题表现
- [RB-006 Docker Compose 运行手册](RB-006_DOCKER.md) — 容器编排操作

### 关联文档
- [PostgreSQL 升级计划](../POSTGRESQL_UPGRADE_PLAN.md) — 15→16 升级指南
- [远程备份策略](../REMOTE_BACKUP_STRATEGY.md) — 备份/恢复详细方案
- [灾备演练计划](../DISASTER_RECOVERY_DRILL_PLAN.md) — DR 流程
- [安全密钥轮换政策](../SECURITY_KEY_ROTATION_POLICY.md) — DB 密码轮换

### 配置文件
- `docker-compose.prod.yml` — postgres 服务定义 (第 6-27 行)
- `api/db/index.js` — ORM 模型和连接池配置
- `alertmanager/alertmanager.yml` — 告警路由 (team: database)

### Grafana 仪表盘
- PostgreSQL Overview (连接数/QPS/缓存命中率/死元组)
- Database Performance (查询耗时/锁等待/Checkpoint)
