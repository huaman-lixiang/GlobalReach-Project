# RB-007 邮件流水线运行手册

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **组件**: 邮件发送流水线 (Campaign → Queue → Worker → Provider → Delivery)
> **最后更新**: 2026-06-09

---

## 1. 组件身份卡

| 属性 | 值 |
|------|-----|
| 所在容器 | globalreach-api-prod (嵌入在 API 进程中) |
| 队列引擎 | Bull (基于 Redis) |
| 模板引擎 | TemplateEngine (Handlebars/Mustache 风格) |
| 发送引擎 | emailService (多 Provider 支持) |
| 并发控制 | SEND_CONCURRENCY (默认 5) |
| 重试策略 | SEND_MAX_RETRIES (默认 3), SEND_RETRY_DELAY (默认 1000ms) |
| 速率限制 | SEND_RATE_LIMIT (默认 3 封信/秒) |
| Worker 轮询 | WORKER_POLL_INTERVAL (默认 500ms) |
| SMTP 测试 | Mailpit (:1025 SMTP + :8025 Web UI) |
| 支持平台 | Gmail, Outlook, QQ Mail, NetEase 163, Custom SMTP |

---

## 2. 快速命令参考

| 操作 | 命令 |
|------|------|
| 查看队列状态 | `curl -sf http://localhost:3000/api/v1/metrics \| grep -i queue` |
| 查看 Worker 状态 | `docker logs --since=10m globalreach-api-prod 2>&1 \| grep -iE "(Worker|Queue|SendWorker)"` |
| 查看 Campaign 状态 | `curl -sf http://localhost:3000/api/v1/campaigns \| jq '.[] \| select(.status=="SENDING")'` |
| 查看 Mailpit 收件箱 | `curl -sf http://localhost:8025/api/messages \| jq '.Messages \| length'` |
| 查看 Mailpit 最新邮件 | `curl -sf http://localhost:8025/api/messages \| jq '.Messages[0]'` |
| 清空 Mailpit 收件箱 | `curl -sf -X DELETE http://localhost:8025/api/messages` |
| 查看 SMTP 配置 | `docker exec globalreach-api-prod env \| grep -E "(SMTP_|SEND_)"` |
| 查看 Redis 队列 key | `docker exec globalreach-redis redis-cli SCAN 0 MATCH "bull:*" COUNT 20` |
| 查看待发送队列深度 | `docker exec globalreach-redis redis-cli LLEN bull:email:wait 2>/dev/null \| echo "Check actual key name"` |
| 查看正在处理的任务 | `docker exec globalreach-redis redis-cli LLEN bull:email:active 2>/dev/null` |
| 重启 Worker (需重启 API) | `docker compose -f docker-compose.prod.yml restart api` |

---

## 3. 架构概述

