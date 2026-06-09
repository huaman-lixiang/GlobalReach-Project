# TT-004 容器崩溃循环决策树

> **文档版本**: v1.0
> **适用场景**: Docker 容器反复重启 (Restarting 状态 / ContainerRestartLoop 告警)
> **预估排查时间**: 15-120 分钟
> **关联 Runbook**: [RB-001 API 服务运行手册](../runbooks/RB-001_API_SERVICE.md), [RB-006 Docker Compose 运行手册](../runbooks/RB-006_DOCKER.md)
> **关联 FMB**: [FM-CAL-003 进程崩溃](../failure-modes/FailureModeBase.md), [FM-CAL-002 OOMKilled](../failure-modes/FailureModeBase.md)

---

## 决策树总览

```
[开始: 发现容器处于 Restarting 状态或 ContainerRestartLoop 告警触发]
│
├─ Step 1: 确认崩溃现象
│  │  命令:
│  │    docker ps -a --format "{{.Names}}\t{{.Status}}" | grep -E "(Restarting|Exited)"
│  │    # 崩溃统计
│  │    docker inspect --format='{{.RestartCount}} {{.State.ExitCode}} {{.State.OOMKilled}} \
│  │      {{.State.Error}}' <container_name>
│  │  预估: 1 min
│  │
│  ├─ ExitCode = 137 (SIGKILL) ─────────→ [路径 A: 被 Kill] ↓
│  ├─ ExitCode = 1 (Generic Error) ───────→ [路径 B: 应用错误退出] ↓
│  ├─ ExitCode = 0 但不断重启 ──────────→ [路径 C: Healthcheck 失败循环] ↓
│  └─ 其他 ExitCode ────────────────────→ [路径 D: 信号/未知原因] ↓
│
╔═══════════════════════════════════════════════════════╗
║          路径 A: ExitCode 137 — 被 SIGKILL              ║
╚═══════════════════════════════════════════════════════╝
│
│  最常见原因: OOMKilled (Docker 杀掉超限进程)
│
├─ Step A1: 确认 OOM
│  │  命令: docker inspect --format='{{.State.OOMKilled}}' <container_name>
│  │
│  ├─ true ──────────────────────────→ ✅ 确认 OOM! → [TT-003 高内存决策树]
│  │   │  这是 FM-CAL-002 的典型表现
│  │   │  操作: 先按 TT-003 排查内存问题再重启
│  │   │  ⚠️ 直接重启会再次 OOM → 必须先解决根因或临时增大 memory limit
│  │   └─→ TT-003 + FM-CAL-002 + FM-APP-004
│  │
│  └─ false ─────────────────────────→ 不是 OOM, 是被外部 SIGKILL
│     │  可能原因: docker kill / docker stop (force) / 系统 OOM killer
│     │  排查: dmesg | grep -i "oom\|kill"; 检查是否有手动 stop/kill
│     │  → FM-CAL-003
│
╔═══════════════════════════════════════════════════════╗
║        路径 B: ExitCode 1 — 应用错误退出                ║
╚═══════════════════════════════════════════════════════╝
│
│  最常见原因: 启动失败 (依赖不可达 / 配置错误 / 语法错误)
│
├─ Step B1: 查看启动日志中的最后错误
│  │  命令: docker logs --tail=50 <container_name> 2>&1 | tail -30
│  │  预估: 2 min
│  │
│  ├─ "ECONNREFUSED" / "connect ECONNREFUSED" ──→ 依赖服务未就绪
│  │   │  → 检查 postgres/redis 是否运行; depends_on condition
│  │   │  → RB-001 场景 3/4
│  │   │  额外: 5-10 min
│  │   └─→ RB-002 or RB-003
│  │
│  ├─ "SyntaxError" / "Unexpected token" ────→ 代码语法错误
│  │   │  → 最近部署的代码有 bug; 回滚到上一个版本
│  │   │  额外: 5-20 min (含回滚)
│  │   └─→ 检查 git log 找最近变更
│  │
│  ├─ "Error: Cannot find module" ────────→ 依赖缺失
│  │   │  → node_modules 不完整或 package.json 变更后未 npm install
│  │   │  → 重新 build: docker compose build api
│  │   │  额外: 5-15 min
│  │   └─→ RB-006
│  │
│  ├─ "PORT already in use" / "EADDRINUSE" ─→ 端口冲突
│  │   │  → 可能有僵尸进程占用端口; 或 docker port 映射冲突
│  │   │  → FM-NET-004
│  │   │  额外: 5-10 min
│  │   └─→ RB-006 场景 1
│  │
│  ├─ "FATAL: ... database" / "sequelize" ─→ DB 连接失败
│  │   │  → 密码错误 / DB 不存在 / PG 未启动
│  │   │  → RB-001 场景 3 + RB-002
│  │   │  额外: 5-15 min
│  │   └─→ FM-APP-001
│  │
│  ├─ "invalid config" / "missing env var" ─→ 环境变量缺失
│  │   │  → .env 文件缺少必要变量; docker-compose.yml 引用了不存在的 ${VAR}
│  │   │  → docker exec <container> env | grep -v "=" 检查空值
│  │   │  额外: 5 min
│  │   └─→ RB-006
│  │
│  └─ "unhandledRejection" / "uncaughtException" → 运行时异常
│     │  → 代码 bug; 查看完整 stack trace
│     │  → 需要 L2/L3 工程师分析代码
│     │  额外: 30-120 min
│     │  → FM-CAL-003
│     └─→ RB-001 (通用错误日志搜索)
│
╔═══════════════════════════════════════════════════════╗
║       路径 C: ExitCode 0 但 healthcheck 失败            ║
╚═══════════════════════════════════════════════════════╝
│
│  现象: 容器启动成功 (exit 0) 但 Docker healthcheck 反复失败 → Docker 自动重启
│
├─ Step C1: 手动测试健康检查
│  │  命令:
│  │    # API
│  │    curl -sf http://localhost:3000/api/v1/health | jq .
│  │    # PG
│  │    docker exec globalreach-postgres pg_isready -U globalreach_user
│  │    # Redis
│  │    docker exec globalreach-redis redis-cli ping
│  │  预估: 2 min
│  │
│  ├─ health 返回 200 但子系统有 fail ──→ 部分依赖未就绪
│  │   │  → API 的 ready check 更严格; startup 阶段某组件初始化慢
│  │   │  → 增大 start_period (当前 60s); 检查 slow init 组件
│  │   │  → RB-001 第 4 节健康检查清单
│  │   │  额外: 5-15 min
│  │   └─→ 调整 healthcheck 配置
│  │
│  └─ health 返回非 200 ───────────────→ 服务实际有问题
│      → 按 exit code != 0 处理 (回退到路径 B)
│
╔═══════════════════════════════════════════════════════╗
║         路径 D: 其他 ExitCode / 信号                   ║
╚═══════════════════════════════════════════════════════╝
│
├─ ExitCode = 125 (Docker error) ───────→ Dockerfile / image 问题
│  │  → 命令无法执行; 镜像损坏; 权限不足
│  │  → 重新 build image
│  │  → RB-006
│  │
├─ ExitCode = 126 (Permission denied) ──→ 文件权限问题
│  │  → volume 挂载的文件权限不对
│  │  → RB-006 场景 4
│  │
├─ ExitCode = 127 (Command not found) ──→ entrypoint/cmd 不存在
│  │  → Dockerfile 中的 CMD/ENTRYPOINT 指向了不存在的命令
│  │  → 检查 Dockerfile
│  │  → RB-006
│  │
├─ ExitCode = 139 (SIGSEGV) ───────────→ 段错误 (C++ 层 crash)
│  │  → Native addon bug; 内存越界访问
│  │  → 检查使用的 .node addon; 升级版本
│  │  → FM-CAL-003
│  │
├─ ExitCode = 143 (SIGTERM) ───────────→ 被正常终止但 restart policy 又拉起
│  │  → 有人手动 stop 后又有人 up; 或健康检查导致循环
│  │  → 检查最近的 docker events
│  │  → docker events --since=1h --filter container=<name>
│  │
└─ 未知 ExitCode ─────────────────────→ 收集更多信息
   │  → dmesg 内核日志
   │  → docker system events
   │  → 完整 stdout/stderr 输出
   │  → 升级到 L2/L3
   │  → FM-CAL-003
```

