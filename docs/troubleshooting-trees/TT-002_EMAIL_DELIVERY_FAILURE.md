# TT-002 邮件发送失败决策树

> **文档版本**: v1.0
> **适用场景**: Campaign 发送失败 / 邮件队列积压 / 退信率高
> **预估排查时间**: 10-60 分钟
> **关联 Runbook**: [RB-007 邮件流水线运行手册](../runbooks/RB-007_EMAIL_PIPELINE.md)

---

## 决策树总览

```
[开始: 邮件发送出现问题]
│  症状分类:
│  A) Campaign 卡在 SENDING 无进度
│  B) 大量邮件进入 FAILED 状态
│  C) 邮件发出但收件人收不到 (BOUNCED)
│  D) 发送速度异常慢
│
├─ Step 0: 确认症状类型 (选择最匹配的一项)
│  │  命令:
│  │    # Campaign 状态概览
│  │    curl -sf http://localhost:3000/api/v1/campaigns | jq '[.[] | select(.status=="SENDING") | {id, name, status}]'
│  │    # 队列状态
│  │    docker exec globalreach-redis redis-cli SCAN 0 MATCH "bull:*" COUNT 10
│  │    # 最近失败邮件
│  │    curl -sf http://localhost:8025/api/messages 2>/dev/null | jq '.Messages[-5:]' || echo "Mailpit not available"
│  │  预估: 2 min
│  │
│  ├─ [路径 A: Campaign 无进度] ───────────────────────↓
│  ├─ [路径 B: 大量 FAILED] ──────────────────────────↓
│  ├─ [路径 C: 高退信率] ────────────────────────────↓
│  └─ [路径 D: 发送慢] ──────────────────────────────↓
│
╔══════════════════════════════════════════════════════════════╗
║                  路径 A: Campaign 无进度                    ║
╚══════════════════════════════════════════════════════════════╝
│
├─ Step A1: SendWorker 是否在运行?
│  │  命令: docker logs --since=10m api 2>&1 | grep -iE "(Worker|SendWorker|started|stopped)"
│  │  预估: 1 min
│  │
│  ├─ ❌ 无 Worker 日志 / Worker stopped ──→ Worker 未启动或已停止
│  │   │  原因: API 启动时 Pipeline 初始化失败; Worker 异常退出
│  │   │  解决: 重启 API 容器 (restart api)
│  │   │  额外: 5 min
│  │   └─→ RB-007 场景 1
│  │
│  └─ ✅ Worker 运行中 ─────────────────→ Step A2 ↓
│
├─ Step A2: Redis 队列状态检查
│  │  命令:
│  │    echo "=== wait ===" && docker exec globalreach-redis redis-cli LLEN bull:email:wait
│  │    echo "=== active ===" && docker exec globalreach-redis redis-cli LLEN bull:email:active
│  │    echo "=== paused ===" && docker exec globalreach-redis redis-cli HGET bull:email:meta paused
│  │  预估: 1 min
│  │
│  ├─ wait > 0 且 active = 0 ─────────→ 任务在排队但不消费!
│  │   │  可能原因:
│  │   │  1. 队列被暂停 (paused=true)
│  │   │  2. Bull 锁阻塞
│  │   │  3. Worker pollInterval 异常
│  │   │  解决: 检查 paused 状态, 必要时重启 API
│  │   │  额外: 5 min
│  │   └─→ RB-007 场景 4 + FM-APP-003
│  │
│  ├─ wait = 0 且 active = 0 ─────────→ 队列空! 可能已完成或从未入队
│  │   │  → 检查 Campaign 的 stats 字段确认实际状态
│  │   │  → RB-007 场景 6
│  │   │  额外: 3 min
│  │
│  └─ wait 和 active 都有值且活跃 ─────→ 正常工作中, 可能只是感知慢
│      → 转到 [路径 D: 发送慢] ↓
│
╔══════════════════════════════════════════════════════════════╗
║                  路径 B: 大量 FAILED                       ║
╚══════════════════════════════════════════════════════════════╝
│
├─ Step B1: 查看失败原因分布
│  │  命令:
│  │    # API 错误日志 (最近 100 行)
│  │    docker logs --since=30m api 2>&1 | grep -iE "(fail|reject|error|bounce)" | tail -30
│  │    # Mailpit 中的最新失败邮件
│  │    curl -sf http://localhost:8025/api/messages 2>/dev/null | jq '.Messages[-5:] | .[] | {Subject, Reason}'
│  │  预估: 3 min
│  │
│  ├─ "auth" / "authentication failed" ──→ [B1: 认证失败] ↓
│  ├─ "quota" / "rate limit" / "exceeded" ─→ [B2: Provider 限流] ↓
│  ├─ "invalid" / "unknown user" ─────────→ [B3: 收件人地址无效] ↓
│  ├─ "spam" / "rejected" / "blocked" ────→ [B4: 内容被拒] ↓
│  ├─ "timeout" / "ECONNRESET" ──────────→ [B5: 网络/连接问题] ↓
│  └─ 其他错误 ─────────────────────────→ [B6: 未知错误] ↓
│
│  ├─ [B1: 认证失败]
│  │  │  原因: OAuth token 过期 / 应用密码变更 / 账号被封禁
│  │  │  排查:
│  │  │    # 检查账号状态
│  │  │    curl -sf http://localhost:3000/api/v1/accounts | jq '.[] | select(.status!="ACTIVE")'
│  │  │  解决: 更新凭据; 在前端重新授权 OAuth; 切换到备用账号
│  │  │  额外: 10-30 min
│  │  └─→ RB-007 场景 3 + FM-EXT-001
│  │
│  ├─ [B2: Provider 限流]
│  │  │  原因: 超出发送配额 (QQ Mail 限制严格)
│  │  │  排查:
│  │  │    # 检查账号 health_score 和 sent_today
│  │  │    curl -sf http://localhost:3000/api/v1/accounts | jq '.[] | {platform, healthScore, sentToday}'
│  │  │  解决: 降低 SEND_RATE_LIMIT; 切换到其他 Provider; 等待配额重置
│  │  │  额外: 5-30 min
│  │  └─→ RB-007 + FM-EXT-001
│  │
│  ├─ [B3: 地址无效]
│  │  │  原因: 客户数据质量差 (拼写错误/废弃邮箱/角色地址)
│  │  │  解决: 清洗客户列表; 标记 CHURNED 地址; 邮件验证服务前置
│  │  │  额外: 15-60 min (批量清洗)
│  │  └─→ RB-007
│  │
│  ├─ [B4: 内容被拒]
│  │  │  原因: 触发垃圾邮件过滤器; 域名信誉度低; 包含敏感关键词
│  │  │  排查: Mailpit 中查看被拒邮件内容; 检查 SPF/DKIM/DMARC 配置
│  │  │  解决: 优化邮件内容; 配置域名认证; 降低发送频率提升信誉
│  │  │  额外: 30-120 min
│  │  └─→ RB-007 场景 5
│  │
│  ├─ [B5: 网络问题]
│  │  │  原因: DNS 解析 SMTP host 失败; 网络抖动; 防火墙拦截出站 25/465/587
│  │  │  排查:
│  │  │    docker exec globalreach-api-prod sh -c "echo > /dev/tcp/smtp.qq.com/465" && echo OK || echo FAIL
│  │  │  解决: 检查 DNS/防火墙/路由; 增加重试次数
│  │  │  额外: 5-20 min
│  │  └─→ FM-NET-001 + FM-EXT-001
│  │
│  └─ [B6: 未知错误]
│     │  收集完整错误信息: stack trace + provider message + request context
│     │  → 检查 ErrorLog 表获取详细记录
│     │  → 必要时升级到 L2/L3 工程师分析代码
│     │  额外: 30-120 min
│     └─→ RB-001 (通用错误排查)
│
╔══════════════════════════════════════════════════════════════╗
║                  路径 C: 高退信率                           ║
╚══════════════════════════════════════════════════════════════╝
│
├─ Step C1: 退信类型分析
│  │  命令:
│  │    # DB 中退信统计
│  │    docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
│  │      SELECT bounced_reason, count(*) as cnt
│  │      FROM emails WHERE status='BOUNCED'
│  │      AND created_at > NOW() - INTERVAL '24 hours'
│  │      GROUP BY bounced_reason ORDER BY cnt DESC LIMIT 10;"
│  │  预估: 2 min
│  │
│  ├─ "User unknown" / "mailbox not found" ─→ Hard Bounce → 清洗列表
│  │  │  操作: UPDATE clients SET status='CHURNED' WHERE email IN (...)
│  │  │  额外: 15-30 min
│  │  └─→ RB-007
│  │
│  ├─ "Full" / "over quota" ──────────────→ Soft Bounce → 延迟重试
│  │  │  操作: EmailQueue 自动重试机制会处理
│  │  │  额外: 自动 (无需人工干预)
│  │  └─→ RB-007
│  │
│  ├─ "Spam" / "blocked" / "complaint" ──→ 信誉度问题
│  │  │  操作: 暂停该 Campaign; 检查发件域名的 IP 信誉; 切换 IP/Provider
│  │  │  额外: 30-60 min
│  │  └─→ RB-007
│  │
│  └─ "Relay access denied" ───────────→ IP/域名被列入黑名单
│     │  操作: 检查 RBL (Real-time Blackhole List); 申请移除; 切换出口 IP
│     │  额外: 1-24 小时 (移除申请可能很慢)
│     └─→ FM-SEC-003 (可能是 DDoS 导致 IP 污染)
│
╔══════════════════════════════════════════════════════════════╗
║                  路径 D: 发送速度慢                         ║
╚══════════════════════════════════════════════════════════════╝
│
├─ Step D1: 检查当前发送参数
│  │  命令: docker exec globalreach-api-prod env | grep -E "(SEND_|WORKER_)"
│  │  预估: 1 min
│  │
│  ├─ SEND_RATE_LIMIT 太低 (默认 3/s) ──→ 调大 (注意不要超过 Provider 限制)
│  │  │  额外: 1 min (改 env + restart)
│  │  └─→ RB-007 第 5 节
│  │
│  ├─ SEND_CONCURRENCY 太低 (默认 5) ──→ 调大 (受 Provider 并发限制)
│  │  │  额外: 1 min
│  │  └─→ RB-007 第 5 节
│  │
│  └─ 参数合理但仍然慢 ───────────────→ Step D2 ↓
│
├─ Step D2: 瓶颈定位
│  │  命令:
│  │    # 观察 Worker 日志中的时间戳间隔
│  │    docker logs --since=2m api 2>&1 | grep -i "job.*complete\|processed\|sent" | tail -20
│  │  预估: 2 min
│  │
│  ├─ 每封邮件间隔均匀但慢 ─────────→ 速率限制瓶颈 → 调大 RATE_LIMIT
│  │  │  额外: 1 min
│  │  └─→ RB-007
│  │
│  ├─ 间歇性突然变慢 ───────────────→ Provider 响应不稳定
│  │  │  → 检查 SMTP 连接延迟; 考虑增加 Provider 数量分散负载
│  │  │  额外: 10-30 min
│  │  └─→ FM-EXT-001
│  │
│  └─ 模板渲染阶段慢 ───────────────→ TemplateEngine 性能问题
│     │  → 检查模板复杂度; 预编译模板; 简化 Handlebars 逻辑
│     │  额外: 15-60 min
│     └─→ RB-007
```

---

## 快速速查表

| 症状 | 最可能原因 | 首选命令 | 首选方案 | 预估时间 |
|------|-----------|---------|---------|---------|
| Campaign 无进度 | Worker 未运行 | `docker logs api \| grep Worker` | restart api | 5 min |
| 队列积压不消费 | 队列暂停/锁住 | `redis-cli HGET bull:email:meta paused` | restart api | 5-10 min |
| 大量 auth 失败 | Token/密码过期 | `curl /api/v1/accounts` | 更新凭据 | 10-30 min |
| 大量 quota 错误 | Provider 限流 | 检查 health_score | 切换 Provider / 降速 | 5-30 min |
| 高 bounce 率 | 地址无效 | SQL 查询 bounced_reason | 清洗列表 | 15-60 min |
| 发送整体偏慢 | RATE_LIMIT 低 | `env \| grep SEND_` | 调大参数 | 1-5 min |
| 内容被拒 | 垃圾邮件过滤 | Mailpit 查看邮件内容 | 优化内容 + 域名认证 | 30-120 min |