```
┌──────────────────────────────────────────────────────────────────┐
│                     邮件发送流水线 (D03 Pipeline)                  │
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌──────────┐               │
│  │ Campaign │───▶│  EmailQueue  │───▶│ SendWorker│               │
│  │ 创建/调度 │    │  (Bull/Redis)│    │ (Consumer)│               │
│  └──────────┘    └──────┬───────┘    └────┬─────┘               │
│                         │                 │                       │
│                   [Redis :6379]     ┌────┴────┐                │
│                   wait/active/     │Template  │                │
│                   completed/failed │ Engine   │                │
│                                   └────┬────┘                │
│                                        │                       │
│                                   ┌────▼────┐                │
│                                   │emailSvc │                │
│                                   │(Sender) │                │
│                                   └────┬────┘                │
│                                        │                       │
│                         ┌──────────────┼──────────────┐       │
│                         ▼              ▼              ▼       │
│                    ┌─────────┐  ┌─────────┐  ┌──────────┐    │
│                    │ QQ Mail │  │  Gmail  │  │ Outlook  │    │
│                    │ (SMTP)  │  │ (IMAP)  │  │ (OAuth)  │    │
│                    └────┬────┘  └────┬────┘  └────┬─────┘    │
│                         │             │            │          │
│                         └─────────────┼────────────┘          │
│                                       ▼                        │
│                               ┌──────────────┐                │
│                               │   Recipient  │                │
│                               │  (Mailbox)    │                │
│                               └──────────────┘                │
│                                                                  │
│  辅助组件:                                                       │
│  ┌──────────┐  测试 SMTP 接收 + Web UI 查看已发邮件              │
│  │  Mailpit  │  :1025 (SMTP) / :8025 (Web)                      │
│  └──────────┘                                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 流水线阶段详解

| 阶段 | 组件 | 动作 | 数据存储 |
|------|------|------|---------|
| 1. Campaign 创建 | Campaign Route | 用户创建活动，定义模板/目标/账号 | PostgreSQL campaigns 表 |
| 2. 入队 | EmailQueue | 将每个收件人拆分为独立 Job，入队 | Redis (Bull Queue) |
| 3. 出队消费 | SendWorker | 按 concurrency 并发取出 Job | Redis (Bull Queue) |
| 4. 模板渲染 | TemplateEngine | 用客户数据填充 Handlebars 模板 | 内存 |
| 5. 发送执行 | emailService | 通过对应 Platform Adapter 发送 | SMTP/IMAP 协议 |
| 6. 状态更新 | Email Model | 更新 emails 表状态 (PENDING→SENT→DELIVERED...) | PostgreSQL emails 表 |
| 7. 失败重试 | EmailQueue | 按 retries 配置重新入队 | Redis (Bull Queue) |
| 8. 退信处理 | Webhook/Bounce | 处理 Provider 回调的退信通知 | PostgreSQL emails 表 |

### 支持的 SMTP 提供商

| 提供商 | 平台标识 | SMTP Host | 加密方式 | 适用场景 |
|--------|---------|-----------|---------|---------|
| QQ Mail | QQ | smtp.qq.com:465 | SSL | 当前生产主服务商 |
| Gmail | GMAIL | smtp.gmail.com:587 | STARTTLS | Google Workspace |
| Outlook | OUTLOOK | smtp-mail.outlook.com:587 | STARTTLS | Microsoft 365 |
| NetEase 163 | NETEASE_163 | smtp.163.com:465 | SSL | 国内企业邮箱 |
| Custom SMTP | CUSTOM_SMTP | 自定义 | 可配 | 私有邮件服务器 |

---

## 4. 队列状态监控

### Redis 中 Bull 队列的 Key 结构

Bull 队列在 Redis 中存储以下 key (假设 queue name 为 `email`):

| Redis Key 类型 | Key 名 | 用途 |
|---------------|--------|------|
| List | `bull:email:wait` | 等待处理的任务 |
| List | `bull:email:active` | 正在处理的任务 |
| List | `bull:email:completed` | 已完成的任务 |
| List | `bull:email:failed` | 失败的任务 |
| Hash | `bull:email:meta` | 队列元信息 (progress/paused 等) |
| String | `bull:email:id` | 任务 ID 计数器 |
| ZSet | `bull:email:delayed` | 延迟任务 |
| ZSet | `bull:email:priority` | 优先级队列 |
| Hash | `bull:email:job:<id>` | 具体任务的详细数据 |

### 监控查询

```bash
# 等待队列深度 (待发送邮件数)
docker exec globalreach-redis redis-cli LLEN bull:email:wait

# 正在处理的任务数 (当前并发)
docker exec globalreach-redis redis-cli LLEN bull:email:active

# 已完成任务数
docker exec globalreach-redis redis-cli LLEN bull:email:completed

# 失败任务数
docker exec globalreach-redis redis-cli LLEN bull:email:failed

# 队列是否暂停
docker exec globalreach-redis redis-cli HGET bull:email:meta paused

# 总入队任务数 (自上次清空以来)
docker exec globalreach-redis redis-cli GET bull:email:id
```

---

## 5. 发送速率限制

### 三层速率控制

```
Layer 1: Nginx 限流 (50r/s per IP) — 不影响内部发送
    │
Layer 2: API 全局限流 (30000 req / 15min) — 不影响内部发送
    │
Layer 3: 邮件发送速率限制 (SEND_RATE_LIMIT = 3 封信/秒)
    │
    ▼
  ┌─────────────────────────────┐
  │  SendWorker 内部令牌桶/滑动窗口  │
  │  每 IP/Account 独立计数       │
  │  默认: 3 封信/秒/Provider      │
  └─────────────────────────────┘
