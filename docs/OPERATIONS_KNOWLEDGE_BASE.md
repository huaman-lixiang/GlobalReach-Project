# GlobalReach V2.0 运营知识库 (Operations Knowledge Base)

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **创建日期**: 2026-06-09
> **Session**: S132 — O02 运营知识库构建
> **总条目数**: 7 Runbooks + 22 Failure Modes + 6 Troubleshooting Trees

---

## 目录

- [1. 知识库架构图](#1-知识库架构图)
- [2. Runbook 索引](#2-runbook-索引)
- [3. 故障模式库 (FMB) 索引](#3-故障模式库-fmb-索引)
- [4. 决策树索引](#4-决策树索引)
- [5. 快速检索指南](#5-快速检索指南)
- [6. 维护流程](#6-维护流程)
- [7. 版本历史](#7-版本历史)

---

## 1. 知识库架构图

```
docs/OPERATIONS_KNOWLEDGE_BASE.md (本文件 — 总入口)
│
├── docs/runbooks/                    ← 运行手册 (Runbook) 库
│   ├── RB-001_API_SERVICE.md          API 服务运行手册
│   ├── RB-002_POSTGRES.md            PostgreSQL 运行手册
│   ├── RB-003_REDIS.md               Redis 运行手册
│   ├── RB-004_NGINX.md               Nginx 运行手册
│   ├── RB-005_MONITORING_STACK.md    监控栈运行手册
│   ├── RB-006_DOCKER.md              Docker Compose 运行手册
│   └── RB-007_EMAIL_PIPELINE.md      邮件流水线运行手册
│
├── docs/failure-modes/                ← 故障模式库 (FMB)
│   └── FailureModeBase.md             22 个故障模式条目
│       │
│       ├── 网络类 (FM-NET-001 ~ 004)
│       ├── 存储类 (FM-STO-001 ~ 004)
│       ├── 计算类 (FM-CAL-001 ~ 004)
│       ├── 应用类 (FM-APP-001 ~ 007)
│       ├── 安全类 (FM-SEC-001 ~ 004)
│       └── 外部依赖类 (FM-EXT-001 ~ 003)
│
├── docs/troubleshooting-trees/        ← 决策树库
│   ├── TT-001_API_SLOW.md             API 响应慢决策树
│   ├── TT-002_EMAIL_DELIVERY_FAILURE.md 邮件发送失败决策树
│   ├── TT-003_HIGH_MEMORY_USAGE.md     高内存使用率决策树
│   ├── TT-004_CONTAINER_CRASH_LOOP.md 容器崩溃循环决策树
│   ├── TT-005_ALERT_STORM.md          告警风暴处理决策树
│   └── TT-006_DATA_INCONSISTENCY.md   数据不一致决策树
│
└── docs/*.md                          ← 已有运维文档 (参考资源)
    ├── PHASE_O_OPERATIONS_OPTIMIZATION.md  Phase O 规划文档
    ├── HIGH_AVAILABILITY_ARCHITECTURE.md   HA 架构设计
    ├── SECURITY_KEY_ROTATION_POLICY.md     密钥轮换政策
    ├── REMOTE_BACKUP_STRATEGY.md           备份策略
    ├── ALERT_TUNING_GUIDE.md               告警调优
    ├── LOKI_LOGQL_QUERIES.md               LogQL 查询
    ├── POSTGRESQL_UPGRADE_PLAN.md          PG 升级计划
    ├── SELF_HOSTED_RUNNER_GUIDE.md         Runner 指南
    ├── CDN_INTEGRATION_PLAN.md             CDN 集成
    ├── COMPLIANCE_POLICY.md                 合规政策
    ├── DISASTER_RECOVERY_DRILL_PLAN.md     DR 演练
    ├── API_VERSIONING_POLICY.md            API 版本化
    ├── PERFORMANCE_BENCHMARK_SUITE.md      性能测试
    ├── MOBILE_RESPONSIVE_GUIDE.md          移动端适配
    ├── CONFIG_VALIDATION_SAFETY_NET.md     配置验证
    ├── MULTI_TENANT_ARCHITECTURE.md         多租户架构
    ├── SSO_INTEGRATION_GUIDE.md             SSO 集成
    └── AIOPS_ALERT_DEDUPPLICATION.md       AIOps 告警降噪
```

### 三层关系

```
症状 (Symptom)
    │
    ▼ 决策树 (Troubleshooting Tree) — "从现象到根因的路径"
    │  例: 用户报告 API 慢 → TT-001 → 分支判断 → 叶子节点
    │
    ▼ Runbook (Runbook) — "组件级别的完整操作手册"
    │  例: TT-001 叶子节点指向 → RB-001 场景 3 (DB 连接失败)
    │
    ▼ 故障模式 (Failure Mode) — "标准化的故障定义和预防"
    │  例: RB-001 引用 → FM-APP-001 (DB 连接池耗尽)
    │
    ▼ 根因修复 + 预防措施记录回 FMB 和 Runbook
```

---

## 2. Runbook 索引

| ID | 名称 | 核心组件 | 关键场景数 | 适用人员 |
|----|------|---------|-----------|---------|
| **RB-001** | [API 服务运行手册](runbooks/RB-001_API_SERVICE.md) | Express.js / Node.js / Sequelize | 9 个场景 (502/503/DB失败/Redis超时/内存泄漏/延迟突增/JWT/上传/队列) | 全员 (一线→L3) |
| **RB-002** | [PostgreSQL 运行手册](runbooks/RB-002_POSTGRES.md) | PostgreSQL 15 Alpine | 6 个场景 (连接拒绝/连接池耗尽/磁盘满/性能降级/数据损坏/备份失败) | DBA / 平台工程师 |
| **RB-003** | [Redis 运行手册](runbooks/RB-003_REDIS.md) | Redis 7.4.9 Alpine | 6 个场景 (连接失败/内存过高/延迟升高/数据丢失/连接耗尽/队列阻塞) | 平台工程师 |
| **RB-004** | [Nginx 运行手册](runbooks/RB-004_NGINX.md) | Nginx 1.31.1 Alpine | 6 个场景 (502/SSL握手失败/限流误触/静态404/高CPU/重载失败) | DevOps / SRE |
| **RB-005** | [监控栈运行手册](runbooks/RB-005_MONITORING_STACK.md) | Prometheus+Grafana+AlertManager+Loki+Promtail+Tempo | 8 个场景 (Target DOWN/告警不触发/Grafana 无数据/Loki 缺失/告警风暴/Prometheus 存储/Tempo 缺失/Exporter 缺失) | SRE / 监控工程师 |
| **RB-006** | [Docker Compose 运行手册](runbooks/RB-006_DOCKER.md) | Docker Compose (14 服务) | 6 个场景 (全服务启动失败/CrashLoop/网络不通/Volume 权限/镜像拉取/compose 异常) | DevOps / SRE |
| **RB-007** | [邮件流水线运行手册](runbooks/RB-007_EMAIL_PIPELINE.md) | EmailQueue+SendWorker+TemplateEngine+emailService | 6 个场景 (发不出/速度慢/大量失败/队列积压/内容乱码/进度卡住) | 业务运维 / 平台工程师 |

### Runbook 统一模板要素

每本 Runbook 包含以下标准章节:
1. **组件身份卡** — 技术规格速查表
2. **快速命令参考** — 常用操作一键复制
3. **架构关系图** — 文字版依赖关系
4. **健康检查清单** — 可勾选的巡检项
5. **故障排查场景** — 结构化的 症状→原因→诊断→方案→预防
6. **关键指标基线** — 正常/警告/严重阈值表
7. **相关资源** — 关联 Runbook/FMB/配置文件/仪表盘

---

## 3. 故障模式库 (FMB) 索引

完整条目见: [FailureModeBase.md](failure-modes/FailureModeBase.md)

### 按类别统计

| 类别 | 条目数 | Critical | High | Medium | Low |
|------|-------|----------|------|--------|-----|
| **网络类** (NET) | 4 | 3 | 1 | 0 | 0 |
| **存储类** (STO) | 4 | 2 | 2 | 0 | 0 |
| **计算类** (CAL) | 4 | 2 | 1 | 1 | 0 |
| **应用类** (APP) | 7 | 3 | 3 | 1 | 0 |
| **安全类** (SEC) | 4 | 3 | 0 | 1 | 0 |
| **外部依赖类** (EXT) | 3 | 0 | 1 | 2 | 0 |
| **合计** | **22** | **13** | **8** | **1** | **0** |

### Critical 级别故障模式一览

| ID | 名称 | 类别 | 发生概率 | MTTR | 首选排查入口 |
|----|------|------|---------|------|-------------|
| FM-NET-001 | DNS 解析失败 | 网络 | 低 | 5-30 min | TT-001 → RB-004 |
| FM-NET-002 | 防火墙阻断 | 网络 | 低 | 10-60 min | RB-006 |
| FM-NET-003 | TLS 证书过期 | 网络 | 中 | 5-120 min | RB-004 场景 2 |
| FM-STO-001 | 磁盘空间耗尽 | 存储 | 中 | 15-120 min | RB-006 + RB-002 |
| FM-STO-003 | 数据文件损坏 | 存储 | 极低 | 1-4 h | RB-002 场景 5 |
| FM-CAL-002 | OOMKilled | 计算 | 中 | 5-30 min | TT-003 |
| FM-CAL-003 | 进程崩溃 | 计算 | 低 | 10-60 min | TT-004 |
| FM-APP-001 | DB 连接池耗尽 | 应用 | 中 | 5-30 min | RB-001 场景 3 |
| FM-APP-007 | JWT Secret 泄露 | 应用(安全) | 极低 | 1-4 h | RB-001 场景 7 |
| FM-SEC-001 | 未授权访问 | 安全 | 低 | 1-4 h | RB-001 + RB-004 |
| FM-SEC-002 | 密钥/凭据泄露 | 安全 | 极低 | 2-8 h | RB-006 |
| FM-SEC-003 | DDoS 攻击 | 安全 | 低 | 15-120 min | RB-004 + TT-005 |

---

## 4. 决策树索引

| ID | 名称 | 入口症状 | 覆盖组件 | 叶子节点数 | 预估排查时间 |
|----|------|---------|---------|-----------|-------------|
| **TT-001** | [API 响应慢](troubleshooting-trees/TT-001_API_SLOW.md) | API latency 升高 | API/PG/Redis/Nginx/Network | 10+ | 5-120 min |
| **TT-002** | [邮件发送失败](troubleshooting-trees/TT-002_EMAIL_DELIVERY_FAILURE.md) | Campaign 不发/失败/退信 | Email Pipeline / SMTP Provider | 12+ | 10-60 min |
| **TT-003** | [高内存使用率](troubleshooting-trees/TT-003_HIGH_MEMORY_USAGE.md) | 内存告警/OOM | API Container (V8 Heap) | 6 | 10-60 min |
| **TT-004** | [容器崩溃循环](troubleshooting-trees/TT-004_CONTAINER_CRASH_LOOP.md) | Restarting 状态 | Docker / All Containers | 8+ | 15-120 min |
| **TT-005** | [告警风暴处理](troubleshooting-trees/TT-005_ALERT_STORM.md) | 大量告警通知 | AlertManager / All Alerts | 8 | 5-30 min (止血) |
| **TT-006** | [数据不一致](troubleshooting-trees/TT-006_DATA_INCONSISTENCY.md) | 数据不匹配 | PG / Redis / Queue / Multi-tenant | 10+ | 30-120 min |

### 决策树使用方法

1. **从症状出发** — 选择最匹配用户报告的决策树
2. **逐步回答问题** — 每个分支节点附带具体命令
3. **到达叶子节点** — 获得 Runbook 场景号或 FMB 条目 ID
4. **执行修复** — 按照 Runbook 的诊断步骤操作
5. **记录经验** — 将发现更新到 FMB（如发现新模式）

---

## 5. 快速检索指南

### 按症状检索

| 你看到什么 | 先查什么 | 再查什么 |
|------------|---------|---------|
| 页面打不开 / 502 / 503 / 504 | **TT-001** (API慢) → RB-004 (Nginx) | RB-001 (API) |
| 邮件发不出 / 发送很慢 | **TT-002** (邮件失败) → RB-007 (流水线) | FM-EXT-001 (SMTP) |
| 内存告警 / OOM | **TT-003** (内存) → RB-001 场景 5 | FM-APP-004 (泄漏) |
| 容器反复重启 | **TT-004** (崩溃循环) → RB-006 (Docker) | FM-CAL-003 (崩溃) |
| 手机被告警刷屏 | **TT-005** (告警风暴) → RB-005 (监控) | FM-SEC-003 (DDoS?) |
| 数据对不上 | **TT-006** (不一致) → RB-002 (DB) | FM-STO-003 (损坏) |

### 按组件检索

| 出问题的组件 | 首选 Runbook | 辅助资源 |
|-------------|------------|---------|
| API 服务 (Node.js) | RB-001 | TT-001, TT-003, TT-004, TT-006 |
| PostgreSQL | RB-002 | TT-001(分支), TT-006(路径A/B/D/E) |
| Redis | RB-003 | TT-001(分支), TT-006(路径B) |
| Nginx | RB-004 | TT-001(分支B), FM-NET-* |
| 监控栈 (Prometheus等) | RB-005 | TT-005 |
| Docker / 整体编排 | RB-006 | TT-004, FM-CAL-*, FM-STO-* |
| 邮件发送链路 | RB-007 | TT-002, FM-EXT-001 |

### 按严重程度检索

| 严重程度 | 直接对应 FMB | 推荐处理优先级 |
|---------|------------|--------------|
| 🔴 服务完全不可用 | FM-NET-001~003, FM-STO-001/003, FM-CAL-002~003, FM-APP-001/007, FM-SEC-001~003 | P0 — 立即处理 |
| 🟠 功能严重降级 | FM-NET-004, FM-STO-002/004, FM-CAL-001, FM-APP-002~006, FM-SEC-004, FM-EXT-001 | P1 — 30 分钟内 |
| 🟡 性能影响 | FM-CAL-004, FM-APP-006, FM-EXT-002~003 | P2 — 2 小时内 |

---

## 6. 维护流程

### 新增 Runbook

```markdown
1. 在 docs/runbooks/ 下创建 RB-XXX_<Component>.md
2. 遵循统一模板 (参见 RB-001 的结构)
3. 更新本文件的 Runbook 索引表
4. 更新按组件检索表
5. git add + commit (遵循 Conventional Commits)
```

### 新增故障模式

```markdown
1. 编辑 docs/failure-modes/FailureModeBase.md
2. 在对应分类下添加新条目 (遵循标准字段格式)
3. 更新本文件的 FMB 索引表和 Critical 一览表
4. 如有关联, 在对应的 Runbook 中添加交叉引用
5. git add + commit
```

### 新增决策树

```markdown
1. 在 docs/troubleshooting-trees/ 下创建 TT-XXX_<Scenario>.md
2. 从实际症状出发设计分支结构
3. 每个叶子节点必须指向具体的 Runbook 场景或 FMB 条目
4. 更新本文件的决策树索引表和按症状检索表
5. git add + commit
```

### 归档流程

- 当某个组件被移除或重大重构时，将对应的 Runbook 移动到 `docs/archive/`
- 在归档文件头部标注归档日期和原因
- FMB 条目不删除，标记为 `状态: 已废弃` 并注明替代方案
- 决策树如果涉及已废弃组件，更新叶子节点指向新的资源

### Review 要求

- 所有新增/修改的知识库条目需要至少一人 Review
- 涉及安全相关的内容 (FMB 安全类, 密钥操作) 需要 L2+ 工程师 Review
- 故障模式的 MTTR 估算需要基于实际事件数据校准 (不应凭空填写)

---

## 7. 版本历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0 | 2026-06-09 | 初始版本: 7 Runbooks + 22 Failure Modes + 6 Troubleshooting Trees + Entry Page | S132/O02 自动生成 |

---

## 附录: 文件清单

```
docs/
├── OPERATIONS_KNOWLEDGE_BASE.md          ← 本文件 (新建)
├── runbooks/                              (新建目录)
│   ├── RB-001_API_SERVICE.md              (新建)
│   ├── RB-002_POSTGRES.md                (新建)
│   ├── RB-003_REDIS.md                   (新建)
│   ├── RB-004_NGINX.md                   (新建)
│   ├── RB-005_MONITORING_STACK.md        (新建)
│   ├── RB-006_DOCKER.md                  (新建)
│   └── RB-007_EMAIL_PIPELINE.md          (新建)
├── failure-modes/                         (新建目录)
│   └── FailureModeBase.md                (新建)
├── troubleshooting-trees/                  (新建目录)
│   ├── TT-001_API_SLOW.md                (新建)
│   ├── TT-002_EMAIL_DELIVERY_FAILURE.md   (新建)
│   ├── TT-003_HIGH_MEMORY_USAGE.md       (新建)
│   ├── TT-004_CONTAINER_CRASH_LOOP.md    (新建)
│   ├── TT-005_ALERT_STORM.md             (新建)
│   └── TT-006_DATA_INCONSISTENCY.md      (新建)
└── *.md                                  (已有 18 个文档, 未修改)
```

**总计新建文件: 16 个**
- Runbooks: 7 个
- Failure Mode Base: 1 个 (含 22 个条目)
- Troubleshooting Trees: 6 个
- Entry Page: 1 个