---

## 崩溃快速响应 SOP

### Phase 1: 止损 (0-5 分钟)
```bash
# 1. 创建静默防止告警风暴
# AlertManager Web UI → New Silence → 匹配所有告警 → 30min

# 2. 暂停自动重启 (防止日志被覆盖)
docker update --restart=no <container_name>

# 3. 保存当前日志 (关键证据!)
docker logs <container_name> > /tmp/crash_$(date +%Y%m%d_%H%M%S).log 2>&1
mkdir -p ./crash-dumps && cp /tmp/crash_*.log ./crash-dumps/
```

### Phase 2: 诊断 (5-30 分钟)
```bash
# 4. 查看退出码和 OOM 状态
docker inspect --format='ExitCode={{.State.ExitCode}} OOM={{.State.OOMKilled}} Error={{.State.Error}} RCnt={{.RestartCount}}' <container_name>

# 5. 查看最后 100 行日志
docker logs --tail=100 <container_name>

# 6. 检查系统级线索
dmesg | tail -30 | grep -iE "(oom|kill|error)"

# 7. 检查资源使用历史 (如果有 Prometheus)
curl -s 'http://localhost:9090/api/v1/query?query=max_over_time(container_memory_rss{container="<name>"}[1h])'
```

### Phase 3: 修复与恢复 (30+ 分钟)
根据上述决策树定位根因并执行对应方案。

### Phase 4: 复盘
- 将故障模式录入 FMB (如尚不存在)
- 更新 Runbook 中的预防措施
- 如涉及代码变更, 走正常的 PR/MR 流程