```

### Provider 级别限制

| Provider | 默认日限额 | 默认时限额 | 配置位置 |
|----------|-----------|-----------|---------|
| QQ Mail | 100 (daily_limit) | 20 (hourly_limit) | email_accounts.daily_limit / hourly_limit |
| Gmail | 由 Google 配置决定 | — | Google Admin Console |
| Outlook | 由 MSFT 配置决定 | — | Microsoft 365 Admin |
| Custom | 自定义 | 自定义 | email_accounts 字段 |

### 调整方法

修改 `.env` 或 `docker-compose.prod.yml` 中的环境变量:

```bash
SEND_CONCURRENCY=10      # 并发数 (默认 5)
SEND_MAX_RETRIES=5       # 最大重试 (默认 3)
SEND_RETRY_DELAY=2000    # 重试间隔 ms (默认 1000)
SEND_RATE_LIMIT=5        # 每秒发送上限 (默认 3)
WORKER_POLL_INTERVAL=200 # Worker 轮询 ms (默认 500)
```

修改后需要 `restart api` 生效。

---

## 6. 退信/弹回处理 (Bounce Handling)

### 退信类型

| 类型 | 说明 | 处理策略 |
|------|------|---------|
| Hard Bounce | 邮箱不存在/域名无效 | 标记 Client 状态为 CHURNED，停止发送 |
| Soft Bounce | 邮箱满/临时不可达 | 延迟重试 (指数退避) |
| Complaint | 收件人投诉垃圾邮件 | 标记 UNSUBSCRIBED，移除目标列表 |
| Blocklisted | IP/域名被列入黑名单 | 切换 Provider 或降低发送速率 |

### 退信处理流程

```
Provider 退信通知
    │
    ▼
emailService 接收回调/Webhook
    │
    ├── Hard Bounce → clients.status = CHURNED
    ├── Soft Bounce → 加入延迟重试队列
    ├── Complaint → clients.status = UNSUBSCRIBED
    └── Blocklist → 降低该 Account 的 health_score, 切换 Provider
```

### 退信相关数据库字段

- `emails.bounced_reason` — 退信原因文本
- `emails.error_message` — 错误详情
- `emails.status` = `'BOUNCED'` 或 `'FAILED'`
- `email_accounts.health_score` — 账号健康分 (初始 100)

---

## 7. Mailpit 测试用法

### Mailpit 是什么

Mailpit 是一个轻量级的 SMTP 测试服务器，用于开发和测试环境：
- 接收所有发出的邮件（不真正投递到外部）
- 提供 Web UI (http://localhost:8025) 查看邮件内容
- 支持 API 操作 (CRUD 邮件)
- 支持 Link Tracking 和邮件渲染预览

### 在 GlobalReach 中的作用

当前 AlertManager 的 SMTP 配置指向 Mailpit:
```
ALERTMANAGER_SMTP_SMARTHOST: mailpit:1025
```
这意味着**告警邮件会被 Mailpit 截获**而非真正发出。
生产环境应替换为真实 SMTP relay (如 QQ Mail SES、SendGrid 等)。

### 常用操作

```bash
# 查看收件箱邮件数量
curl -sf http://localhost:8025/api/messages | jq '.Messages | length'

# 查看最新的 5 封邮件 (摘要)
curl -sf http://localhost:8025/api/messages?limit=5 | jq '.Messages[] | {ID, Subject, From, To, Created}'

# 查看某封邮件的完整内容 (HTML)
curl -sf http://localhost:8025/api/message/<MESSAGE_ID> | jq '.HTML'

# 查看原始 RFC2822 内容
curl -sf http://localhost:8025/api/message/<MESSAGE_ID>/raw

# 下载附件
curl -sfO http://localhost:8025/api/message/<MESSAGE_ID>/attachment/<ATTACH_ID>

# 删除所有邮件
curl -sf -X DELETE http://localhost:8025/api/messages

# 搜索邮件
curl -sf "http://localhost:8025/api/messages?search=test&limit=10" | jq '.Messages[] | {Subject}'

