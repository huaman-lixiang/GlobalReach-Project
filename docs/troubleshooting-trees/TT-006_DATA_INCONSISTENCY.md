# TT-006 数据不一致决策树

> **文档版本**: v1.0
> **适用场景**: 数据在不同组件间不一致 (DB vs Redis vs API vs 缓存)
> **预估排查时间**: 30-120 分钟
> **关联 Runbook**: [RB-001 API 服务运行手册](../runbooks/RB-001_API_SERVICE.md), [RB-002 PostgreSQL 运行手册](../runbooks/RB-002_POSTGRES.md), [RB-003 Redis 运行手册](../runbooks/RB-003_REDIS.md)
> **关联 FMB**: [FM-APP-006 缓存雪崩](../failure-modes/FailureModeBase.md), [FM-STO-003 数据损坏](../failure-modes/FailureModeBase.md)

---

## 决策树总览

```
[开始: 发现数据不一致问题]
│  常见症状:
│  A) 前端显示的数据与 DB 中不同
│  B) 缓存中的数据与 DB 不同 (脏读)
│  C) 队列状态与 Campaign 状态不匹配
│  D) 多租户数据串台 (看到其他租户的数据)
│  E) 统计数据不准 (计数/汇总值错误)
│
├─ Step 0: 定义不一致的范围
│  │  命令:
│  │    # 确认具体是哪类数据不一致
│  │    # 需要根据用户报告的具体症状来定位
│  │  预估: 2-5 min
│  │
│  ├─ [路径 A: API 响应 vs DB 实际值] ────────────────↓
│  ├─ [路径 B: 缓存 vs 源数据] ─────────────────────↓
│  ├─ [路径 C: 队列/异步任务 vs DB] ─────────────────↓
│  ├─ [路径 D: 多租户隔离失效] ──────────────────────↓
│  └─ [路径 E: 统计/聚合数据错误] ────────────────────↓
│
╔═══════════════════════════════════════════════════════╗
║       路径 A: API 响应 vs DB 不一致                   ║
╚═══════════════════════════════════════════════════════╝
│
│  症状: 用户在前端看到的值与直接查 DB 得到的值不同
│
├─ Step A1: 复现差异
│  │  命令:
│  │    # 1. 通过 API 获取数据
│  │    curl -sf http://localhost:3000/api/v1/<resource>/<id> | jq .
│  │
│  │    # 2. 直接查 DB 获取同一记录
│  │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
│  │      SELECT * FROM <table> WHERE id='<id>';"
│  │
│  │    # 3. 逐字段对比差异
│  │  预估: 5 min
│  │
│  ├─ 字段完全一致 ─────────────────→ 可能是前端缓存/浏览器缓存问题
│  │   │  → 让用户 Ctrl+F5 强制刷新; 检查 CDN 缓存
│  │   │  → RB-004 (Nginx 缓存配置)
│  │   │  额外: 2-5 min
│  │   └─→ 通常不是后端问题
│  │
│  └─ 字段存在差异 ─────────────────→ Step A2 ↓
│
├─ Step A2: 分析差异特征
│  │
│  │  ├─ 差异是固定值 (每次都一样) ──→ [A2a: 数据同步问题] ↓
│  │  │  │  可能原因:
│  │  │  │  1. Sequelize sync({alter:true}) 未正确同步新字段
│  │  │  │  2. API 返回的是旧版模型定义 (缺少新字段或默认值不同)
│  │  │  │  3. DB trigger/default 在 API 层面未被感知
│  │  │  │
│  │  │  排查:
│  │  │  │  # 检查 API 使用的模型定义是否与 DB schema 一致
│  │  │  │  # 对比 api/db/index.js 中的 model definition 与
│  │  │  │  # \d <table> (PG 描述表结构) 的输出
│  │  │  │
│  │  │  解决: 重启 API 让 sequelize.sync({alter:true}) 重新同步
│  │  │  额外: 5-15 min
│  │  │  └─→ RB-001 + RB-002
│  │  │
│  │  └─ 差异是延迟性的 (过一段时间才一致) ─→ [A2b: 复制延迟/事务可见性] ↓
│  │     │  可能原因:
│  │     │  1. 读到了旧的事务快照 (PostgreSQL MVCC)
│  │     │  2. 主从延迟 (当前单节点不适用, 但未来 HA 时需要注意)
│  │     │  3. 写入还未 commit 就读了
│  │     │
│  │     排查:
│  │     │  # 检查是否有长事务持有锁
│  │     │  docker exec globalreach-postgres psql -U globalreach_user -c "
│  │     │    SELECT pid, now()-xact_start as age, query
│  │     │    FROM pg_stat_activity WHERE state IN ('active','idle in transaction')
│  │     │    ORDER BY age DESC LIMIT 5;"
│  │     │
│  │     解决: 终止长事务; 检查 isolation level
│  │     额外: 5-15 min
│  │     └─→ RB-002 场景 4 + FM-APP-005
│
╔═══════════════════════════════════════════════════════╗
║       路径 B: 缓存 vs 源数据不一致                     ║
╚═══════════════════════════════════════════════════════╝
│
│  症状: Redis 缓存中的值与 PostgreSQL 中的值不同
│
├─ Step B1: 对比两边的值
│  │  命令:
│  │    # Redis 中的值
│  │    docker exec globalreach-redis redis-cli GET "cache:<namespace>:<key>"
│  │
│  │    # DB 中的值
│  │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "<SQL>"
│  │  预估: 3 min
│  │
│  ├─ Redis 有值但 DB 没有 ───────────→ [B1: 幻影缓存 / 删后未清缓存]
│  │   │  原因: DB 中的数据被删除但 Redis key 未同步删除
│  │   │  解决: 删除脏缓存 key; 检查 CacheService 的失效逻辑
│  │   │  额外: 5 min
│  │   │  命令: docker exec globalreach-redis redis-cli DEL "cache:<key>"
│  │   └─→ RB-003 + RB-001 (CacheService)
│  │
│  ├─ DB 有值但 Redis 为空/过期 ──────→ [B2: 缓存过早失效 / 未写入]
│  │   │  原因: TTL 设置太短; 写入缓存失败; 缓存写入竞态
│  │   │  解决: 检查 TTL 配置; 检查 CacheService.write() 返回值
│  │   │  额外: 5-15 min
│  │   │  命令: docker exec globalreach-redis redis-cli TTL "cache:<key>"
│  │   └─→ RB-003 + FM-APP-006
│  │
│  └─ 两边都有值但不一致 ─────────────→ [B3: 缓存更新失败 / 并发写入冲突]
│     │  原因: DB 更新成功但缓存更新失败; 两处独立更新导致不一致
│     │  解决: 检查 Cache Service 的 write-through 策略;
│     │         考虑 Cache-Aside 模式的失效时机
│     │  额外: 10-30 min
│     │  → RB-003 + RB-001
│
╔═══════════════════════════════════════════════════════╗
║       路径 C: 异步队列/任务状态 vs DB 不一致             ║
╚═══════════════════════════════════════════════════════╝
│
│  症状: Bull 队列中的 job 状态与 emails 表中的 status 不匹配
│
├─ Step C1: 三方比对
│  │  命令:
│  │    # 1. Bull 队列状态
│  │    docker exec globalreach-redis redis-cli LLEN bull:email:wait
│  │    docker exec globalreach-redis redis-cli LLEN bull:email:completed
│  │    docker exec globalreach-redis redis-cli LLEN bull:email:failed
│  │
│  │    # 2. emails 表状态分布
│  │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
│  │      SELECT status, count(*) FROM emails GROUP BY status;"
│  │
│  │    # 3. Campaign 状态
│  │    curl -sf http://localhost:3000/api/v1/campaigns | jq '.[] | {status, stats}'
│  │  预估: 5 min
│  │
│  ├─ 队列有 pending 但 DB 全部 SENT ──→ [C1: 队列状态未回写 DB]
│  │   │  原因: Worker 处理完成但 DB 更新失败 (或事务未 commit)
│  │   │  解决: 手动补偿 DB 状态; 检查 Worker 的错误处理逻辑
│  │   │  额外: 15-30 min
│  │   │  命令:
│  │   │    # 补偿 SQL 示例 (需根据实际情况调整):
│  │   │    UPDATE emails SET status='SENT', sent_at=NOW()
│  │   │    WHERE status IN ('QUEUED','PENDING') AND campaign_id='<id>'
│  │   └─→ RB-007 + TT-002
│  │
│  ├─ DB 显示 SENDING 但队列为空 ─────→ [C2: Campaign 状态未更新]
│  │   │  原因: 队列消费完毕但 Campaign.status 未从 SENDING 改为 COMPLETED
│  │   │  解决: 手动更新 Campaign 状态; 检查 Campaign 完成回调逻辑
│  │   │  额外: 5-10 min
│  │   │  命令:
│  │   │    UPDATE campaigns SET status='COMPLETED', completed_at=NOW()
│  │   │    WHERE id='<id>' AND status='SENDING';
│  │   └─→ RB-007 场景 6
│  │
│  └─ failed 队列中有任务但 DB 显示 SENT ─→ [C3: 重试后成功但未清理 failed]
│     │  原因: 任务重试后最终成功, 但 failed 队列中的记录未被清理
│     │  解决: Bull 队列的 completed/failed 保留设置问题; 手动清理
│     │  额外: 5 min
│     │  命令: (Bull CLI 或 Redis 命令清理 old jobs)
│     └─→ RB-007
│
╔═══════════════════════════════════════════════════════╗
║       路径 D: 多租户数据串台                          ║
╚═══════════════════════════════════════════════════════╝
│
│  症状: 租户 A 的用户看到了租户 B 的数据
│  **严重程度**: 🔴 Critical (合规风险 / GDPR 违规)
│
├─ Step D1: 确认串台范围
│  │  命令:
│  │    # 检查是否有 tenant_id 为 NULL 或错误的记录
│  │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
│  │      SELECT '<table>' as tbl, count(*) as bad_count FROM <table>
│  │      WHERE tenant_id IS NULL OR tenant_id NOT IN (SELECT id FROM tenants);
│  │    "  # 对每个业务表执行
│  │  预估: 5 min
│  │
│  ├─ 有 NULL tenant_id 的记录 ───────→ [D1: 租户过滤失效]
│  │   │  原因: 新增代码忘记加 tenant_id 字段; 默认值被覆盖为 NULL
│  │   │  排查: 最近变更中涉及的 model 和 migration
│  │   │  修复: 修正默认值; 补充遗漏的 tenant_id; 数据清洗
│  │   │  额外: 30-120 min (含数据修复)
│  │   └─→ docs/MULTI_TENANT_ARCHITECTURE.md
│  │
│  └─ tenant_id 都有值但查询返回跨租户数据 → [D2: 查询条件缺少 tenant_id 过滤]
│     │  原因: 某个 API endpoint 的查询没有 WHERE tenant_id = ? 条件
│     │  排查:
│     │    # 审计日志中查找可疑的跨租户访问
│     │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
│     │      SELECT user_id, action, resource_id, created_at
│     │      FROM audit_logs WHERE severity='CRITICAL'
│     │      ORDER BY created_at DESC LIMIT 20;"
│     │
│     │  修复: 审查所有 Route handler 的查询; 添加全局 scope (Sequelize defaultScope)
│     │  额外: 30-120 min (全面审查)
│     │  → docs/MULTI_TENANT_ARCHITECTURE.md + RB-001
│
╔═══════════════════════════════════════════════════════╗
║       路径 E: 统计/聚合数据错误                        ║
╚═══════════════════════════════════════════════════════╝
│
│  症状: Dashboard 统计数字不准确 (邮件总数/打开率/客户数等)
│
├─ Step E1: 验证统计口径
│  │  命令:
│  │    # API 返回的统计数据
│  │    curl -sf http://localhost:3000/api/v1/stats/summary | jq .
│  │
│  │    # DB 中的原始计数
│  │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
│  │      SELECT
│  │        (SELECT count(*) FROM emails) as total_emails,
│  │        (SELECT count(*) FROM emails WHERE status='SENT') as sent,
│  │        (SELECT count(*) FROM emails WHERE status='OPENED') as opened,
│  │        (SELECT count(*) FROM clients) as total_clients,
│  │        (SELECT count(*) FROM campaigns) as total_campaigns;"
│  │  预估: 3 min
│  │
│  ├─ 计数完全一致但前端显示不同 ──→ 前端计算/展示 bug
│  │   │  → 检查前端的数据转换/舍入/时区处理
│  │   │  额外: 10-30 min
│  │   └─→ 前端代码审查
│  │
│  ├─ DB 原始计数就不对 ───────────→ [E1: 数据质量问题]
│  │   │  原因: 软删除的数据被计入; 测试/种子数据未清理;
│  │   │         重复数据; 事务部分提交
│  │   │  排查: 检查 WHERE 条件是否排除了软删除/测试数据
│  │   │  额外: 15-30 min
│  │   └─→ RB-002
│  │
│  └─ DB 正确但 API 聚合逻辑错 ───────→ [E2: 统计查询 bug]
│     │  原因: GROUP BY / JOIN 导致重复计数; 时区转换错误;
│     │         多租户数据未正确过滤
│     │  排查: 对比 API stats route 的 SQL 与手写验证 SQL
│     │  额外: 15-60 min
│     │  → RB-001 (stats routes 审查)
```

---

## 数据一致性最佳实践

| 原则 | 说明 | 当前实现状态 |
|------|------|-------------|
| 单一数据源 | DB 是唯一真相来源, 缓存只是加速层 | ✅ CacheService 基于 Redis TTL |
| Write-Through | 写入时同步更新缓存 | ⚠️ 需确认 CacheService 策略 |
| Cache Invalidation | 数据变更时主动清除缓存 | ⚠️ 需确认失效逻辑完整性 |
| 最终一致性 | 异步操作允许短暂不一致, 但要有补偿机制 | ⚠️ Queue → DB 回写需加强 |
| 租户隔离 | 所有查询必须带 tenant_id 条件 | ✅ 默认值 DEFAULT_TENANT_ID=1 |
| 事务边界 | 关联操作在同一事务中 | ✅ Sequelize transactions |
| 幂等性 | 重试操作不会产生副作用 | ⚠️ 部分场景需增强 |
