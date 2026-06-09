# GlobalReach V2.0 事件响应标准操作程序 (Incident Response SOP)

> **文档版本**: v1.0.0
> **创建日期**: 2026-06-09
> **项目**: GlobalReach V2.0 企业级邮件营销平台
> **模块**: S132/O07 团队协作工作流 — 事件响应
> **状态**: 正式发布
> **配合文档**: `docs/oncall/ONCALL_HANDBOOK.md` (值班手册)

---

## 目录

- [1. 总体框架](#1-总体框架)
  - [1.1 事件响应时间线总览](#11-事件响应时间线总览)
  - [1.2 事件生命周期定义](#12-事件生命周期定义)
  - [1.3 与其他系统的集成关系](#13-与其他系统的集成关系)
- [2. 场景一：API 服务崩溃](#2-场景一api-服务崩溃)
- [3. 场景二：PostgreSQL 数据库故障](#3-场景二postgresql-数据库故障)
- [4. 场景三：Redis 异常](#4-场景三redis-异常)
- [5. 场景四：Nginx 宕机](#5-场景四nginx-宕机)
- [6. 场景五：磁盘空间耗尽](#6-场景五磁盘空间耗尽)
- [7. 场景六：安全事件](#7-场景六安全事件)
- [8. 升级决策树](#8-升级决策树)
- [9. 通信模板](#9-通信模板)
- [附录](#附录)

---

## 1. 总体框架

### 1.1 事件响应时间线总览

```
T+0min   ┃─ 🚨 告警触发 → On-call 接收告警通知
            │  来源: AlertManager / AIOps (O01) / O05 风险评分
            │  渠道: P0→电话+SMS+IM | P1→IM+Email | P2/P3→Email
            ▼
T+5min   ┃─ 📋 初步确认 → 判定严重级别 → 内部通报
            │  动作: ACK 告警 → 创建事件记录 → 发送初始通报
            │  输出: 事件 INC-{编号}, 级别 P{0-3}, 指派 Primary
            ▼
T+15min  ┃─ 🔍 诊断定位 → 使用决策树(TT)缩小范围
            │  工具: TT-001~006 + RB-001~007 + FMB 故障模式匹配
            │  输出: 根因假设, 影响范围评估, 推荐修复方案
            ▼
T+30min  ┃─ ⚡ 实施修复 → 执行Runbook(RB)操作步骤
            │  策略: 先恢复服务(止血) → 再根因修复(治本)
            │  安全: L1/L2自动执行, L3+需审批, 记录所有操作
            ▼
T+60min  ┃─ ✅ 效果验证 → 巡检引擎(O03)确认恢复
            │  验证: health check + 关键指标回归 + 用户抽样测试
            │  工具: O03 巡检引擎 / Grafana Dashboard / 手动测试
            ▼
T+90min  ┃─ 📝 根因分析 → 更新FMB故障模式库
            │  动作: Five Whys 分析 → 匹配/新增 FMB 条目
            │  输出: 根因报告草案, 知识更新建议
            ▼
T+120min ┃─ 📋 复盘准备 → Post-Mortem草稿
            │  动作: 整理 timeline → 初步改进措施 → 安排复盘会议
            │  条件: P0 必须, P1 建议, P2/P3 可选
            ▼
T+24h    ┃─ 🔄 复盘会议 → 行动项分配 → 知识闭环
            │  流程: Blameless Post-Mortem → 行动项追踪 → 文档更新
            │  输出: Post-Mortem Report, Action Items, 知识库更新
```

### 1.2 事件生命周期定义

```
                    ┌──────────────┐
                    │   DETECTED    │ ← 告警触发 / 用户报告 / 巡检发现
                    │   (已检测)     │
                    └──────┬───────┘
                           │ Primary ACK
                           ▼
                    ┌──────────────┐
                    │   ACKNOWLEDGED│ ← 已确认，Primary 开始处理
                    │   (已确认)     │
                    └──────┬───────┘
                           │ 诊断开始
                           ▼
                    ┌──────────────┐
                    │ INVESTIGATING │ ← 正在诊断根因
                    │   (调查中)     │
                    └──────┬───────┘
                           │ 根因确定
                           ▼
                    ┌──────────────┐
                    │   IDENTIFIED  │ ← 根因已识别
                    │   (已识别)     │
                    └──────┬───────┘
                           │ 修复执行
                           ▼
                    ┌──────────────┐
                    │   RESOLVING   │ ← 正在实施修复
                    │   (修复中)     │
                    └──────┬───────┘
                           │ 验证通过
                           ▼
                    ┌──────────────┐
                    │   MONITORING  │ ← 观察期（防止回退）
                    │   (观察中)     │
                    └──────┬───────┘
                           │ 观察期满无异常
                           ▼
                    ┌──────────────┐
                    │   RESOLVED    │ ← 事件关闭
                    │   (已解决)     │
                    └──────┬───────┘
                           │ Post-Mortem 完成
                           ▼
                    ┌──────────────┐
                    │    CLOSED     │ ← 完全归档
                    │   (已关闭)     │
                    └──────────────┘

异常分支:
  INVESTIGATING ──需要更多时间──▶ WAITING (等待信息/资源)
  RESOLVING    ──遇到阻塞───────▶ BLOCKED (阻塞)
  MONITORING   ──问题重现───────▶ REOPENED (重新打开) → INVESTIGATING
 任意状态      ──误报/取消──────▶ CANCELLED (取消)
```

### 1.3 与其他系统的集成关系

| 时间节点 | 使用系统 | 具体操作 |
|---------|---------|---------|
| T+0 | O01 AIOps | 接收降噪后的结构化告警 |
| T+0 | O05 风险评分 | 获取当前系统风险等级作为参考 |
| T+5 | Team API | 创建事件记录 (`POST /api/v1/team/incidents`) |
| T+15 | TT-001~006 | 使用决策树进行诊断导航 |
| T+15 | FMB (22条) | 匹配已知故障模式 |
| T+30 | RB-001~007 | 执行 Runbook 中的标准修复步骤 |
| T+60 | O03 巡检引擎 | 运行自动化巡检验证恢复效果 |
| T+90 | FMB | 新增或更新故障模式条目 |
| T+120 | Team API | 创建复盘报告 (`POST /api/v1/team/postmortems`) |

---

## 2. 场景一：API 服务崩溃

### 2.1 场景特征

**典型症状**：
- 所有 API 请求返回 502 / 503 / 504
- Grafana 显示 API Health 为 DOWN
- AlertManager 触发 `APIDown` (critical) 和 `HighErrorRate` (critical)
- 用户无法登录、无法创建 Campaign、无法查看报表

**影响范围**：全平台核心功能不可用（P0-Critical）

**关联故障模式**：FM-APP-001 (DB连接池耗尽), FM-APP-004 (内存泄漏), FM-CAL-002 (OOMKilled), FM-CAL-003 (进程崩溃)

**首选决策树**：TT-001 (API响应慢) → 分支A (服务不可用)

**首选 Runbook**：RB-001 (API服务运行手册)

### 2.2 详细 T+n 时间线

```
═══ 场景一: API 服务崩溃 (P0-Critical) ═══

T+0min  ┃─ 🚨 告警触发
         │  APIDown (critical) + HighErrorRate (critical) 同时 firing
         │  AIOps 可能同时聚合: APIHealthCritical, APILatencyP50Elevated,
         │                  APIMemoryPressure, ContainerRestartLoop
         │  通知渠道: 电话 + SMS + IM 三通道推送 Primary
         │
         │  ✅ 动作:
         │    1. 接听电话/查看 IM，确认告警内容
         │    2. 快速扫一眼 Status Page 确认不是误报
         │
T+2min  ┃─ 📞 确认与 ACK
         │  ✅ 动作:
         │    1. 在 AlertManager 中 ACK 所有相关告警
         │    2. 在团队 IM 频道发送: "🚨 已接手 API Down 事件，正在诊断"
         │    3. 通过 Team API 创建事件: POST /api/v1/team/incidents
         │       { title: "API 服务崩溃", severity: "P0", status: "acknowledged" }
         │
T+5min  ┃─ 🔍 初步诊断 — 容器层面
         │  ✅ 命令:
         │    docker ps -a --filter name=globalreach-api
         │
         │  📊 结果判断:
         │    ├─ 状态 "Up" → 进入 2.2.1 (进程存活但异常)
         │    ├─ 状态 "Restarting" → 进入 2.2.2 (崩溃循环)
         │    ├─ 状态 "Exited" → 进入 2.2.3 (进程退出)
         │    └─ 状态 "Created" 但未启动 → docker start
         │
         ├── 2.2.1 进程存活但异常 ────────────────────────────────
         │  ✅ 命令:
         │    # 检查健康检查端点
         │    curl -sf http://localhost:3000/health | jq .
         │
         │    # 检查最近日志
         │    docker logs --tail 100 globalreach-api 2>&1 | grep -iE "error|fatal|reject"
         │
         │    # 检查资源使用
         │    docker stats --no-stream globalreach-api
         │
         │  🎯 常见原因及处理:
         │    ├─ DB 连接失败 → 转 RB-001 场景 3 (DB连接失败)
         │    ├─ Redis 连接超时 → 转 RB-001 场景 4 (Redis异常)
         │    ├─ 内存接近 OOM → 转 TT-003 (高内存使用率)
         │    └─ 端口被占用/listen 失败 → 检查端口冲突
         │
         ├── 2.2.2 崩溃循环 (Restarting) ─────────────────────────
         │  ✅ 命令:
         │    # 查看重启次数和错误日志
         │    docker logs --tail 200 globalreach-api 2>&1 | tail -80
         │
         │  🎯 进入 TT-004 (容器崩溃循环) 决策树
         │  📖 参考 FM-CAL-003 (进程崩溃)
         │
         │  常见快速修复:
         │    ├─ OOMKilled → 先清理临时文件/日志, 增加 memory limit
         │    ├─ Uncaught Exception → 查看堆栈跟踪, 如需紧急恢复先 restart
         │    └─ 启动配置错误 → 检查 .env / 环境变量
         │
         └── 2.2.3 进程退出 (Exited) ────────────────────────────
            ✅ 命令:
              # 尝试启动并观察
              docker start globalreach-api && sleep 10 && docker logs --tail 30 globalreach-api
            
            # 如果立即退出, 查看完整退出日志
            docker logs globalreach-api 2>&1 | grep -iE "error|fatal|exit|signal"

T+15min ┃─ 📋 深入诊断 — 依赖链检查
         │  ✅ 命令 (并行执行):
         │
         │    # PostgreSQL 连通性
         │    docker exec postgresql pg_isready -h localhost -p 5432 -U globalreach_user
         │
         │    # Redis 连通性
         │    docker exec redis redis-cli ping
         │
         │    # Nginx 到 API 的连通性
         │    curl -sI http://localhost/api/health 2>&1 | head -5
         │
         │  🎯 决策路径 (TT-001):
         │    ├─ DB 不通 → 主因在 PostgreSQL → 转【场景二】
         │    ├─ Redis 不通 → 主因在 Redis → 转【场景三】
         │    ├─ Nginx 不通 → 主因在 Nginx → 转【场景四】
         │    └─ 全部正常 → 问题在 API 自身 → 继续 RB-001 深入排查
         │
T+25min ┃─ ⚡ 实施修复
         │  根据 T+5 ~ T+15 的诊断结果选择修复策略:
         │
         │  📖 按优先级排序:
         │    1. 【最快恢复】docker restart globalreach-api
         │       → 适用: 瞬态错误 / 内存泄漏 / 未知异常
         │       → 参考: RB-001 场景 8 (容器异常重启)
         │       ⚠️ 注意: 这是 L2 自愈动作, 白名单允许
         │
         │    2. 【针对性修复】按 Runbook 步骤操作
         │       → DB 问题: RB-002 对应场景
         │       → Redis 问题: RB-003 对应场景
         │       → 配置问题: 修改 .env 后 restart
         │
         │    3. 【降级模式】如修复需较长时间
         │       → 启用 Nginx maintenance page
         │       → 参考: RB-004 场景 6 (维护页面)
         │
         │  ✅ 所有操作必须记录到事件 timeline:
         │    POST /api/v1/team/incidents/:id/comment
         │    { "content": "[T+25] 执行 docker restart globalreach-api, 原因: OOMKilled", "author": "primary" }
         │
T+40min ┃─ ✅ 效果验证
         │  ✅ 自动化验证 (O03 巡检引擎):
         │    ./scripts/health-inspection.sh
         │    → 期望: API 维度得分 > 80/100
         │
         │  ✅ 手动验证清单:
         │    ├─ [ ] curl http://localhost:3000/health → {"status":"healthy"}
         │    ├─ [ ] Grafana API Error Rate < 0.1%
         │    ├─ [ ] Grafana API P95 Latency < 500ms
         │    ├─ [ ] 登录功能测试 (用户名密码登录)
         │    ├─ [ ] Campaign 列表加载
         │    └─ [ ] 邮件发送测试 (小规模)
         │
T+55min ┃─ 📝 事件更新与通报
         │  ✅ 动作:
         │    1. 更新事件状态为 resolved:
         │       PATCH /api/v1/team/incidents/:id { "status": "resolved", "resolvedAt": "..." }
         │
         │    2. 发送恢复通知到 IM 频道:
         │       "✅ INC-XXX API服务崩溃 已恢复 (T+55min)"
         │
         │    3. 如有用户影响, 准备外部通知 (参见通信模板)
         │
T+90min ┃─ 🔬 根因分析
         │  ✅ 动作:
         │    1. Five Whys 分析 (至少深入 3 层)
         │    2. 匹配 FMB 条目 (docs/failure-modes/FailureModeBase.md)
         │    3. 如发现新模式, 记录待新增项
         │
T+120min┃─ 📋 复盘准备 (P0 必须)
         │  ✅ 动作:
         │    1. 整理完整 timeline
         │    2. 起草 Post-Mortem 报告 (使用 ONCALL_HANDBOOK 第五章模板)
         │    3. 提交到 Team API:
         │       POST /api/v1/team/postmortems { ... }
         │    4. 安排复盘会议 (24h 内)
```

### 2.3 快速诊断决策树（API 崩溃）

```
docker ps -a | grep api
    │
    ├── "Up" (运行中)
    │   └── curl /health 失败?
    │       ├── 是 → 检查日志 (docker logs) → 错误类型?
    │       │   ├── ECONNREFUSED DB → RB-001 场景 3
    │       │   ├── Redis timeout → RB-001 场景 4
    │       │   ├── port in use → lsof -i :3000
    │       │   └── heap OOM → TT-003 → RB-001 场景 5
    │       └── 否 → 可能是 Nginx 问题 → 检查 RB-004
    │
    ├── "Restarting" (重启循环)
    │   └── docker logs | tail -50 → 退出原因?
    │       ├── OOMKilled (exit code 137) → 内存不足
    │       │   ├── 清理空间 → restart
    │       │   └── 增加 memory limit → restart
    │       ├── Exit 1 + error stack → 应用异常
    │       │   ├── 查看是否可快速修复 → 修复后 restart
    │       │   └── 无法快速修复 → 回滚到上一版本
    │       └── Signal 15 (SIGTERM) → 外部停止
    │           └── docker start → 观察
    │
    └── "Exited" (已停止)
        └── docker start → 观察是否存活?
            ├── 是 → 同 "Up" 分支排查
            └── 否 → 同 "Restarting" 分支排查
```

---

## 3. 场景二：PostgreSQL 数据库故障

### 3.1 场景特征

**典型症状**：
- API 日志大量出现 `ECONNREFUSED`, `connection refused`, `too many clients`
- AlertManager 触发 `PostgresConnectionHigh` (warning/critical)
- 所有依赖 DB 的功能全部异常（登录、Campaign CRUD、报表）
- Redis 中可能有缓存数据但无法持久化新数据

**影响范围**：全平台数据读写功能不可用（P0-Critical）

**关联故障模式**：FM-STO-001 (磁盘满导致PG不可用), FM-STO-003 (数据文件损坏), FM-APP-001 (连接池耗尽), FM-NET-001 (DNS解析失败)

**首选决策树**：TT-001 (分支: DB延迟/不可用), TT-006 (数据不一致)

**首选 Runbook**：RB-002 (PostgreSQL 运行手册)

### 3.2 详细 T+n 时间线

```
═══ 场景二: PostgreSQL 数据库故障 (P0-Critical) ═══

T+0min  ┃─ 🚨 告警触发
         │  PostgresConnectionHigh (warning→critical)
         │  可能伴随: APIDown, HighErrorRate, EmailQueueBacklog
         │  通知: 电话 + SMS + IM (P0 三通道)
         │
T+3min  ┃─ 📋 ACK 与初步判断
         │  ✅ 动作:
         │    1. ACK 告警, 创建事件 (severity: P0)
         │    2. 发送: "🚨 已接手 PG 故障事件, 正在诊断"
         │
T+8min  ┃─ 🔍 PG 层面诊断
         │  ✅ 命令:
         │
         │    # PG 进程状态
         │    docker exec postgresql pg_isready
         │
         │    # PG 连接数
         │    docker exec postgresql psql -U globalreach_user -c \
         │      "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
         │
         │    # 磁盘空间 (PG 数据目录)
         │    docker exec postgresql df -h /var/lib/postgresql/data
         │
         │    # PG 最近日志
         │    docker exec postgresql cat /var/log/postgresql/*.log | tail -50
         │
         │  🎯 结果分支:
         │    ├─ pg_isready 返回 "rejected" → 连接池满 → RB-002 场景 2
         │    ├─ pg_isready 返回 "no response" → PG 进程挂了 → RB-002 场景 1
         │    ├─ 磁盘使用 > 90% → 磁盘满 → 【场景五】联合处理
         │    └─ 日志有 "FATAL" / "PANIC" → 严重错误 → RB-002 场景 5/6
         │
T+20min ┃─ ⚡ 实施修复 (按诊断结果)
         │
         │  📖 策略 A: 连接池耗尽 (最常见)
         │    1. 查看谁占用了连接:
         │       SELECT * FROM pg_stat_activity WHERE state = 'active' ORDER BY query_start;
         │    2. 终止长时间空闲连接 (谨慎!):
         │       SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
         │        WHERE state = 'idle' AND query_start < NOW() - INTERVAL '30 minutes';
         │    3. 如仍不够, 临时增加 max_connections (需 restart PG):
         │       编辑 postgresql.conf → max_connections = 200 (临时)
         │       ⚠️ PG restart 会导致短暂中断 (~5-10s)
         │
         │  📖 策略 B: PG 进程崩溃
         │    1. 查看 crash 原因 (日志中的 FATAL 信息)
         │    2. 尝试 restart: docker restart postgresql
         │    3. 等待 recovery 完成 (WAL replay, 约 1-5 分钟)
         │    4. 验证: pg_isready + select 1
         │    ⚠️ 绝对不要手动删除 data 目录!
         │
         │  📖 策略 C: 数据损坏 (严重!)
         │    1. 立即停止写入: 停止 API 容器 (防止脏写)
         │    2. 从最近备份恢复: ./scripts/restore.sh
         │    3. 恢复后验证数据完整性
         │    4. 此情况必须升级到 L2 Tech Lead
         │
T+35min ┃─ ✅ 验证恢复
         │  ✅ 验证清单:
         │    ├─ [ ] pg_isready 返回 "accepting connections"
         │    ├─ [ ] psql -c "select 1;" 成功
         │    ├─ [ ] API /health 返回 healthy
         │    ├─ [ ] 用户可以登录
         │    ├─ [ ] Campaign 数据可读写
         │    └─ [ ] O03 巡检通过
         │
T+45min ┃─ 📝 关闭事件 + 通报
T+90min ┃─ 🔬 根因分析 (重点: 为什么连接池会耗尽?)
         │  常见根因:
         │  • 连接泄漏 (代码 bug: 未释放连接) → 需要代码修复
         │  • max_connections 设置过低 → 需要容量规划
         │  • 慢查询堆积 → 需要查询优化
         │  • 连接风暴 (流量突增) → 需要连接池中间件 (PgBouncer)
```

---

## 4. 场景三：Redis 异常

### 4.1 场景特征

**典型症状**：
- API 响应变慢（缓存未命中导致大量 DB 查询）
- Session 管理异常（用户频繁掉登录）
- 邮件队列处理变慢或停滞
- AlertManager 触发 `RedisMemoryHigh`, `RedisConnectionHigh`

**影响范围**：性能严重降级 / 部分功能不可用（P1-High 或 P0 取决于依赖程度）

**关联故障模式**：FM-STO-002 (Redis持久化失败), FM-APP-005 (缓存击穿), FM-APP-006 (Session风暴)

**首选决策树**：TT-001 (分支: 缓存层异常), TT-006 (数据不一致-缓存与DB)

**首选 Runbook**：RB-003 (Redis 运行手册)

### 4.2 详细 T+n 时间线

```
═══ 场景三: Redis 异常 (P0/P1) ═══

T+0min  ┃─ 🚨 告警触发
         │  RedisMemoryHigh (warning→critical) 或 Redis 连接失败
         │  通知: P0(如果导致全站不可用)→电话 / P1→IM+Email
         │
T+5min  ┃─ 📋 ACK + 创建事件
T+10min ┃─ 🔍 Redis 诊断
         │  ✅ 命令:
         │
         │    # Redis 连通性
         │    docker exec redis redis-cli ping
         │    → PONG = 正常, 无响应 = 服务挂了
         │
         │    # Redis 内存使用
         │    docker exec redis redis-cli INFO memory | grep used_memory_human
         │
         │    # Redis 连接数
         │    docker exec redis redis-cli INFO clients | grep connected_clients
         │
         │    # Redis 持久化状态
         │    docker exec redis redis-cli INFO persistence
         │
         │    # Big keys 检查 (可能导致阻塞)
         │    docker exec redis redis-cli --bigkeys
         │
         │  🎯 分支:
         │    ├─ ping 失败 → Redis 进程问题 → RB-003 场景 1
         │    ├─ 内存 > 85% → 内存压力 → RB-003 场景 2
         │    ├─ connected_clients 过高 → 连接泄漏 → RB-003 场景 5
         │    └─ bigkeys 发现超大 key → 需要清理 → RB-003 场景 3
         │
T+25min ┃─ ⚡ 修复
         │  📖 常用修复:
         │    1. 内存过高 → 清理过期键 (FLUSHDB 危险! 用 SCAN+DEL 逐步清理)
         │    2. Redis 挂了 → docker restart redis (⚠️ 会丢失未持久化数据)
         │    3. 连接过多 → 检查应用端连接池配置
         │
         │  ⚠️ Redis 特殊注意事项:
         │    • FLUSHALL/FLUSHDB 会清除所有数据 — 生产环境禁止!
         │    • Restart 前确认 RDB/AOF 持久化开启
         │    • 如果 Redis 用于 Queue (BullMQ), restart 可能丢失队列任务
         │
T+40min ┃─ ✅ 验证
         │  ├─ [ ] redis-cli ping → PONG
         │  ├─ [ ] API 延迟恢复正常
         │  ├─ [ ] 用户 Session 保持正常
         │  └─ [ ] 邮件队列消费正常
```

---

## 5. 场景四：Nginx 宕机

### 5.1 场景特征

**典型症状**：
- 所有外部请求返回 "Connection Refused"（Nginx 进程不存在）
- 或返回 502 Bad Gateway（Nginx 存活但上游 API 不可用）
- SSL 握手失败
- AlertManager 可能不触发（因为 Nginx 是网关，其自身的监控可能有限）

**影响范围**：所有外部访问不可用（内部直连 API 可能正常）（P0/P1）

**关联故障模式**：FM-NET-003 (TLS证书过期), FM-NET-004 (DNS解析失败), FM-CAL-001 (CPU/负载高)

**首选 Runbook**：RB-004 (Nginx 运行手册)

### 5.2 详细 T+n 时间线

```
═══ 场景四: Nginx 宕机 (P0-Critical) ═══

T+0min  ┃─ 🚨 发现 (可能来自用户报告而非告警)
         │  用户反馈: "网站打不开" / Status Page 显示 DOWN
         │  或: 监控探测失败 (external uptime checker)
         │
T+3min  ┃─ 📋 确认 + ACK + 创建事件
T+8min  ┃─ 🔍 Nginx 诊断
         │  ✅ 命令:
         │
         │    # Nginx 容器/进程状态
         │    docker ps -a --filter name=nginx
         │
         │    # Nginx 配置测试
         │    docker exec nginx nginx -t
         │
         │    # Nginx 错误日志 (最后 50 行)
         │    docker exec nginx tail -50 /var/log/nginx/error.log
         │
         │    # 端口监听
         │    docker exec nginx ss -tlnp | grep :80
         │    docker exec nginx ss -tlnp | grep :443
         │
         │  🎯 分支:
         │    ├─ 容器Exited → docker start nginx → 检查为什么退出
         │    │   └─ nginx -t 失败 → 配置错误 → RB-004 场景 6
         │    ├─ 502 Bad Gateway → 上游(API)问题 → 转场景一
         │    ├─ SSL 错误 → 证书问题 → RB-004 场景 2
         │    └─ 端口未监听 → 绑定冲突 → lsof -i :80
         │
T+20min ┃─ ⚡ 修复
         │  📖 常用修复:
         │    1. docker restart nginx (最快恢复)
         │    2. 配置错误 → 回滚到上一次 working config
         │    3. 证书过期 → 使用 Let's Encrypt 自动续期或手动更新
         │       → 参考 scripts/renew-ssl-certs.sh
         │
T+30min ┃─ ✅ 验证
         │  ├─ [ ] curl https://globalreach.example.com → 200
         │  ├─ [ ] curl http://globalreach.example.com → 301→HTTPS
         │  ├─ [ ] SSL 证书有效 (不报错)
         │  └─ [ ] API 反向代理正常 (→ upstream healthy)
```

---

## 6. 场景五：磁盘空间耗尽

### 6.1 场景特征

**典型症状**：
- 多个组件同时异常（写入失败的连锁反应）
- Docker 日志报错 "No space left on device"
- PG 无法写入 WAL → PG 停止接受连接
- API 无法写日志 → 可能崩溃
- AlertManager 触发 `NodeFileSystemFull` (critical)

**影响范围**：多组件级联故障（P0-Critical）

**关联故障模式**：FM-STO-001 (磁盘空间耗尽)

**首选 Runbook**：RB-006 (Docker Compose 运行手册) 场景 4

### 6.2 详细 T+n 时间线

```
═══ 场景五: 磁盘空间耗尽 (P0-Critical) ═══

T+0min  ┃─ 🚨 NodeFileSystemFull (critical) + 多个组件告警
         │  特征: 级联式告警风暴 (参考 O01 场景一: Cascade Failure)
         │
T+5min  ┃─ 📋 ACK + 识别为磁盘问题 (AIOps 应能聚合为 root cause = disk)
T+10min ┃─ 🔍 磁盘诊断
         │  ✅ 命令:
         │
         │    # 总体磁盘使用
         │    df -h
         │
         │    # 大目录排查 (找出空间占用者)
         │    du -sh /var/lib/docker/* 2>/dev/null | sort -hr | head -10
         │    du -sh /var/log/* 2>/dev/null | sort -hr | head -10
         │
         │    # Docker 磁盘占用详情
         │    docker system df
         │
         │    # Docker 未使用的资源 (可清理)
         │    docker system df -v
         │
         │  🎯 常见占用者:
         │    ├─ Docker 镜像/构建缓存 (最大嫌疑)
         │    ├─ 日志文件 (container logs)
         │    ├─ PG 数据文件/WAL
         │    ├─ Redis RDB/AOF dump
         │    ├─ 备份文件
         │    └─ 临时文件 (/tmp)
         │
T+20min ┃─ ⚡ 紧急释放空间 (按安全顺序)
         │
         │  📖 Step 1: 安全清理 (不影响业务)
         │    # 清理 Docker 未使用的资源
         │    docker system prune -af    # ⚠️ 会删除 stopped containers 和 unused images
         │    # 或更保守:
         │    docker system prune -f     # 只清理 dangling resources
         │
         │    # 清理 Docker 构建缓存
         │    docker builder prune -af
         │
         │  📖 Step 2: 日志清理 (低风险)
         │    # 截断容器日志 (保留最后 1M)
         │    for c in $(docker ps -aq); do truncate -s 1M $(docker inspect --format='{{.LogPath}}' $c); done
         │
         │    # 清理旧日志文件
         │    find /var/log -name "*.gz" -mtime +30 -delete
         │    find /var/log -name "*.log" -size +100M -truncate
         │
         │  📖 Step 3: 应用级清理 (需评估)
         │    # PG WAL 日志归档/清理 (需了解 PG 备份策略)
         │    # Redis 过期键清理 (应自动, 可手动触发)
         │    docker exec redis redis-cli DEBUG OBJECT <key> (检查大key)
         │
         │  📖 Step 4: 扩容 (如果以上都不够)
         │    # 添加新磁盘 / 挂载新卷 / 云盘扩容
         │    # 这通常需要运维团队协助, 可能需要升级
         │
T+35min ┃─ ✅ 验证
         │  ├─ [ ] df -h 显示使用率 < 80%
         │  ├─ [ ] 各容器不再报 "No space left" 错误
         │  ├─ [ ] PG 可以正常写入
         │  └─ [ ] O03 巡检通过
         │
T+45min ┃─ 📝 关闭事件
T+90min ┃─ 🔬 根因 (重要! 为什么磁盘会满?)
         │  常见根因:
         │  • 日志轮转配置缺失 → 配置 logrotate
         │  • Docker 镜像未清理 → 配置定期 prune cron
         │  • PG WAL 未归档 → 配置归档策略
         │  • 备份文件未清理 → 配置备份保留策略
         │  • 某组件异常产生大量日志 → 修复该组件
```

---

## 7. 场景六：安全事件

### 7.1 场景特征

**典型症状**：
- 异常登录尝试 / 暴力破解告警
- 异常 API 调用模式（可能的注入攻击）
- 未知来源的异常流量（可能的 DDoS）
- 数据访问异常（可能的数据泄露）
- AlertManager 触发安全类告警（如有配置）

**影响范围**：取决于攻击类型和成功程度（P0 ~ P1）

**关联故障模式**：FM-SEC-001 (未授权访问), FM-SEC-002 (密钥泄露), FM-SEC-003 (DDoS)

**特殊要求**：安全事件必须升级！不可独自处理。

### 7.2 详细 T+n 时间线

```
═══ 场景六: 安全事件 (P0-P1, 必须升级) ═══

T+0min  ┃─ 🚨 安全告警触发 或 人工发现
         │  来源: 安全扫描工具 / IDS / 异常行为检测 / 用户报告
         │  通知: 电话 + SMS + IM (安全事件默认 P0 待遇)
         │
T+2min  ┃─ 🚨🚨 立即升级 (不同于其他场景!)
         │  ⚠️ 安全事件不在 Primary 独立处理范围内
         │  ✅ 动作:
         │    1. ACK 告警, 创建事件 (severity: P0, tags: ["security"])
         │    2. 立即升级到 L4 (VP Engineering) + Security Team
         │    3. 不要自行尝试"修复" — 可能破坏证据
         │
T+5min  ┃─ 🔒 保护现场 (在 Security Team 指导下)
         │  ✅ 动作 (仅做这些, 不做更多):
         │    1. 不要重启任何服务 (除非确信是攻击导致的且需止血)
         │    2. 不要修改任何配置或代码
         │    3. 保留所有日志 (不要清理/轮转)
         │    4. 记录当前时间戳和观察到的一切
         │    5. 如确认是 active attack 且影响业务:
         │       → 可以考虑封禁攻击 IP (Nginx/防火墙层面)
         │       → 但必须先获得 Security Team 确认
         │
T+15min ┃─ 📋 配合调查 (Security Team 主导)
         │  Primary 角色:
         │    1. 提供系统访问 (受控的, 有审计的)
         │    2. 解释系统架构和数据流
         │    3. 协助提取日志和证据
         │    4. 执行 Security Team 指示的操作
         │
T+30min~ ┃─ ⚡ 修复措施 (Security Team 决定, Primary 执行)
         │  可能的操作:
         │    1. 强制注销所有 Session
         │    2. 轮换所有密钥/凭证 (JWT Secret, DB 密码, API Keys)
         │    3. 封禁恶意 IP / 地区
         │    4. 回滚到攻击前的已知良好版本
         │    5. 修补安全漏洞
         │
T+60min+ ┃─ ✅ 验证 + 长期观察
         │  安全事件的观察期通常更长 (24-72 小时)
         │  确保没有残留的后门或持久化攻击
         │
T+24h   ┃─ 🔄 安全复盘 (必须有法务/合规参与)
         │  • 完整的事件 timeline
         │    • 攻击路径分析
         │    • 数据影响评估 (哪些数据被访问?)
         │    • 合规影响 (GDPR? 网络安全法?)
         │    • 通知义务 (是否需要通知用户/监管机构?)
         │    • 长期安全加固计划
```

### 7.3 安全事件特殊通信模板

```
【🔴 安全事件 — 紧急升级】

⚠️ 检测到潜在安全事件, 立即需要 Security Team 介入!

📋 基本信息:
  - 事件ID: INC-{编号}
  - 发现时间: {YYYY-MM-DD HH:mm}
  - 发现方式: {告警/人工扫描/用户报告}

🔍 初步观察:
  - 异常类型: {未授权访问/暴力破解/异常流量/数据异常/...}
  - 影响范围: {初步评估}
  - 当前状态: {已隔离/正在观察/持续进行中}

🔒 已采取的保护措施:
  - {列举已做的最小化操作}

❌ 尚未做的 (等待指示):
  - 未重启任何服务
  - 未修改任何配置
  - 保留了完整的日志证据

@SecurityTeam @VPEngineering 请立即介入指导!
```

---

## 8. 升级决策树

### 8.1 升级决策流程图

```
收到事件 / 处理中遇到困难
         │
         ▼
   ┌─────────────┐
   │ 能否在 SLA  │
   │ 时限内解决? │
   └──┬──────┬──┘
      │yes   │no
      ▼      ▼
   继续处理   ┌──────────────────┐
             │ 困难类型?          │
             └─┬───┬───┬───┬───┬─┘
               │   │   │   │   │
             技术  时间  权限 带宽  安全
               │   │   │   │   │
               ▼   ▼   ▼   ▼   ▼
             L2  L2  L3  L1  L4+Sec
             Tech Lead  Manager  Secondary  VP+Sec
```

### 8.2 升级条件详细说明

#### 何时升级（Decision Criteria）

| 条件 | 升级到 | 理由 | 期望回应时间 |
|------|-------|------|------------|
| **P0 超过 5 分钟未 ACK** | L1 Secondary | Primary 不可达 | < 10 min |
| **P0 超过 30 分钟未解决** | L2 Tech Lead | 需要资深经验 | < 15 min |
| **P0 超过 60 分钟未解决** | L3 Manager | 需要管理决策 | < 30 min |
| **诊断方向完全不确定** | L2 Tech Lead | 需要更多经验 | < 15 min |
| **需要执行非标操作** | L2 Tech Lead | 需要变更审批 | < 15 min |
| **涉及多个组件同时故障** | L2 Tech Lead | 需要全局视角协调 | < 15 min |
| **怀疑是安全事件** | L4 VP + Security | 合规和安全要求 | 立即 |
| **需要联系外部方（云厂商等）** | L3 Manager | 需要管理权限和预算 | < 30 min |
| **可能影响 SLA / 需要赔偿** | L3 Manager | 商业决策 | < 30 min |
| **同时处理 3+ 个事件** | L1 Secondary | 带宽不足 | < 10 min |
| **个人判断需要帮助** | L1 Secondary 或 L2 | 信任你的直觉 | - |

#### 如何描述升级请求

升级请求的质量直接影响升级对象的理解速度。遵循 **3-2-1 格式**：

```
【3 个关键事实】
  1. {什么出了问题 — 一句话}
  2. {已经做了什么 — 2-3 个要点}
  3. {现在卡在哪里 — 一个具体障碍}

【2 个具体需求】
  1. {需要对方做什么 — 明确的动作}
  2. {需要多快 — 时间期望}

【1 个下一步】
  {如果你不来, 我打算怎么办 — B 计划}
```

**示例**：

```
【升级请求】P0 - API 全部 502, 30分钟未恢复

3个关键事实:
  1. GlobalReach API 从 14:30 开始返回 502, 影响全部用户
  2. 已完成: docker restart api (无效), 检查日志发现 ECONNREFUSED pg:5432,
     PG 显示 "sorry, too many clients already" (连接数 100/100)
  3. 卡在: 已经 terminate 了 idle 连接但仍不够, 考虑改 max_connections 
     但不敢随意 restart PG (怕丢数据)

2个具体需求:
  1. 请确认是否可以临时增加 PG max_connections 并 restart
  2. 或者是否有其他更快恢复服务的方案

1个下一步:
  如果你 10 分钟内无法回复, 我将按照 RB-002 场景 2 操作 
  (增加 max_connections 到 200 并 restart PG, 预计中断 10 秒)

@TechLead 请协助! 事件ID: INC-042
```

### 8.3 升级联系人联系方式

| 级别 | 角色 | 联系方式 | 升级脚本命令 |
|------|------|---------|-------------|
| L1 | Secondary | IM / Phone | `./oncall-manager.sh --escalate P1 "need help"` |
| L2 | Tech Lead | IM + Phone | `./oncall-manager.sh --escalate P0 "need senior help"` |
| L3 | Engineering Manager | Phone + Email | `./oncall-manager.sh --escalate P0 "need management"` |
| L4 | VP Engineering | Phone (直接拨打) | 人工呼叫 |
| L5 | CEO + 法务 | Phone (直接拨打) | 人工呼叫 |

---

## 9. 通信模板

### 9.1 内部通信模板

#### 9.1.1 事件初始通报（IM 频道）

```markdown
@channel 🚨 **P{0/1/2} 事件通报**

**INC-{编号}: {简短标题}**
- **级别**: P{X} ({Critical/High/Medium/Low})
- **状态**: 🔄 正在调查
- **Primary**: @{姓名}
- **触发时间**: {HH:MM UTC}
- **影响**: {一句话描述影响}

**当前进展**:
{1-2句话描述当前在做什么}

**预计下次更新**: {HH:MM} (或 "持续更新中")

📎 事件面板: {链接到事件详情}
```

#### 9.1.2 事件进度更新（IM 频道）

```markdown
@channel 📝 **INC-{编号} 进度更新**

**状态**: {investigating / identified / resolving / monitoring / resolved}
**耗时**: T+{XX}min

**新进展**:
- {本时间段做了什么}
- {发现了什么}

**下一步**:
- {计划做什么}
- {预计完成时间}: {HH:MM}

**需要的帮助**: (如有) {描述}
```

#### 9.1.3 事件关闭通知（IM 频道）

```markdown
@channel ✅ **INC-{编号} 已解决**

**标题**: {事件标题}
**级别**: P{X}
**持续时间**: {XX} 分钟
**解决时间**: {HH:MM UTC}

**根因**: {一句话}
**修复措施**: {一句话}

**SLA 符合性**:
- 响应: ✅ 符合 ({X}min < {SLA}min) / ❌ 不符合
- 修复: ✅ 符合 ({X}min < {SLA}min) / ❌ 不符合

**后续**:
- Post-Mortem: {已安排 / 不需要 / 待定}
- 知识更新: {哪些文档将被更新}

感谢 @Secondary 的协助 (如有)
```

### 9.2 外部通信模板

#### 9.2.1 服务中断通知（用户-facing）

```markdown
Subject: [GlobalReach] 服务中断通知

尊敬的用户：

我们正在经历一次服务中断，技术团队正在全力处理。

**开始时间**: {YYYY-MM-DD HH:MM} UTC
**影响功能**: {列出受影响的功能}
**当前状态**: 正在紧急修复中

我们会尽快恢复服务并通过此渠道通知您。

如需紧急支持，请联系: {支持渠道}

致歉，
GlobalReach 技术团队
```

#### 9.2.2 服务恢复通知（用户-facing）

```markdown
Subject: [Resolved] GlobalReach 服务已恢复

尊敬的用户：

GlobalReach 服务已于 **{YYYY-MM-DD HH:MM} UTC** 全面恢复。

**恢复的功能**: {列出已恢复的功能}
**验证状态**: 所有核心功能已通过验证

对于此次中断给您带来的不便，我们深表歉意。
我们将发布详细的故障分析报告并采取措施防止类似事件再次发生。

如有任何问题，请联系: {支持渠道}

GlobalReach 技术团队
```

---

## 附录

### 附录 A: 事件严重级别快速判定表

| 症状 | 可能级别 | 主要依据 |
|------|---------|---------|
| 全部 502/503/504, 任何功能都不可用 | **P0** | 全平台不可用 |
| 核心功能(登录/Campaign/发送)不可用 | **P0** | 核心业务中断 |
| DB/Redis/Nginx 等基础设施故障 | **P0-P1** | 取决于影响范围 |
| 部分功能异常, 大部分用户可用 | **P1** | 功能受损 |
| 性能明显下降但不影响正确性 | **P1-P2** | 体验下降 |
| 单个非核心功能异常 | **P2** | 局部影响 |
| 仅内部可见的问题 | **P3** | 无外部影响 |

### 附录 B: 常用诊断命令速查

```bash
# === 全局状态 ===
docker ps -a --format "table {{.Names}}\t{{.Status}}"   # 所有容器状态
docker stats --no-stream                                   # 资源使用
df -h                                                     # 磁盘空间
free -h                                                   # 内存

# === API ===
curl -sf http://localhost:3000/health | jq .               # 健康检查
docker logs --tail 100 globalreach-api                     # API 日志

# === PostgreSQL ===
docker exec postgresql pg_isready                          # PG 就绪
docker exec postgresql psql -U user -c "SELECT count(*) FROM pg_stat_activity;"  # 连接数
docker exec postgresql df -h /var/lib/postgresql/data        # PG 磁盘

# === Redis ===
docker exec redis redis-cli ping                           # Redis 存活
docker exec redis redis-cli INFO memory | grep used         # Redis 内存
docker exec redis redis-cli INFO clients                   # Redis 连接数

# === Nginx ===
docker exec nginx nginx -t                                 # 配置测试
docker exec nginx tail -20 /var/log/nginx/error.log        # 错误日志
curl -sI https://localhost                                # HTTPS 测试

# === 巡检 ===
./scripts/health-inspection.sh                             # 完整巡检
```

### 附录 C: 事件状态码参考

| 状态码 | 名称 | 说明 | 可转换到的状态 |
|--------|------|------|--------------|
| `detected` | 已检测 | 告警触发，尚未人工确认 | acknowledged, cancelled |
| `acknowledged` | 已确认 | Primary 已 ACK | investigating, cancelled |
| `investigating` | 调查中 | 正在诊断 | identified, waiting, blocked |
| `identified` | 已识别 | 根因已确定 | resolving, blocked |
| `resolving` | 修复中 | 正在执行修复 | resolved, monitoring, blocked |
| `monitoring` | 观察中 | 修复后观察期 | resolved, reopened |
| `resolved` | 已解决 | 验证通过 | closed, reopened |
| `closed` | 已关闭 | Post-Mortem 完成 | -(终态) |
| `cancelled` | 已取消 | 误报或无需处理 | -(终态) |
| `waiting` | 等待中 | 等待信息/资源 | investigating, cancelled |
| `blocked` | 阻塞 | 遇到外部阻碍 | resolving, escalated |
| `reopened` | 重新打开 | 问题复现 | investigating |

### 附录 D: 版本历史

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|---------|
| v1.0.0 | 2026-06-09 | S132/O07 Team | 初始版本，6 个场景 SOP + 升级决策树 + 通信模板 |

---

> **文档结束**
>
> 本文档是 GlobalReach V2.0 事件响应的标准操作程序。
> 配合使用:
> - `docs/oncall/ONCALL_HANDBOOK.md` — On-call 值班制度与规范
> - `docs/runbooks/RB-001~007` — 各组件详细运行手册
> - `docs/troubleshooting-trees/TT-001~006` — 诊断决策树
> - `docs/failure-modes/FailureModeBase.md` — 22 个故障模式库