# Web UI: http://localhost:8025
# - 实时刷新的收件箱视图
# - 邮件 HTML 渲染预览
# - 原始 Source 查看
# - 附件下载
```

### 从 Mailpit 转发真实邮件

```bash
# Mailpit 不内置转发功能，但可以通过 API 读取后用脚本转发
# 示例: 读取最新邮件并通过真实 SMTP 发送
MESSAGE_ID=$(curl -sf http://localhost:8025/api/messages | jq -r '.Messages[0].ID')
RAW_EMAIL=$(curl -sf "http://localhost:8025/api/message/$MESSAGE_ID/raw")
echo "$RAW_EMAIL" | sendmail -t  # 需要本地 MTA
```

---

## 8. 健康检查清单

- [ ] **API 服务运行**: `docker ps \| grep globalreach-api-prod` — Up
- [ ] **Redis 可用**: `docker exec globalreach-redis redis-cli ping` → PONG
- [ ] **Worker 运行**: API 启动日志中有 `[Pipeline] SendWorker started`
- [ ] **队列非阻塞**: wait 队列在合理范围内 (非无限增长)
- [ ] **无大量失败**: failed 队列增长缓慢或为零
- [ ] **SMTP Provider 可达**: 能连接到 QQ Mail SMTP (smtp.qq.com:465)
- [ ] **Mailpit 运行** (测试环境): `curl -sf http://localhost:8025/api/messages` 正常返回
- [ ] **发送速率正常**: QPS ≈ SEND_RATE_LIMIT (3/s) × 并发数
- [ ] **Campaign 状态更新**: SENDING 状态的 Campaign 有进度推进
- [ ] **退信率低**: BOUNCED/FAILED 邮件占比 < 5%

---

## 9. 故障排查场景

### 场景 1: 邮件完全发不出

**症状**: Campaign 状态停在 SENDING，但没有任何邮件变为 SENT

**可能原因**:
1. SendWorker 未启动或崩溃
2. Redis 不可用 (队列无法操作)
3. SMTP Provider 不可达 (DNS/网络/认证)
4. 队列被暂停
5. 所有 EmailAccount 状态非 ACTIVE

**诊断步骤**:
```bash
# 1. 确认 Worker 运行
docker logs --since=10m globalreach-api-prod 2>&1 | grep -iE "(Worker|SendWorker|started|stopped|crash)"

# 2. Redis 连通性和队列状态
docker exec globalreach-redis redis-cli ping
docker exec globalreach-redis redis-cli SCAN 0 MATCH "*queue*" COUNT 10
docker exec globalreach-redis redis-cli SCAN 0 MATCH "bull:*" COUNT 10

# 3. SMTP 连接测试 (通过 Mailpit)
curl -sf http://localhost:8025/api/messages | jq '.Messages | length'
# 或者直接测试 QQ Mail SMTP
docker exec globalreach-api-prod sh -c "echo > /dev/tcp/smtp.qq.com/465" && echo "OK" || echo "FAIL"

# 4. 检查 EmailAccount 状态
curl -sf http://localhost:3000/api/v1/accounts | jq '.[] | select(.status!="ACTIVE") | {id, platform, status}'

# 5. 检查 API 日志中的发送错误
docker logs --since=30m globalreach-api-prod 2>&1 | grep -iE "(smtp|send.*fail|email.*error|ECONNREFUSED|auth)"
```

**解决方案**:
- Worker 未启动 → 重启 API 容器
- Redis 不可用 → 先恢复 Redis (RB-003)
- SMTP 不可达 → 检查网络/DNS/认证凭据
- 账号非 ACTIVE → 在前端或 API 中激活账号

---

### 场景 2: 发送速度极慢

**症状**: Campaign 发送进度推进非常缓慢

**可能原因**:
1. SEND_RATE_LIMIT 设置过低 (默认 3/s)
2. SEND_CONCURRENCY 设置过低 (默认 5)
3. SMTP Provider 响应慢 (网络延迟)
4. 模板渲染耗时 (复杂模板)
5. DB 写入瓶颈 (每封邮件都要更新 emails 表)

**诊断步骤**:
```bash
# 1. 检查当前配置
docker exec globalreach-api-prod env | grep -E "(SEND_|WORKER_)"

# 2. 观察 Worker 日志中的发送间隔
docker logs --since=5m globalreach-api-prod 2>&1 | grep -iE "(send|job.*complete|processed)" | tail -20

# 3. 检查队列出队速度
# 先记录当前 completed 数量，等 30 秒再看差值
docker exec globalreach-redis redis-cli LLEN bull:email:completed
sleep 30
docker exec globalreach-redis redis-cli LLEN bull:email:completed

# 4. SMTP 响应时间
# 在 API 日志中查找 SMTP 交互耗时
docker logs --since=5m globalreach-api-prod 2>&1 | grep -i "duration\|elapsed\|smtp.*time"
```

**解决方案**:
- 限流过低 → 调大 SEND_RATE_LIMIT 和 SEND_CONCURRENCY
- Provider 慢 → 切换更快的 Provider 或增加并发
- 模板慢 → 简化模板或预编译
- DB 瓶颈 → 批量写入优化

---

### 场景 3: 大量邮件进入 failed 队列

**症状**: failed 队列快速增长，completed 增长缓慢

**可能原因**:
1. SMTP 认证失败 (密码过期/token 失效)
2. Provider 临时限流 (超出发送配额)
3. 收件人地址无效 (Hard Bounce)
4. 邮件内容被 Provider 拒绝 (垃圾邮件检测)
5. 网络不稳定导致间歇性超时

**诊断步骤**:
```bash
# 1. 查看 failed 队列大小及增长趋势
docker exec globalreach-redis redis-cli LLEN bull:email:failed

# 2. 查看 API 日志中的失败原因
docker logs --since=30m globalreach-api-prod 2>&1 | grep -iE "(fail|reject|bounce|auth.*error|invalid|quota|rate.*limit)"

# 3. 检查最近的 ErrorLog 记录
# 通过 API 查询
curl -sf "http://localhost:3000/api/v1/audit?severity=ERROR&limit=10" | jq '.[].details'

# 4. 检查 EmailAccount 的 health_score
curl -sf http://localhost:3000/api/v1/accounts | jq '.[] | {platform, healthScore, status}'

# 5. Mailpit 中查看被拒邮件的原因
curl -sf http://localhost:8025/api/messages | jq '.Messages[-3:]'
```

**解决方案**:
- 认证失败 → 更新 OAuth token 或应用密码
- 限流 → 降低发送速率或切换 Provider
- 地址无效 → 清洗客户列表
- 垃圾邮件检测 → 优化邮件内容和发件人信誉度
- 网络问题 → 检查网络稳定性和 DNS 解析

---

### 场景 4: 邮件队列积压不消费

**症状**: wait 队列持续增长，active 队列为空或不增长

**可能原因**:
1. SendWorker 进程死锁或卡住
2. Redis 连接断开 (Worker 与 Redis 失联)
3. 队列被意外暂停 (paused=true)
4. Bull 的锁机制阻塞
5. Worker 的 pollInterval 异常

**诊断步骤**:
```bash
# 1. 队列状态全景
echo "=== wait ===" && docker exec globalreach-redis redis-cli LLEN bull:email:wait
echo "=== active ===" && docker exec globalreach-redis redis-cli LLEN bull:email:active
echo "=== paused ===" && docker exec globalreach-redis redis-cli HGET bull:email:meta paused
echo "=== failed ===" && docker exec globalreach-redis redis-cli LLEN bull:email:failed

# 2. Worker 最后活动时间
docker logs globalreach-api-prod 2>&1 | grep -i "job.*process\|send.*complete\|worker.*poll" | tail -5

# 3. Redis 连接状态 (从 API 容器视角)
docker exec globalreach-api-prod sh -c "echo > /dev/tcp/redis/6379" && echo "OK" || echo "FAIL"

# 4. 检查 Bull 锁 key
docker exec globalreach-redis redis-cli TYPE bull:email:lock
docker exec globalreach-redis redis-cli TTL bull:email:lock
```

**解决方案**:
- Worker 卡住 → 重启 API 容器
- Redis 断连 → 恢复 Redis 连接
- 队列暂停 → 通过 API 或 Redis 命令恢复
- 锁阻塞 → 手动删除过期的 lock key (谨慎操作!)

---

### 场景 5: 邮件内容乱码或格式错误

**症状**: 收件人收到的邮件显示乱码、布局错乱或图片不显示

**可能原因**:
1. 编码问题 (UTF-8 vs ISO-8859-1)
2. HTML 模板中的相对路径图片
3. Content-Type header 不正确
4. CSS inline 化不完整 (邮件客户端不支持 `<style>`)
5. Base64 编码附件损坏

**诊断步骤**:
```bash
# 1. 在 Mailpit 中查看邮件原始源码
# 打开 http://localhost:8025 → 点击邮件 → Raw Source

# 2. 通过 API 查看
MESSAGE_ID=$(curl -sf http://localhost:8025/api/messages | jq -r '.Messages[0].ID')
curl -sf "http://localhost:8025/api/message/$MESSAGE_ID/raw" | head -50

# 3. 检查 Content-Type 和编码头
curl -sf "http://localhost:8025/api/message/$MESSAGE_ID/raw" | grep -iE "(content-type|charset|encoding)"

# 4. 检查模板文件
cat api/templates/*.hbs | head -30
```

**解决方案**:
- 编码问题 → 确保 UTF-8 编码，设置正确的 charset=UTF-8
- 图片问题 → 使用绝对 URL (CDN)，避免 base64 内联大图
- CSS 问题 → 使用 inline-css 工具预处理模板
- 附件问题 → 检查 MIME 编码

---

### 场景 6: Campaign 进度卡住

**症状**: Campaign 状态为 SENDING 但进度百分比不变

**可能原因**:
1. 所有待发送任务已完成但状态未更新为 COMPLETED
2. Campaign 的 stats 字段未正确更新
3. 数据库事务未提交
4. 前端 SSE (Server-Sent Events) 连接断开导致进度不刷新

**诊断步骤**:
```bash
# 1. 检查 Campaign 当前状态
curl -sf http://localhost:3000/api/v1/campaigns | jq '.[] | select(.status=="SENDING") | {id, name, stats}'

# 2. 检查对应的 emails 表统计
# 通过 API 或直接查 DB
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT status, count(*) FROM emails WHERE campaign_id='<campaign_id>' GROUP BY status;"

# 3. 检查队列是否还有残留任务
docker exec globalreach-redis redis-cli SCAN 0 MATCH "*<campaign_id>*" COUNT 20

# 4. 检查 SSE 端点
curl -sf -N http://localhost:3000/api/v1/progress/<campaign_id> | head -10
```

**解决方案**:
- 队列空但状态未更新 → 手动调用 Campaign 完成逻辑或重启 API
- stats 未更新 → 检查 Campaign 更新逻辑的事务处理
- SSE 断开 → 刷新前端页面重新建立连接

---

## 10. 关键指标基线

| 指标 | 正常范围 | 警告阈值 | 严重阈值 | 说明 |
|------|---------|---------|---------|------|
| 发送吞吐量 | ≈ RATE_LIMIT×CONCURRENCY | < 50% 预期 | < 10% 预期 | 封信/秒 |
| 队列积压 (wait) | < 100 | > 500 | > 2000 | 待处理任务数 |
| 失败率 | < 1% | > 5% | > 20% | failed/(completed+failed) |
| 退信率 | < 0.1% | > 1% | > 5% | bounced/total_sent |
| Provider 延迟 (P99) | < 5s | > 15s | > 30s | SMTP 交互时间 |
| 模板渲染时间 | < 100ms | > 500ms | > 2s | TemplateEngine 耗时 |
| Campaign 完成时间 | 按规模预期 | > 2x 预期 | > 5x 预期 | 全部发送完成 |
| Account 健康分 | > 80 | < 60 | < 30 | health_score (0-100) |

### 告警对照

| 告警名 | 条件 | 对应场景 |
|--------|------|---------|
| EmailQueueCritical | 队列深度严重异常 | 场景 1/4 |
| EmailQueueBacklog | 队列积压过高 | 场景 4 |
| HighErrorRate | API 5xx 错误率 > 10% | 场景 1 (如果涉及 API) |

---

## 11. 相关资源

### 关联 Runbook
- [RB-001 API 服务运行手册](RB-001_API_SERVICE.md) — Worker 所在进程
- [RB-003 Redis 运行手册](RB-003_REDIS.md) — 队列存储后端
- [RB-004 Nginx 运行手册](RB-004_NGINX.md) — 外部访问入口

### 关联决策树
- [TT-002 邮件发送失败](../troubleshooting-trees/TT-002_EMAIL_DELIVERY_FAILURE.md)

### 配置文件
- `api/server.js` — Pipeline 组件初始化 (第 46-76 行)
- `api/queue/emailQueue.js` — EmailQueue 实现
- `api/workers/sendWorker.js` — SendWorker 实现
- `api/templates/templateEngine.js` — 模板引擎
- `api/services/emailService.js` — 邮件发送服务
- `docker-compose.prod.yml` — SMTP/队列环境变量 (第 77-92 行)

### Grafana 仪表盘
- Email Pipeline Overview (队列深度/吞吐量/失败率/延迟分布)
- Campaign Performance (发送进度/打开率/点击率/退信率)
