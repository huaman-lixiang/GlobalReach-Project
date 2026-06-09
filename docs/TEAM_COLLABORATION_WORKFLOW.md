# GlobalReach V2.0 团队协作工作流 — 设计文档

> **文档版本**: v1.0.0
> **创建日期**: 2026-06-09
> **项目**: GlobalReach V2.0 企业级邮件营销平台
> **模块**: S132/O07 团队协作工作流
> **状态**: 设计完成

---

## 目录

- [1. 协作框架概览](#1-协作框架概览)
  - [1.1 架构总览](#11-架构总览)
  - [1.4 核心模块说明](#14-核心模块说明)
- [2. 与已有系统的关系图](#2-与已有系统的关系图)
- [3. 多人开发 Git 分支策略](#3-多人开发-git-分支策略)
- [4. Code Review 检查清单](#4-code-review-检查清单)
- [5. 发布日历和冻结窗口策略](#5-发布日历和冻结窗口策略)
- [6. 文件清单与部署指南](#6-文件清单与部署指南)

---

## 1. 协作框架概览

### 1.1 架构总览

GlobalReach V2.0 团队协作工作流由 **四大支柱** 构成，形成完整的"检测 → 响应 → 复盘 → 改进"闭环：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  GlobalReach V2.0 团队协作工作流架构                     │
│                                                                         │
│   ┌──────────────┐                                                    │
│   │ ① On-call    │ ← 值班制度: 7×24 系统保障                            │
│   │   值班手册   │   docs/oncall/ONCALL_HANDBOOK.md                    │
│   └──────┬───────┘                                                    │
│          │ 触发响应                                                     │
│          ▼                                                             │
│   ┌──────────────┐     使用      ┌──────────────┐                       │
│   │ ② Incident   │ ◄──────────► │  TT 决策树    │                       │
│   │   Response   │     导航      │ (TT-001~006) │                       │
│   │     SOP      │              └──────────────┘                       │
│   │ incident-    │     使用      ┌──────────────┐                       │
│   │ response/    │ ◄──────────► │  RB 运行手册  │                       │
│   │ SOP.md       │     执行      │ (RB-001~007) │                       │
│   └──────┬───────┘              └──────────────┘                       │
│          │ 验证恢复       参考     ┌──────────────┐                       │
│          ▼               ┌──────► │  FMB 故障库   │                       │
│   ┌──────────────┐      │        │ (22 条模式)   │                       │
│   │ ③ O03 巡检   │ 验证通过   └──────────────┘                       │
│   │   引擎验证    │                                                    │
│   └──────┬───────┘                                                    │
│          │ 知识沉淀                                                     │
│          ▼                                                             │
│   ┌──────────────┐                                                    │
│   │ ④ Post-Mortem│ ← 复盘: Blameless 文化                             │
│   │   复盘流程   │   行动项追踪 → 知识库更新                            │
│   └──────┬───────┘                                                    │
│          │ 改进反馈                                                     │
│          └──────────► 回到 ①②③ 形成闭环                                │
│                                                                         │
│   ════════════════════════════════════════════════════════════════════  │
│                                                                         │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│   │ Team API     │  │ On-call      │  │ Dashboard    │                 │
│   │ (RESTful)    │  │ Manager SH   │  │ (Stats)      │                 │
│   │ teamCollab.js│  │ oncall-mgr.sh│  │ /dashboard/*  │                 │
│   └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 四大支柱详解

#### 支柱一：On-call 值班制度（`docs/oncall/ONCALL_HANDBOOK.md`）

| 维度 | 内容 |
|------|------|
| **定位** | 团队协作的"值班守则"，定义谁、何时、如何保障系统 |
| **核心输出** | 值班人明确、SLA 可量化、交接有标准 |
| **关键机制** | Primary/Secondary/Escalation 三级角色 + 周轮换 |
| **目标读者** | 全体团队成员（必须阅读并遵守） |
| **文档规模** | ~1400 行，5 章 + 附录 |

**覆盖内容**：
- 制度概述：定义、目的、角色（Primary/Secondary/Escalation）
- 轮值规则：周轮换、技能分配、避免连续疲劳
- SLA 分级：P0(5min/30min) ~ P3(4h/48h)
- 告警处理 SOP：P0-P3 各级别的完整操作流程
- 值班交接：25 项检查清单 + 10 分钟站会议程
- 通信协议：内部 6 级渠道矩阵 + 外部 3 套通信模板
- 复盘流程：Blameless 文化 + Post-Mortem 模板 + 行动项追踪

#### 支柱二：事件响应 SOP（`docs/incident-response/INCIDENT_RESPONSE_SOP.md`）

| 维度 | 内容 |
|------|------|
| **定位** | "操作手册的操作手册"，指导具体场景下每一步做什么 |
| **核心输出** | 6 个典型故障场景的 T+n 分钟级时间线 |
| **关键机制** | 统一的 T+0→T+120min→T+24h 事件生命周期 |
| **目标读者** | 值班人员（作为快速参考卡使用） |
| **文档规模** | ~900 行，9 章 + 附录 |

**覆盖的 6 大场景**：

| # | 场景 | 典型症状 | 级别 | 首选资源 |
|---|------|---------|------|---------|
| 1 | API 服务崩溃 | 502/503/全站不可用 | P0 | RB-001, TT-001 |
| 2 | PostgreSQL 故障 | 连接拒绝/连接池满 | P0 | RB-002, TT-006 |
| 3 | Redis 异常 | 缓存失效/Session丢失 | P0-P1 | RB-003, TT-001 |
| 4 | Nginx 宕机 | 外部访问全断 | P0 | RB-004 |
| 5 | 磁盘空间耗尽 | 级联式多组件异常 | P0 | RB-006, FM-STO-001 |
| 6 | 安全事件 | 异常登录/攻击/泄露 | P0-P1 | 必须升级 |

#### 支柱三：Team Collaboration API（`api/routes/teamCollaboration.js`）

| 维度 | 内容 |
|------|------|
| **定位** | 团队协作功能的程序化接口，支撑自动化和集成 |
| **核心输出** | 10 个 RESTful 端点，覆盖 oncall/incident/postmortem |
| **存储方式** | JSON 文件轻量存储（`data/team-collaboration.json`） |
| **技术栈** | Express.js Router + 文件 I/O + jq 式查询 |

**API 端点清单**：

| Method | Endpoint | 功能 | 输入 | 输出 |
|--------|----------|------|------|------|
| GET | `/team/oncall/current` | 当前值班信息 | - | primary/secondary/周期 |
| GET | `/team/oncall/schedule` | 未来排班表 | ?weeks=2 | 轮值列表 |
| POST | `/team/oncall/handover` | 提交交接记录 | from,to,items,notes | handover 对象 |
| POST | `/team/:ho/acknowledge` | 确认交接 | acknowledgedBy | updated handover |
| GET | `/team/incidents` | 事件列表 | ?severity,&status,&page | 分页事件列表 |
| POST | `/team/incidents` | 创建事件 | title,severity,description | 新事件对象 |
| GET | `/team/incidents/:id` | 事件详情 | - | 事件+评论 |
| PATCH | `/team/incidents/:id` | 更新事件 | status,assignee,tags | 更新后的事件 |
| POST | `/team/incidents/:id/comment` | 添加评论 | content,author | 评论对象 |
| GET | `/team/postmortems` | 复盘报告列表 | ?status,&page | 分页报告列表 |
| POST | `/team/postmortems` | 创建复盘报告 | incidentId,summary,... | 新报告对象 |
| GET | `/team/dashboard/stats` | 仪表盘统计 | ?days=7 | 汇总统计数据 |

#### 支柱四：On-call 排班管理脚本（`scripts/oncall-manager.sh`）

| 维度 | 内容 |
|------|------|
| **定位** | CLI 工具，供值班人员在终端中快速执行排班操作 |
| **核心输出** | 6 种命令模式，交互式交接引导 |
| **数据文件** | `data/oncall-schedule.json`（排班）+ `data/team-collaboration.json`（协作数据） |
| **依赖** | bash + jq |

**命令一览**：

```bash
./scripts/oncall-manager.sh                # 当前值班状态
./scripts/oncall-manager.sh --schedule     # 未来 2 周排班表
./scripts/oncall-manager.sh --handover     # 交互式交接流程 (25项检查清单)
./scripts/oncall-manager.sh --escalate P0 "msg"  # 升级通知
./scripts/oncall-manager.sh --report       # 本周值班报告
./scripts/oncall-manager.sh --init         # 初始化排班数据
```

## 2. 与已有系统的关系图

### 2.1 系统依赖关系全景

```
                         ┌─────────────────────────────────────┐
                         │         外部触发源                    │
                         │  Prometheus AlertManager            │
                         │  用户报告 / Status Page             │
                         │  O05 风险评分引擎                   │
                         │  O03 巡检引擎(发现问题时)            │
                         └──────────────┬──────────────────────┘
                                        │ 告警/事件
                                        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        O01 AIOps 告警降噪引擎                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐              │
│  │ 时间窗口聚类    │  │ 拓扑关联分析    │  │ 标签相似度匹配  │              │
│  │ SlidingWindow  │  │ ServiceTopology│  │ LabelSimilarity│              │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘              │
│          └────────────────┴────────────────┴──────────┘                      │
│                              │                                            │
│                    结构化告警事件 (clusterId, rootCause, severity)           │
│                              ▼                                            │
│  ══════════════════════════╧══════════════════════════════════════════     │
│                                                                          │
│  ███████████████████████ O07 团队协作工作流 ██████████████████████████     │
│                                                                          │
│  ┌──────────────────────────────┐  ┌────────────────────────────────┐    │
│  │ 📕 On-call 值班手册            │  │ 🔧 Team Collab API             │    │
│  │ ONCALL_HANDBOOK.md           │  │ teamCollaboration.js           │    │
│  │                              │  │                                │    │
│  │ • 角色/职责/SLA 定义         │  │ • /oncall/current              │    │
│  │ • P0-P3 分级处理 SOP         │  │ • /incidents CRUD              │    │
│  │ • 25项交接检查清单            │  │ • /postmortems CRUD            │    │
│  │ • 通信协议(内/外)模板         │  │ • /handover 管理               │    │
│  │ • Post-Mortem 流程           │  │ • /dashboard/stats             │    │
│  └──────────────┬───────────────┘  └──────────────┬─────────────────┘    │
│                 │                                 │                      │
│  ┌──────────────▼───────────────┐  ┌────────────▼─────────────────┐    │
│  │ 📋 Incident Response SOP     │  │ 💻 On-call Manager Script     │    │
│  │ INCIDENT_RESPONSE_SOP.md     │  │ oncall-manager.sh            │    │
│  │                              │  │                                │    │
│  │ • T+0→T+24h 标准时间线       │  │ • --current/--schedule        │    │
│  │ • 6个典型场景详细SOP         │  │ • --handover (交互式)         │    │
│  │ • 升级决策树                 │  │ • --escalate                  │    │
│  │ • 内/外通信模板              │  │ • --report                    │    │
│  └──────────────────────────────┘  └────────────────────────────────┘    │
│                                                                          │
│  ████████████████████████████████████████████████████████████████████     │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    知识库 (已有系统)                                │    │
│  │                                                                    │    │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────┐              │    │
│  │  │ TT 决策树 │  │ RB 运行手册   │  │ FMB 故障模式库  │              │    │
│  │  │ TT-001   │  │ RB-001~007   │  │ 22条 FM-*      │              │    │
│  │  │ ~TT-006  │  │              │  │               │              │    │
│  │  └──────────┘  └──────────────┘  └────────────────┘              │    │
│  │       ↑ 使用          ↑ 执行        ↑ 匹配/更新                   │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    验证与改进 (已有系统)                             │    │
│  │                                                                    │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐             │    │
│  │  │ O03 巡检引擎  │  │ O02 知识库    │  │ O05 风险评分   │             │    │
│  │  │ 验证恢复效果  │  │ 入口/索引     │  │ 优先级参考     │             │    │
│  │  └──────────────┘  └──────────────┘  └────────────────┘             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流时序

```
时间轴 →

[告警产生] [AIOps处理] [通知发送] [值班接收] [诊断] [修复] [验证] [复盘]

    │          │          │         │        │      │      │      │
    │          │          │         │        │      │      │      │
    ▼          ▼          ▼         ▼        ▼      ▼      ▼      ▼
 Prometheus  O01       Alert    On-call  TT     RB    O03   Post-
 Rules     Engine    Manager  Handbook Tree  Steps Engine Mortem
                        │         │        │      │      │      │
                        │         ▼        ▼      ▼      ▼      ▼
                        │      Team API   手册   脚本   自动   知识
                        │      创建事件   查阅   执行   巡检   更新
                        │         │        │      │      │      │
                        │         ▼        ▼      ▼      ▼      ▼
                        │      JSON文件  JSON   JSON  JSON   JSON
                        │      (collab)  (sched) (log)  (report)(FMB/RB/TT)
```

### 2.3 各模块间接口契约

| 模块 A | 模块 B | 接口方式 | 数据格式 | 触发条件 |
|--------|-------|---------|---------|---------|
| O01 AIOps | O07 Team API | HTTP POST `/incidents` | JSON (alert event) | AIOps 检测到需人工处理的告警 |
| O07 Team API | O03 巡检引擎 | HTTP GET 或 CLI 调用 | JSON (incident status) | 事件进入 monitoring/resolved 阶段 |
| O03 巡检引擎 | O07 Team API | HTTP PATCH `/incidents/:id` | JSON (status update) | 巡检结果确认恢复/未恢复 |
| O05 风险评分 | O07 On-call Handbook | 文档引用 | 风险等级作为优先级参考 | 值班人员查阅风险状态 |
| O07 Post-Mortem | O02 知识库 | 文档更新 (Git commit) | Markdown | 复盘后发现新模式/新步骤 |
| O07 Team API | oncall-manager.sh | 共享 JSON 文件 | JSON (`*.json`) | CLI 和 API 读写同一数据源 |

## 3. 多人开发 Git 分支策略

### 3.1 推荐方案：简化版 GitFlow

GlobalReach V2.0 当前使用 main-only 分支策略。随着团队扩展，建议迁移到以下分支模型：

```
main (生产分支)
  │  ← 只接受 merge request / PR
  │  ← 每次 merge 触发 CI/CD full pipeline
  │  ← tag 版本号 (vX.Y.Z)
  │
  ├── develop (开发集成分支)
  │     │  ← 日常开发的汇总分支
  │     │  ← 每个 feature 完成后 merge 回此
  │     │  ← 定期同步到 main (发布时)
  │     │
  │     ├── feature/O07-team-collab    ← 功能分支示例
  │     ├── feature/O08-xxx
  │     └── feature/O09-xxx
  │
  ├── hotfix/xxx                     ← 紧急修复 (直接从 main 分出)
  │     └── merge 回 main + develop
  │
  └── release/vX.Y.Z                 ← 发布准备分支 (可选)
```

#### 分支命名规范

| 类型 | 格式 | 示例 | 说明 |
|------|------|------|------|
| 功能开发 | `feature/Sxxx-简短描述` | `feature/S132-O07-team-collab` | 从 develop 分出 |
| Bug 修复 | `fix/Sxxx-简短描述` | `fix/S133-api-timeout-fix` | 从 develop 分出 |
| 热修复 | `hotfix/简短描述` | `hotfix/pg-connection-leak` | 从 main 分出 |
| 重构 | `refactor/模块名` | `refactor/auth-service` | 从 develop 分出 |
| 文档 | `docs/主题` | `docs/oncall-handbook` | 从 develop 分出 |

#### 分支保护规则

```yaml
branch_protection:
  main:
    require_pr: true          # 必须通过 PR 合并
    require_reviews: 1       # 至少 1 人 approve
    require_ci_pass: true    # CI 全绿才能 merge
    force_push: false        # 禁止 force push
    delete_source_branch: true  # 合并后自动删除源分支

  develop:
    require_pr: true
    require_reviews: 1       # 同事 review 即可
    require_ci_pass: true
    force_push: false

  feature/*:
    allow_force_push: true   # 功能分支允许 force push (rebase 时)

  hotfix/*:
    require_pr: true
    require_reviews: 2       # 热修复需要 2 人 approve
    require_ci_pass: true
    force_push: false
```

### 3.2 Commit 规范（Conventional Commits）

GlobalReach 已采用 Conventional Commits 格式，团队协作工作流的提交应遵循：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 列表**（本项目已定义）：

| Type | 使用场景 | 对应 CI Job |
|------|---------|-----------|
| `feat` | 新功能 | build + test + deploy |
| `fix` | Bug 修复 | build + test + deploy |
| `docs` | 文档变更 | config-validation (仅检查) |
| `refactor` | 重构（不改变行为） | build + test |
| `perf` | 性能优化 | performance job |
| `test` | 测试相关 | test job |
| `chore` | 构建/工具变更 | build |
| `style` | 代码格式（不影响逻辑） | lint |
| `ci` | CI 配置变更 | config-validation |

**Scope 命名约定**：

| Scope | 含义 | 示例 |
|-------|------|------|
| `S132` | Session 编号 | `feat(S132): add new feature` |
| `O01`~`O09` | 运维模块编号 | `fix(O07): fix incident status bug` |
| `RB-xxx` | Runbook 相关 | `docs(RB-001): add new scenario` |
| `TT-xxx` | 决策树相关 | `docs(TT-003): update memory branch` |
| `FM-xxx` | 故障模式相关 | `docs(FMB): add new failure mode` |
| `api` | API 层代码 | `feat(api): add new endpoint` |
| `db` | 数据库层 | `fix(db): fix connection pool leak` |
| `deploy` | 部署相关 | `chore(deploy): update docker-compose` |

### 3.3 PR/MR 模板

```markdown
## 类型: (☐ feat / ☐ fix / ☐ docs / ☐ refactor / ☐ chore)

## 描述
{简要描述这个变更做了什么}

## 关联 Issue
Closes #{issue_number} (如有)

## 变更内容
- {变更点 1}
- {变更点 2}
- {变更点 3}

## 测试计划
- [ ] 单元测试通过
- [ ] 手动测试 {功能}
- [ ] O03 巡检通过
- [ ] 无新增 P0/P1 告警

## 影响范围
- {受影响的组件/模块}
- {是否需要数据库迁移}
- {是否需要配置变更}
- {是否需要公告用户}

## 截图/GIF (可选)
{如果有 UI 变更, 附上截图}
```

## 4. Code Review 检查清单

### 4.1 通用检查项（所有 PR 必须）

#### A. 正确性 (Correctness)

- [ ] **A1** 代码实现了 PR 描述中的所有功能点
- [ ] **A2** 没有引入明显的回归问题（现有功能不受影响）
- [ ] **A3** 错误处理路径被覆盖（try/catch、错误返回码）
- [ ] **A4** 边界条件已被考虑（空输入、超长输入、并发）
- [ ] **A5** 数据验证在正确的层级执行（不应信任前端输入）

#### B. 安全性 (Security)

- [ ] **B1** 没有硬编码的密钥/密码/Token（应使用环境变量）
- [ ] **B2** SQL 查询使用参数化（防 SQL 注入）
- [ ] **B3** 用户输入经过 sanitize/escape（防 XSS）
- [ ] **B4** 认证/授权检查到位（不能遗漏权限校验）
- [ ] **B5** 敏感信息不会出现在日志或错误消息中
- [ ] **B6** 依赖版本无已知 CVE（`npm audit` / ` Dependabot`）

#### C. 性能 (Performance)

- [ ] **C1** 没有不必要的循环嵌套（注意 O(n²) 及以上复杂度）
- [ ] **C2** 数据库查询有适当的索引支持
- [ ] **C3** 大数据量场景下的分页/流式处理
- [ ] **C4** 缓存策略合理（不过度缓存也不过度穿透）
- [ ] **C5** 异步操作不阻塞主线程（Node.js 特有关注点）

#### D. 可维护性 (Maintainability)

- [ ] **D1** 代码遵循项目现有的风格和命名规范
- [ ] **D2** 函数/方法长度合理（通常 < 50 行）
- [ ] **D3** 魔法数字提取为有意义的常量
- [ ] **D4** 注释解释"为什么"而非"是什么"
- [ ] **D5** 不引入不必要的依赖（评估包大小和维护成本）

#### E. 测试 (Testing)

- [ ] **E1** 新增功能有对应的单元测试
- [ ] **E2** 边界情况有测试覆盖
- [ ] **E3** Mock 外部依赖（数据库、HTTP 服务等）
- [ ] **E4** 测试可以独立运行（不依赖特定环境状态）

### 4.2 特定场景检查项

#### 运维类 PR（O 系列 / scripts / docs）

- [ ] **O1** Runbook 步骤可在实际环境中复现执行
- [ ] **O2** Shell 脚本有 `set -euo pipefail` 保护
- [ ] **O3** 脚本有幂等性（重复执行不会产生副作用）
- [ ] **O4** 文档中的命令/路径与实际代码一致
- [ ] **O5** 告警规则 PromQL 语法正确且阈值合理
- [ ] **O6** 配置变更向后兼容（旧配置不会报错）

#### API 类 PR（api/routes / api/services）

- [ ] **API1** 端点有适当的 HTTP 方法（GET 读/POST 写/PATCH 更新）
- [ ] **API2** 响应格式统一（success/data/error 结构）
- [ ] **API3** 有请求参数验证（validator 中间件）
- [ ] **API4** 分页参数有上限限制（防止 DoS）
- [ ] **API5** 敏感端点需要更高权限（RBAC 检查）
- [ ] **API6** OpenAPI/Swagger 文档已更新（如适用）

#### 数据库类 PR（migrations / models）

- [ ] **DB1** Migration 可逆（有 up + down）
- [ ] **DB2** 不锁表过长时间（大表变更分批执行）
- [ ] **DB3** 默认值合理（NOT NULL 字段有默认值）
- [ ] **DB4** 索引命名遵循规范
- [ ] **DB5** 不删除列（标记为 deprecated 替代）

### 4.3 Review 评级标准

| 评级 | 含义 | 操作 |
|------|------|------|
| 👍 **Approve** | 满足所有必须项，可合并 | 点击 Approve |
| 👍 **Approve with suggestions** | 可以合并但有改进建议 | 点击 Approve + 留 Comment |
| 👀 **Request changes** | 存在必须修改的问题 | 打回修改，不可合并 |
| ❌ **Reject** | 方向性问题或严重缺陷 | 关闭 PR，重新讨论 |

## 5. 发布日历和冻结窗口策略

### 5.1 发布节奏

```
月度发布节奏示例:

  Week 1 (第1-7日)     Week 2 (第8-14日)    Week 3 (第15-21日)   Week 4 (第22-28日+)
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ 开发阶段      │   │ 开发阶段      │   │ 🔒 代码冻结   │   │ 🚀 发布周      │
  │              │   │              │   │              │   │              │
  │ • 新功能开发  │   │ • 功能完善    │   │ • 只接受 hotfix│   │ • 周二: 发布到  │
  │ • Bug 修复    │   │ • 测试补充    │   │ • 全面回归测试 │   │   │   staging    │
  │ • 技术探索    │   │ • 文档更新    │   │ • 性能基准测试 │   │ • 周三: 验证    │
  │              │   │              │   │ • 安全扫描    │   │ • 周四: 生产发布 │
  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

### 5.2 冻结窗口规则

| 窗口类型 | 时间范围 | 允许的操作 | 禁止的操作 |
|---------|---------|-----------|-----------|
| **硬冻结 (Hard Freeze)** | 发布前 3 天 | hotfix (需 L2+审批)、文档修正 | 新功能、重构、依赖升级、DB migration |
| **软冻结 (Soft Freeze)** | 发布前 1 周 | Bug fix、文档更新、小优化 | 新功能、架构变更、大规模重构 |
| **正常开发 (Open)** | 其他时间 | 所有类型的变更（遵循分支策略） | 直接 push 到 main |
| **紧急例外 (Emergency)** | 任何时间 | P0 级别的热修复（需 2 人 approve + L3 通知） | - |

### 5.3 发布检查清单

每次发布（包括 hotfix）前必须完成：

#### Pre-release（发布前）

- [ ] **PR1** 所有待发布的 PR 已合并到 release/main 分支
- [ ] **PR2** CI/CD 全绿（6 个 job 全部通过）
- [ ] **PR3** 数据库迁移脚本已准备好（如涉及 schema 变更）
- [ ] **PR4** `npm test` 全部通过（覆盖率 > 目标值）
- [ ] **PR5** `npm run lint` 无 error（warning 可接受但需说明）
- [ ] **PR6** 安全扫描无 Critical/High 漏洞
- [ ] **PR7** 性能基准测试无回归（P95 延迟不恶化 > 20%）
- [ ] **PR8** O03 巡检引擎全部维度 > 80 分
- [ ] **PR9** Release Note 已写好（发给团队的发布说明）
- [ ] **PR10** 回滚方案已准备好（如果发布失败如何快速回退）

#### Release Day（发布日）

- [ ] **RD1** Staging 环境部署成功
- [ ] **RD2** Staging 上冒烟测试通过（核心流程走一遍）
- [ ] **RD3** 数据库备份已完成（发布前的安全网）
- [ ] **RD4** 维护页面已准备好（如预计停机 > 5 分钟）
- [ ] **RD5** Status Page 已设置为 "Deploying" 状态
- [ ] **RD6** 生产环境部署启动
- [ ] **RD7** 部署完成后 O03 巡检确认全部通过
- [ ] **RD8** Status Page 更新为 "Operational"
- [ ] **RD9** 团队频道发布"发布完成"通知
- [ ] **RD10** 监控发布后 2 小时的指标（确保稳定）

#### Post-release（发布后）

- [ ] **PO1** 观察 24 小时内的告警和异常
- [ ] **PO2** 如有问题，立即启动 hotfix 流程
- [ ] **PO3** 发布 git tag（`vX.Y.Z`）
- [ ] **PO4** 更新 CHANGELOG.md

### 5.4 Hotfix 流程（紧急发布）

```
P0 问题发现
    │
    ▼
┌──────────────┐
│ 影响评估      │ ← 这个问题值得 hotfix 吗? (影响 > 100 用户 or 数据风险)
└──────┬───────┘
       │ 是
       ▼
┌──────────────┐
│ 从 main 分出   │ ← git checkout -b hotfix/xxx main
│ hotfix 分支   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 修复 + 测试   │ ← 最小化改动范围
│              │ ← 只修这一个 bug
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ PR (2人approve)│ ← 热修复需要更严格的 review
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ merge 到 main │ ← 同时 cherry-pick 到 develop
│ + develop     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 立即发布      │ ← 跳过常规发布节奏
│ (跳过冻结)    │ ← 但仍需完整的 pre-release 检查清单
└──────────────┘
```

## 6. 文件清单与部署指南

### 6.1 本次交付文件清单

```
docs/
├── oncall/
│   └── ONCALL_HANDBOOK.md              ← 新建 (~1395 行)
├── incident-response/
│   └── INCIDENT_RESPONSE_SOP.md        ← 新建 (~900 行)
└── TEAM_COLLABORATION_WORKFLOW.md      ← 新建 (本文件, ~500+ 行)

api/routes/
└── teamCollaboration.js                ← 新建 (团队协作 API, ~550 行)

scripts/
└── oncall-manager.sh                   ← 新建 (排班管理 CLI, ~450 行)

data/
├── team-collaboration.json             ← 新建 (运行时生成, API 数据存储)
└── oncall-schedule.json               ← 新建 (排班数据, 含示例成员)
```

**总计新建文件: 6 个**
**总代码/文档量: ~3800+ 行**

### 6.2 部署步骤

```bash
# 1. 确认新文件已存在
ls -la docs/oncall/ONCALL_HANDBOOK.md \
       docs/incident-response/INCIDENT_RESPONSE_SOP.md \
       api/routes/teamCollaboration.js \
       scripts/oncall-manager.sh \
       data/oncall-schedule.json

# 2. 设置脚本执行权限 (Linux/Mac)
chmod +x scripts/oncall-manager.sh

# 3. 在 server.js 中注册新的路由
#    在 api/server.js 中添加:
#
#    const teamCollabRoutes = require('./routes/teamCollaboration');
#    app.use('/api/v1/team', teamCollabRoutes);

# 4. 确保 data 目录存在并可写
mkdir -p data
ls -la data/

# 5. 验证 API 端点可用 (服务启动后)
curl http://localhost:3000/api/v1/team/oncall/current
curl http://localhost:3000/api/v1/team/dashboard/stats?days=7

# 6. 测试 CLI 工具
./scripts/oncall-manager.sh
./scripts/oncall-manager.sh --schedule
./scripts/oncall-manager.sh --help
```

### 6.3 与现有路由注册的集成

需要在 `api/server.js` 中添加以下内容：

```javascript
// 在现有路由注册区域添加
const teamCollabRoutes = require('./routes/teamCollaboration');
app.use('/api/v1/team', teamCollabRoutes);
```

**注意**：此文件名为 `teamCollaboration.js`（而非 `team.js`），因为 `teams.js` 已存在且用于业务团队管理功能（CRUD for business teams）。两者职责不同：
- `teams.js` → 业务团队管理（创建/加入/管理业务团队）
- `teamCollaboration.js` → 运维团队协作（On-call / Incident / PostMortem）

### 6.4 依赖检查

| 依赖 | 版本要求 | 用途 | 检查方式 |
|------|---------|------|---------|
| Node.js | >= 16.x | 运行时 | `node --version` |
| express | 已安装 | Web 框架 | `package.json` 中已有 |
| uuid | 需安装 | ID 生成 | `npm ls uuid` |
| fs (内置) | - | 文件 I/O | 内置模块 |
| path (内置) | - | 路径处理 | 内置模块 |
| jq | >= 1.6 | CLI 脚本 JSON 处理 | `jq --version` |

**如缺少 uuid**：
```bash
npm install uuid --save
```

### 6.5 后续迭代方向

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 集成到 server.js 路由注册 | 使 API 端点在生产环境可用 |
| P0 | AIOps → Team API 自动创建事件 | 告警触发时自动写入 incident |
| P1 | Webhook/邮件通知集成 | 升级通知和交接通知的实际发送 |
| P1 | Grafana 仪表盘面板 | On-call 状态和事件统计的可视化 |
| P2 | SQLite 存储替代 JSON 文件 | 更强的查询能力和并发安全 |
| P2 | 多租户支持 | 不同租户独立的 on-call 排班 |
| P3 | 移动端适配 | 手机上查看值班状态和处理事件 |

---

## 附录

### 附录 A: 快速参考卡片

```
╔════════════════════════════════════════════════════════╗
║     GlobalReach O07 团队协作 — Quick Reference         ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║  📕 On-call 手册:  docs/oncall/ONCALL_HANDBOOK.md     ║
║  📋 事件响应 SOP:  docs/incident-response/*.md         ║
║  🔧 Team API:      /api/v1/team/*                    ║
║  💻 管理脚本:      scripts/oncall-manager.sh           ║
║  📊 数据文件:      data/*.json                        ║
║                                                        ║
║  P0: <5min ACK, <30min FIX  → 电话+SMS+IM             ║
║  P1: <15min ACK, <2h FIX    → IM+Email               ║
║  P2: <1h ACK, <8h FIX       → Email                  ║
║  P3: <4h ACK, <48h FIX      → Email 汇总              ║
║                                                        ║
║  事件状态: detected→acknowledged→investigating→       ║
║           identified→resolving→monitoring→resolved     ║
║                                                        ║
║  交接检查: 25项 (A:8 + B:6 + C:4 + D:4 + E:3)        ║
║  复盘文化: Blameless (无罪责)                          ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
```

### 附录 B: 版本历史

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|---------|
| v1.0.0 | 2026-06-09 | S132/O07 Team | 初始版本: On-call 手册 + Incident SOP + Team API + 排班脚本 + 设计文档 |

---

> **文档结束**
>
> 本文档是 GlobalReach V2.0 团队协作工作流的总览设计。
> 详细操作请参考各子模块文档。
