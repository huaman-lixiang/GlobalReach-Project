# Phase O — 运营优化阶段 规划文档

> **文档版本**: v1.0-PLANNING
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **创建日期**: 2026-06-09
> **关联协议**: GLOBALREACH_S037_SELF_EXECUTE_PROTOCOL_v6.0 (Section 3.4)
> **Session**: S132 — Phase O 运营优化阶段规划

---

## 目录

- [第一章：Phase O 战略定位](#第一章phase-o-战略定位)
  - [1.1 为什么需要 Phase O](#11-为什么需要-phase-o)
  - [1.2 与 Phase M/N 的关系](#12-与-phase-mn-的关系)
  - [1.3 ROI 预估](#13-roi-预估)
  - [1.4 成功案例参考](#14-成功案例参考)
- [第二章：O01 AIOps 智能告警降噪 详细设计](#第二章o01-aiops-智能告警降噪-详细设计)
  - [2.1 告警风暴场景分类](#21-告警风暴场景分类)
  - [2.2 告警关联算法](#22-告警关联算法)
  - [2.3 自愈动作定义](#23-自愈动作定义)
  - [2.4 实现路线图](#24-实现路线图)
- [第三章：O02 运营知识库详细设计](#第三章o02-运营知识库详细设计)
  - [3.1 Runbook 模板体系](#31-runbook-模板体系)
  - [3.2 故障模式库 FMB 结构](#32-故障模式库-fmb-结构)
  - [3.3 决策树示例](#33-决策树示例)
  - [3.4 知识库维护流程](#34-知识库维护流程)
- [第四章：O03-O08 各任务详细规格](#第四章o03-o08-各任务详细规格)
  - [4.1 O03 自动化巡检引擎](#41-o03-自动化巡检引擎)
  - [4.2 O04 容量规划自动化](#42-o04-容量规划自动化)
  - [4.3 O05 变更风险评分系统](#43-o05-变更风险评分系统)
  - [4.4 O06 成本优化仪表盘](#44-o06-成本优化仪表盘)
  - [4.5 O07 团队协作工作流](#45-o07-团队协作工作流)
  - [4.6 O08 技术债务追踪板](#46-o08-技术债务追踪板)
- [第五章：Phase O 实施路线图](#第五章phase-o-实施路线图)
  - [5.1 任务依赖关系 DAG](#51-任务依赖关系-dag)
  - [5.2 建议执行顺序](#52-建议执行顺序)
  - [5.3 风险评估矩阵](#53-风险评估矩阵)
  - [5.4 回滚策略](#54-回滚策略)

---

## 第一章：Phase O 战略定位

### 1.1 为什么需要 Phase O

#### 1.1.1 从"有人运维"到"自主运维"的跨越

GlobalReach V2.0 经历了 Phase A（核心链路）到 Phase N（企业级增强）的完整演进，当前系统已具备：

- ✅ 完整的邮件营销功能链路（Campaign → Email → Report）
- ✅ 企业级特性（多租户、SSO、审计合规）
- ✅ 全栈监控体系（Prometheus + Grafana + AlertManager + Loki）
- ✅ 高可用架构设计（HA Docker Compose 配置就绪）
- ✅ 安全加固（TLSv1.3 + RBAC + Rate Limiting + WAF 头）

然而，当前的运维模式仍然是**被动响应式**的：
- 告警触发 → 人工查看 → 手动排查 → 手动修复
- 巡检依赖人工定期执行（`docker compose ps` / `curl health`）
- 故障处理经验分散在各处，缺乏系统化沉淀
- 资源使用情况缺乏趋势分析和预测能力
- 变更风险依赖个人经验判断，缺乏量化评估

**Phase O 的使命是将 GlobalReach 从"可运行的系统"升级为"会自我管理的智能系统"。**

这不是要引入复杂的商业 AIOps 平台或 ML 系统，而是基于现有的开源监控基础设施，通过**规则引擎 + 自动化脚本 + 知识库**的组合，实现运营效率的质变。

#### 1.1.2 当前痛点分析

| 痛点编号 | 痛点描述 | 影响范围 | 发生频率 | 当前缓解方式 |
|---------|---------|---------|---------|-------------|
| P-O-01 | 告警风暴时信息过载 | 运维效率 | 低频但高影响 | 无（人工过滤） |
| P-O-02 | 故障排查耗时长（缺乏知识指引） | MTTR | 中频 | 搜索历史 Session Report |
| P-O-03 | 巡检工作重复且易遗漏 | 运维质量 | 高频（每日） | 人工执行 checklist |
| P-O-04 | 资源瓶颈发现滞后 | 系统稳定性 | 低频 | Prometheus 告警（事后） |
| P-O-05 | 变更风险评估凭感觉 | 发布安全 | 每次变更 | 个人经验 |
| P-O-06 | 资源浪费不可见 | 成本控制 | 持续性 | 无系统性追踪 |
| P-O-07 | 协作流程不规范（交接/On-call）| 团队效率 | 每次 Session | 非标准化 |
| P-O-08 | 技术债务持续累积 | 代码健康度 | 持续性 | 无追踪机制 |

#### 1.1.3 Phase O 的价值主张

```
Phase O 核心价值 = 运营自动化 × 知识资产化 × 决策数据化

价值维度 1: 运营效率提升
  前: 每日巡检 30min + 告警处理平均 15min/条 + 故障排查 60min+
  后: 自动化巡检(0人工) + 智能告警降噪(减少70%噪声) + 知识库辅助排查(缩短50%时间)
  预期提升: 运营效率 +50%~70%

价值维度 2: 系统可靠性提升
  前: 被动响应故障, 平均检测时间(MTTD)未知
  后: 主动巡检检测 + 自愈动作 + 容量预测预警
  预期提升: MTTD 降低 60%+, MTTR 降低 40%+

价值维度 3: 知识资产积累
  前: 经验散落在各处, 新人上手慢
  后: Runbook库 + FMB + 决策树, 可复用的知识体系
  预期产出: 12+ Runbook, 30+ 故障模式, 6+ 决策树

价值维度 4: 数据驱动决策
  前: 凭经验和直觉做决策
  后: 风险评分 + 容量预测 + 成本分析 + 债务追踪
  预期效果: 决策质量可量化, 可追溯, 可改进
```

### 1.2 与 Phase M/N 的关系

#### 1.2.1 三阶段进化模型

GlobalReach 的后期演进遵循清晰的"三层进化"模型：

```
┌─────────────────────────────────────────────────────────────┐
│                  GlobalReach 进化三阶段模型                    │
│                                                             │
│   Phase M: 持续进化          Phase N: 企业级增强         Phase O: 运营优化  │
│   ════════════              ══════════════            ══════════════      │
│                                                             │
│   🔄 "让系统更好用"          🏢 "让系统更专业"           🧠 "让系统更聪明"    │
│                                                             │
│   关注点:                     关注点:                      关注点:             │
│   • 功能增量优化               • 多租户架构                   • 智能告警           │
│   • 性能微调                   • SSO单点登录                 • 自动巡检           │
│   • 监控完善                   • 审计合规                     • 容量预测           │
│   • 安全加固                   • 高可用设计                   • 风险评估           │
│   • 文档补全                   • 性能基准测试                 • 知识管理           │
│                                                             │
│   输出特征:                    输出特征:                     输出特征:            │
│   • 更多功能                   • 更高SLA承诺                • 更少人工干预        │
│   • 更好体验                   • 更合规                      • 更快恢复速度        │
│   • 更完善文档                 • 更强扩展性                  • 更深洞察力          │
│                                                             │
│   成熟度: ★★★★☆              成熟度: ★★★★★               成熟度: 目标 ★★★★★   │
│   (功能完备)                   (企业级标准)                  (智能化自主运营)       │
│                                                             │
│   Session数: 26               Session数: 8                 Session数: 规划8     │
│   代码行数: ~8000+            代码行数: ~20000+            产出类型: 文档+设计为主 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 1.2.2 各阶段的关键差异

| 维度 | Phase M | Phase N | Phase O |
|------|---------|---------|---------|
| **核心目标** | 系统更好用 | 系统更专业 | 系统更聪明 |
| **主要产出** | 代码+配置 | 架构+企业级功能 | 设计文档+自动化工具+知识库 |
| **变更粒度** | 小型功能改进 | 大型架构增强 | 流程和工具链 |
| **风险等级** | 低-中 | 中-高 | 低（以文档和脚本为主） |
| **用户可见性** | 高（UI/功能变化） | 中（后台能力） | 低（内部效率工具） |
| **ROI 见效周期** | 即时 | 中期（部署后） | 长期（积累效应） |
| **对现有系统的侵入性** | 中等 | 较高 | 很低 |

#### 1.2.3 Phase O 的独特定位

Phase O 与前两个阶段有本质区别：

1. **不是"加功能"而是"加智慧"**：Phase O 不新增面向用户的功能，而是增强系统自身的"感知-思考-行动"能力。
2. **不是"重构"而是"赋能"**：不修改核心业务逻辑，而是在外围构建智能化运维层。
3. **不是"一次性项目"而是"持续进化"**：Phase O 的产出（知识库、规则、模型）会随着系统运行不断丰富和优化。
4. **规划性质为主**：主要产出是设计方案、文档和轻量级脚本，而非大量业务代码。这符合"稳态运维"阶段的谨慎原则。

### 1.3 ROI 预估

#### 1.3.1 定量 ROI 分析

**投入估算**:

| 任务 | 工作量(h) | 人力成本假设(¥/h) | 总投入(¥) |
|------|----------|-------------------|----------|
| O01 AIOps 智能告警降噪 | 12 | 200 | 2,400 |
| O02 运营知识库构建 | 8 | 200 | 1,600 |
| O03 自动化巡检引擎 | 8 | 200 | 1,600 |
| O04 容量规划自动化 | 6 | 200 | 1,200 |
| O05 变更风险评分系统 | 6 | 200 | 1,200 |
| O06 成本优化仪表盘 | 4 | 200 | 800 |
| O07 团队协作工作流 | 4 | 200 | 800 |
| O08 技术债务追踪板 | 3 | 200 | 600 |
| **总计** | **51** | — | **¥10,200** |

> 注：以上为 AI Agent 辅助开发的工作量估算。如纯人工执行，工作量可能增加 2-3 倍。

**收益估算（年度）**:

| 收益来源 | 改善指标 | 年节省时间(h) | 价值换算(¥) |
|---------|---------|--------------|------------|
| 告警降噪减少无效工时 | 减少70%误报 | 150h/年 | ¥30,000 |
| 知识库加速故障排查 | 缩短50%排查时间 | 100h/年 | ¥20,000 |
| 自动化巡检替代手动 | 每日省30min | 125h/年 | ¥25,000 |
| 容量预警避免紧急扩容 | 避免2次/年紧急操作 | 20h/年 | ¥10,000 |
| 风险评分避免回滚事故 | 减少50%高风险变更 | 30h/年 | ¥15,000 |
| 成本优化降低资源浪费 | 降低15%资源冗余 | 间接收益 | ¥5,000 |
| **年度总收益** | — | **~425h** | **~¥105,000** |

**ROI 计算**:
- 投入: ¥10,200（一次性）
- 年收益: ¥105,000（持续性）
- **投资回报率: ~930%（首年）**
- **回收周期: ~1.2 个月**

#### 1.3.2 定性收益

除定量收益外，Phase O 还带来以下难以直接量化的价值：

1. **组织记忆固化**: 将 103 个 Session 的经验转化为可传承的知识资产，即使人员变动也不丢失。
2. **决策信心提升**: 从"我觉得应该这样"变为"数据显示应该这样"，降低决策焦虑。
3. **新人友好度大幅提升**: 新接手的人员可通过 Runbook 和决策树快速达到有效运维水平。
4. **系统可观测性深化**: 不仅知道"系统怎么了"，还能知道"为什么会这样"以及"该怎么做"。
5. **文化转变**: 从"救火模式"转向"防火模式"，建立主动预防的运维文化。

#### 1.3.3 ROI 敏感性分析

| 场景 | 假设条件 | ROI 变化 |
|------|---------|---------|
| 乐观场景 | 所有任务超预期完成，收益翻倍 | ROI > 1800% |
| 基准场景 | 按计划完成，收益符合预期 | ROI ~930% |
| 保守场景 | 仅完成 P0 任务(O01+O02)，其他延后 | ROI ~500%（仅 ¥4,000 投入） |
| 最差场景 | 仅文档产出，无实际自动化落地 | ROI ~100%（知识资产价值） |

**结论**: 即使在最保守的场景下，Phase O 的投入也是正向的——因为知识资产本身就有长期价值。

### 1.4 成功案例参考

#### 1.4.1 业界 AIOps 实践概览

**案例 1: Google SRE 的自动化运维实践**

Google Site Reliability Engineering (SRE) 团队是业界 AIOps 的先驱。其核心理念包括：

- **错误预算(Error Budget)**: 用 SLO（服务级别目标）驱动运维决策，而非追求 100% 可用性。
- **消除苦役(Toil Elimination)**: 通过自动化将重复性手工劳动降到最低，目标是将运维工程师的时间中 Toil 占比控制在 50% 以下。
- **渐进式自动化**: 先从最简单、最高频的任务开始自动化，逐步扩展到复杂场景。

**对 GlobalReach 的启示**: Phase O 的 O03（自动化巡检）和 O01（自愈动作）正是 Google SRE 理念的轻量级实践。

**案例 2: Netflix 的混沌工程 + 自动化运维**

Netflix 以其高度自动化的运维体系著称：

- **Chaos Monkey**: 主动制造故障来验证系统的自愈能力。
- **Spinnaker**: 多云持续交付平台，支持蓝绿部署、金丝雀发布。
- **自动伸缩**: 基于 CPU/内存/自定义指标的实时弹性伸缩。

**对 GlobalReach 的启示**: 虽然 GlobalReach 是单机 Docker Compose 部署，但 O01 的自愈动作设计和 O04 的容量预测借鉴了 Netflix 的主动防御思想。

**案例 3: 国内互联网公司的 AIOps 落地**

国内头部互联网公司（阿里、腾讯、字节跳动）在 AIOps 领域的实践：

- **阿里巴巴**: 智能运维平台"鹊桥"，基于异常检测、根因分析、容量规划的完整 AIOps 能力。
- **腾讯**: WeOps 平台，覆盖监控、告警、自动化、CMDB 的统一运维平台。
- **字节跳动**: 基于 Prometheus + 自研规则的智能告警系统，告警降噪率达到 85%+。

**对 GlobalReach 的启示**: 这些平台的复杂度远超 GlobalReach 的需求，但其核心思路（告警关联、根因分析、自动化动作）可以通过简化的方式实现。

**案例 4: 开源 AIOps 项目参考**

| 项目名称 | 类型 | 适用场景 | GlobalReach 可借鉴程度 |
|---------|------|---------|---------------------|
| Keepalived | 高可用 | VIP 漂移 | ⭐⭐⭐ HA 场景 |
| Consul | 服务发现 | 动态服务注册 | ⭐⭐ 服务治理 |
| Netdata | 实时监控 | 系统级指标可视化 | ⭐⭐⭐ 补充监控 |
| Grafana Loki | 日志聚合 | 已集成 | ⭐⭐⭐⭐⭐ 已在使用 |
| Victoria Metrics | 时序数据库 | Prometheus 替代 | ⭐⭐ 可选优化 |
| AlertManager | 告警管理 | 已集成 | ⭐⭐⭐⭐⭐ 已在使用 |
| Thanos | Prometheus 长期存储 | 高基数指标 | ⭐⭐ 未来考虑 |

#### 1.4.2 GlobalReach 的差异化路径

与上述案例相比，GlobalReach 的 Phase O 有明确的差异化定位：

```
大型企业 AIOps (阿里/腾讯/Google):
  复杂度: ★★★★★
  团队规模: 10-100人专职团队
  技术栈: 自研平台 + 商业产品 + 开源组合
  目标: 万级服务器集群的智能运维
  投入: 百万至千万级

GlobalReach Phase O:
  复杂度: ★★☆☆☆
  团队规模: AI Agent + 1人兼职运维
  技术栈: 纯开源 (Prometheus生态 + Node.js脚本)
  目标: 13个容器的智能运维
  投入: 万元以内 (AI Agent 辅助)

关键差异:
  1. 不追求"通用AIOps平台", 而是"针对GlobalReach定制"
  2. 不引入ML模型, 而是基于规则引擎+统计分析
  3. 不建设独立系统, 而是嵌入现有监控栈
  4. 以"实用够用"为原则, 不过度工程化
```

---

## 第二章：O01 AIOps 智能告警降噪 详细设计

### 2.1 告警风暴场景分类

#### 2.1.1 告警风暴定义

当系统在短时间内产生大量告警时，称为"告警风暴"(Alert Storm)。告警风暴的特征：

- **时间密集**: 在 Δt 时间窗口内（通常 5 分钟）产生 N 条以上告警（N ≥ 10）
- **根因单一**: 大部分告警由同一个底层问题引发（级联故障）
- **信噪比低**: 真正有价值的告警被大量重复/衍生告警淹没
- **处理压力**: 运维人员面临信息过载，难以快速识别真正的问题

#### 2.1.2 GlobalReach 可能的告警风暴场景

基于 GlobalReach 的 13 容器架构，以下是最可能发生的告警风暴场景：

**场景 A: PostgreSQL 故障级联（严重度: 🔴 Critical）**

```
触发条件: PostgreSQL 容器崩溃/OOM/磁盘满

级联路径:
PostgreSQL Down
  → API Gateway 数据库连接失败 (ContainerRestart + ErrorLog)
  → API Health Check database=unhealthy (HealthCheckFailed)
  → pg-exporter 无法连接 PG (TargetDown)
  → 用户请求全部返回 500 错误 (HTTPError5xxRate)
  → 如果使用了 Redis 缓存, 可能触发缓存未命中告警

预期告警数量: 8-15 条/5分钟
真实根因: 1 个 (PostgreSQL 故障)
有效告警: 1-2 条
噪声比例: 85%+
```

**场景 B: Docker 网络中断（严重度: 🔴 Critical）**

```
触发条件: Bridge 网络异常/DNS 解析失败

级联路径:
Network Unreachable
  → 所有容器间通信中断
  → Prometheus TargetDown × 4 (API/PG/Redis/node-exporter)
  → AlertManager 无法推送通知
  → Nginx upstream 全部失败
  → Loki/Promtail 日志采集中断

预期告警数量: 15-25 条/5分钟
真实根因: 1 个 (网络故障)
有效告警: 1-2 条
噪声比例: 90%+
```

**场景 C: 磁盘空间耗尽（严重度: 🟡 High）**

```
触发条件: Docker 数据目录/日志目录/PG 数据目录磁盘满

级联路径:
Disk Space Critical (>90%)
  → PostgreSQL 无法写入 WAL → DB Write Failed
  → Loki 无法写入日志 → LogWriteError
  → Docker 无法创建新容器/镜像 → ContainerCreateFailed
  → 备份脚本执行失败 → BackupFailed

预期告警数量: 5-10 条/5分钟
真实根因: 1 个 (磁盘满)
有效告警: 2-3 条
噪声比例: 70%
```

**场景 D: 内存泄漏导致 OOM（严重度: 🟡 High）**

```
触发条件: API 容器堆内存持续增长超过限制

级联路径:
ContainerOOMKilled (API)
  → API 健康检查失败
  → HTTP 5xx 错误率飙升
  → 用户无法访问前端页面
  → Docker 自动重启容器 (如果有 restart policy)

预期告警数量: 4-8 条/5分钟
真实根因: 1 个 (内存泄漏)
有效告警: 2 条
噪声比例: 65%
```

**场景 E: AlertManager 配置热更新错误（严重度: 🟢 Medium）**

```
触发条件: AlertManager 配置文件语法错误或路由规则冲突

级联路径:
AlertManagerConfigReloadError
  → 所有告警路由失效
  → 告警静默但系统可能已有故障未被通知
  → Webhook 推送失败

预期告警数量: 2-4 条/5分钟
真实根因: 1 个 (配置错误)
有效告警: 1 条
噪声比例: 50%
```

#### 2.1.3 告警风暴分级标准

| 等级 | 名称 | 告警密度阈值 | 典型场景 | 响应要求 |
|------|------|------------|---------|---------|
| L0 | 正常 | < 3 条/5min | 日常零星告警 | 正常处理 |
| L1 | 轻度密集 | 3-10 条/5min | 单组件多指标异常 | 关注即可 |
| L2 | 中度风暴 | 10-20 条/5min | 单根因级联故障 | 启动降噪流程 |
| L3 | 重度风暴 | 20-50 条/5min | 基础设施级故障 | 紧急降噪 + 根因定位 |
| L4 | 灾难级风暴 | > 50 条/5min | 全面故障 | 紧急止损 + 全力抢修 |

### 2.2 告警关联算法

#### 2.2.1 算法总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                  AIOps 告警关联引擎架构                        │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐  │
│  │ 告警输入  │ → │ 时间窗口  │ → │ 关联分析  │ → │ 输出    │  │
│  │ Ingest   │   │ 聚类     │   │ Engine   │   │ Output  │  │
│  └──────────┘   └──────────┘   └──────────┘   └─────────┘  │
│       │              │              │              │        │
│       ▼              ▼              ▼              ▼        │
│  AlertManager   Sliding Window   3种算法       合并事件     │
│  Webhook       (5min/10min)    并行执行      +根因报告     │
│  +Prometheus                                  +自愈建议    │
│                                                             │
│  ═════════════════════════════════════════════════════     │
│  三大关联算法:                                                │
│  Algorithm A: 时间窗口聚类 (Temporal Clustering)              │
│  Algorithm B: 拓扑依赖关联 (Topology Correlation)             │
│  Algorithm C: 标签相似度匹配 (Label Similarity)              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 2.2.2 Algorithm A: 时间窗口聚类 (Temporal Clustering)

**原理**: 同一根因引发的告警通常在短时间内集中爆发。通过滑动时间窗口将告警分组，窗口内的告警视为潜在关联组。

**参数配置**:

```yaml
temporal_clustering:
  window_size: 300s          # 滑动窗口大小: 5分钟
  slide_step: 60s            # 滑动步长: 1分钟
  min_alerts_for_storm: 5    # 窗口内最少告警数才触发风暴检测
  merge_threshold: 0.7       # 合并阈值: 70%的告警属于同一组才合并
```

**算法伪代码**:

```javascript
// alertCorrelationService.js - 时间窗口聚类核心逻辑
function temporalClustering(alerts, windowSize, slideStep) {
  const clusters = [];
  const now = Date.now();

  // 按时间排序
  const sortedAlerts = alerts.sort((a, b) => a.timestamp - b.timestamp);

  // 滑动窗口
  for (let windowStart = sortedAlerts[0].timestamp;
       windowStart <= now;
       windowStart += slideStep) {

    const windowEnd = windowStart + windowSize;
    const windowAlerts = sortedAlerts.filter(
      a => a.timestamp >= windowStart && a.timestamp <= windowEnd
    );

    if (windowAlerts.length >= MIN_ALERTS_FOR_STORM) {
      clusters.push({
        windowStart,
        windowEnd,
        alertCount: windowAlerts.length,
        alerts: windowAlerts,
        suspectedRootCause: findMostCommonSource(windowAlerts)
      });
    }
  }

  return deduplicateClusters(clusters);
}
```

**输出示例**:

```json
{
  "clusterId": "cl-20260609-001",
  "timestamp": "2026-06-09T10:05:00Z",
  "window": { "start": "10:00:00", "end": "10:05:00" },
  "alertCount": 12,
  "severityDistribution": { "critical": 2, "warning": 8, "info": 2 },
  "suspectedRootCause": {
    "component": "postgresql",
    "confidence": 0.85,
    "evidence": "8/12 alerts reference postgresql or database"
  },
  "mergedAlert": {
    "title": "[STORM] PostgreSQL 故障级联 - 12条告警合并为1条",
    "severity": "critical",
    "originalAlerts": ["alert-001", "alert-002", ..., "alert-012"]
  }
}
```

#### 2.2.3 Algorithm B: 拓扑依赖关联 (Topology Correlation)

**原理**: 利用 GlobalReach 的服务依赖拓扑图，判断告警之间的因果关系。下游服务的告警很可能是由上游服务的故障引起的。

**GlobalReach 服务拓扑图**:

```
                    ┌─────────────┐
                    │   Users     │
                    └──────┬──────┘
                           │ HTTPS
                    ┌──────▼──────┐
                    │   Nginx     │ ◄── TLS Termination
                    │  (:80/:443) │
                    └──────┬──────┘
                           │ Reverse Proxy
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼───┐ ┌──────▼──────┐
       │ React SPA   │ │ API  │ │   Grafana   │
       │ (Static)    │ │(:3000)│ │  (:3002)    │
       └─────────────┘ └──┬───┘ └─────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
       ┌──────▼──────┐ ┌──▼────┐ ┌──────▼──────┐
       │ PostgreSQL  │ │ Redis │ │ Mailpit     │
       │  (:5432)    │ │(:6379)│ │ (:1025)     │
       └─────────────┘ └───────┘ └─────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
       ┌──────▼──────┐ ┌──▼────┐ ┌──────▼──────┐
       │ Prometheus  │ │ Loki  │ │AlertManager │
       │  (:9090)    │ │(:3100)│ │  (:9093)    │
       └──────┬──────┘ └──┬────┘ └──────┬──────┘
              │            │             │
       ┌──────▼──────┐ ┌──▼──────────────▼──┐
       │node-exporter│ │ promtail           │
       │  (:9100)    │ │ (internal)         │
       └─────────────┘ └────────────────────┘
```

**拓扑关联规则**:

```yaml
topology_rules:
  # 上游故障优先原则: 上游组件的告警优先被视为根因
  priority_order:
    - network          # 网络层最基础
    - docker           # 容器运行时
    - postgresql       # 数据库是核心依赖
    - redis            # 缓存层
    - api_gateway      # 应用层
    - nginx            # 接入层
    - monitoring       # 监控组件（通常是受害者）

  # 因果推断规则
  causal_rules:
    # 如果 PostgreSQL down + API errors → PG 是根因
    - condition: "postgres_down AND api_5xx_errors"
      root_cause: "postgresql"
      confidence: 0.95

    # 如果 network_error AND multiple_target_down → Network 是根因
    - condition: "network_unreachable AND target_down_count >= 3"
      root_cause: "network"
      confidence: 0.98

    # 如果 disk_full AND db_write_errors → Disk 是根因
    - condition: "disk_space_critical AND (db_write_failed OR log_write_failed)"
      root_cause: "disk"
      confidence: 0.92

    # 如果 container_oom AND service_errors → OOM 是根因
    - condition: "container_oom_killed AND (http_5xx_rate_increase OR health_check_failed)"
      root_cause: "memory"
      confidence: 0.88
```

#### 2.2.4 Algorithm C: 标签相似度匹配 (Label Similarity)

**原理**: Prometheus 告警携带丰富的标签信息（instance, job, severity, component 等）。具有相似标签集合的告警很可能是同一问题的不同表现。

**相似度计算方法**:

```javascript
// alertCorrelationService.js - 标签相似度计算
function calculateLabelSimilarity(alertA, alertB) {
  const labelsA = new Set(Object.entries(alertA.labels).flat());
  const labelsB = new Set(Object.entries(alertB.labels).flat());

  // Jaccard 相似系数
  const intersection = new Set([...labelsA].filter(x => labelsB.has(x)));
  const union = new Set([...labelsA, ...labelsB]);
  const jaccardSimilarity = intersection.size / union.size;

  // 加权: component 和 instance 标签权重更高
  const keyLabels = ['component', 'instance', 'job', 'alertname'];
  let keyMatchCount = 0;
  for (const label of keyLabels) {
    if (alertA.labels[label] === alertB.labels[label]) {
      keyMatchCount++;
    }
  }
  const keyLabelScore = keyMatchCount / keyLabels.length;

  // 综合相似度 = 0.4 * Jaccard + 0.6 * KeyLabel
  return 0.4 * jaccardSimilarity + 0.6 * keyLabelScore;
}

// 告警分组
function groupBySimilarity(alerts, threshold = 0.7) {
  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < alerts.length; i++) {
    if (assigned.has(i)) continue;

    const group = [alerts[i]];
    assigned.add(i);

    for (let j = i + 1; j < alerts.length; j++) {
      if (assigned.has(j)) continue;
      if (calculateLabelSimilarity(alerts[i], alerts[j]) >= threshold) {
        group.push(alerts[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}
```

#### 2.2.5 综合关联决策

三种算法的结果通过投票机制综合：

```yaml
fusion_policy:
  method: weighted_voting
  weights:
    temporal_clustering: 0.30    # 时间聚类: 判断是否为风暴
    topology_correlation: 0.45   # 拓扑关联: 判断根因方向
    label_similarity: 0.25       # 标签相似度: 细粒度分组

  decision_thresholds:
    storm_detection: 0.75        # ≥75% 置信度判定为风暴
    root_cause_confidence: 0.80  # ≥80% 置信度输出根因
    auto_heal_trigger: 0.90      # ≥90% 置信度触发自愈

  fallback:
    when_all_low_confidence: "output_raw_alerts_with_warning"
    when_conflict: "prefer_topology_result"
```

### 2.3 自愈动作定义

#### 2.3.1 自愈动作分类

```
┌─────────────────────────────────────────────────────────────┐
│                    自愈动作分类体系                            │
│                                                             │
│  Level 0: 信息级 (Informational)                             │
│  ├─ 自动记录: 将告警事件写入审计日志                          │
│  ├─ 自动标记: 在仪表盘中标注异常状态                          │
│  └─ 自动通知: 发送汇总通知给 On-call 人员                     │
│                                                             │
│  Level 1: 恢复级 (Recovery) — 需预授权                       │
│  ├─ 容器重启: docker restart <container>                    │
│  ├─ 服务重载: nginx -s reload / 优雅重启                     │
│  └─ 连接池清理: 清理 stale 的数据库/Redis 连接                │
│                                                             │
│  Level 2: 调优级 (Adaptation) — 需确认                       │
│  ├─ 临时扩容: 调整容器 resource limits (向上)                │
│  ├─ 流量切换: 切换到备用上游 (如有 HA 配置)                   │
│  ├─ 降级处理: 暂停非核心功能释放资源                          │
│  └─ 限流调整: 动态调整 rate limit 阈值                       │
│                                                             │
│  Level 3: 保护级 (Protection) — 仅紧急情况                    │
│  ├─ 故障隔离: 将故障节点从负载均衡中移除                      │
│  ├─ 紧急备份: 触发即时数据库备份                              │
│  └─ 模式切换: 切换到降级运行模式                              │
│                                                             │
╰─────────────────────────────────────────────────────────────┯
│ 安全约束:                                                    │
│ • Level 1+ 动作必须经过 pre-authorization 或 real-time confirm │
│ • 每个自愈动作都有 rollback 方案                               │
│ • 自愈执行后必须在 60s 内验证效果                              │
│ • 连续 3 次自愈失败的同类动作自动禁用                          │
│ • 所有自愈操作记录到 audit_log                                │
└─────────────────────────────────────────────────────────────┘
```

#### 2.3.2 自愈动作模板库

**模板 SH-01: 容器异常重启**

```yaml
self_heal_template:
  id: "SH-01-container-restart"
  name: "容器异常自动重启"
  level: 1
  trigger_conditions:
    - alert_name: "ContainerNotRunning"
      component_match: ["api", "nginx", "postgres", "redis"]
      duration: "> 30s"
      auto_heal_enabled: true

  action:
    type: "docker_restart"
    command: "docker restart {{container_name}}"
    timeout: 30s
    verification:
      type: "health_check"
      endpoint: "/api/v1/health"
      expected_status: 200
      wait_after_action: 15s

  rollback:
    type: "manual_intervention"
    description: "如果重启后仍未恢复, 执行对应 Runbook 的故障排查流程"

  safety_limits:
    max_retries_per_hour: 3
    cooldown_between_retries: 120s
    disable_after_consecutive_failures: 3
```

**模板 SH-02: API OOM 恢复**

```yaml
self_heal_template:
  id: "SH-02-api-oom-recovery"
  name: "API 容器 OOM 恢复"
  level: 2
  trigger_conditions:
    - alert_name: "ContainerOOMKilled"
      component: "api"
      evidence: "heap_usage_percent > 90% before OOM"

  action:
    step_1:
      type: "docker_restart"
      command: "docker restart globalreach-api"
    step_2:
      type: "config_adjustment"
      description: "临时将 Node.js heap size limit 增加 50%"
      config_file: "Dockerfile or docker-compose"
      change: "NODE_OPTIONS=--max-old-space-size={{current*1.5}}"

  rollback:
    step_1: "还原原始 heap size 配置"
    step_2: "如果 OOM 反复发生, 触发 O04 容量规划分析"
```

**模板 SH-03: 磁盘空间紧急清理**

```yaml
self_heal_template:
  id: "SH-03-disk-emergency-cleanup"
  name: "磁盘空间紧急清理"
  level: 2
  trigger_conditions:
    - alert_name: "DiskSpaceCritical"
      threshold: "> 90%"
      component: any

  action:
    step_1:
      type: "docker_cleanup"
      command: "docker system prune -f --volumes"
      expected_freed: "> 500MB"
    step_2:
      type: "log_retention_reduce"
      description: "临时将 Loki 日志保留期从 7天缩减到 3天"
    step_3:
      type: "backup_cleanup"
      description: "删除超过 30 天的旧备份文件"

  rollback:
    description: "磁盘空间恢复正常后, 还原日志保留期设置"
```

**模板 SH-04: PostgreSQL 连接池耗尽恢复**

```yaml
self_heal_template:
  id: "SH-04-pg-connection-pool-exhaustion"
  name: "PostgreSQL 连接池耗尽恢复"
  level: 1
  trigger_conditions:
    - alert_name: "PostgreSQLConnectionPoolExhausted"
      active_connections: "= max_connections"

  action:
    step_1:
      type: "query_termination"
      description: "终止 idle in transaction 超过 5分钟的连接"
      query: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle in transaction' AND now() - query_start > interval '5 minutes'"
    step_2:
      type: "connection_pool_restart"
      description: "如果使用 PgBouncer, 重启连接池"

  rollback:
    description: "检查是否有长事务被意外终止, 通知相关应用层"
```

**模板 SH-05: Nginx 高并发限流保护**

```yaml
self_heal_template:
  id: "SH-05-nginx-rate-limit-protection"
  name: "Nginx 高并发自动限流"
  level: 2
  trigger_conditions:
    - alert_name: "NginxHighConcurrency"
      connections: "> 500"
      or:
    - alert_name: "HTTPError5xxRateHigh"
      rate: "> 10%"

  action:
    type: "rate_limit_tighten"
    description: "动态调低 Nginx limit_req 阈值 (从 10r/s 降至 5r/s)"
    config_change:
      file: "nginx/conf.d/production.conf"
      directive: "limit_req zone=api burst=20 nodelay;"
      to: "limit_req zone=api burst=10 nodelay;"
    reload: "nginx -s reload"

  rollback:
    description: "负载恢复正常后, 还原原始限流配置"
    cooldown: 300s  # 至少等待 5 分钟后再还原
```

#### 2.3.3 自愈动作安全框架

```javascript
// selfHealingOrchestrator.js - 安全框架核心逻辑
class SelfHealingOrchestrator {
  constructor(config) {
    this.authorizationMode = config.authorizationMode; // 'pre-auth' | 'realtime-confirm' | 'auto'
    this.auditLogger = config.auditLogger;
    this.safetyLimiter = new SafetyLimiter(config.safetyLimits);
  }

  async executeHealingAction(alertCluster, template) {
    // Step 1: 权限检查
    const authResult = await this.checkAuthorization(template.level);
    if (!authResult.authorized) {
      return { status: 'awaiting_confirmation', action: template.id };
    }

    // Step 2: 安全限制检查
    if (!this.safetyLimiter.canExecute(template.id)) {
      return { status: 'blocked_by_safety_limit', reason: this.safetyLimiter.getReason(template.id) };
    }

    // Step 3: 记录审计日志
    await this.auditLogger.log({
      event: 'self_heal_execute',
      templateId: template.id,
      triggerAlerts: alertCluster.alerts.map(a => a.fingerprint),
      timestamp: new Date().toISOString()
    });

    // Step 4: 执行动作
    try {
      const result = await this.executeAction(template.action);
      
      // Step 5: 效果验证
      const verified = await this.verifyEffect(template.verification);
      
      // Step 6: 记录结果
      this.safetyLimiter.recordResult(template.id, verified ? 'success' : 'failure');
      
      return { status: verified ? 'success' : 'verification_failed', result };
    } catch (error) {
      this.safetyLimiter.recordResult(template.id, 'error');
      throw error;
    }
  }
}
```

### 2.4 实现路线图

#### 2.4.1 分阶段实施计划

```
Phase O-O01 实施路线图 (总计 12h):

Week 1 (基础搭建, 6h):
├── Day 1-2 (4h): 告警关联引擎核心开发
│   ├── alertCorrelationService.js 基础框架
│   ├── 时间窗口聚类算法实现
│   ├── 标签相似度匹配算法实现
│   └── 单元测试 (模拟告警数据验证)
│
├── Day 3 (2h): 拓扑关联规则 + 综合融合
│   ├── GlobalReach 拓扑图定义 (YAML)
│   ├── 拓扑关联规则引擎
│   ├── 三算法加权投票融合器
│   └── 集成测试

Week 2 (集成与自愈, 6h):
├── Day 4-5 (4h): AlertManager 集成 + 仪表盘
│   ├── AlertManager Webhook 接收端适配
│   ├── aiops-rules.yml 告警抑制/分组规则
│   ├── Grafana AIOps 仪表盘 (告警关联图谱)
│   └── 根因报告生成器
│
└── Day 6 (2h): 自愈动作编排
    ├── 5 个自愈动作模板实现
    ├── 安全框架 (权限+限制+审计)
    └── 端到端测试 (模拟告警风暴→降噪→自愈→验证)
```

#### 2.4.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 告警接收 | AlertManager Webhook → Express API | 已有 Webhook Listener (M-C03) |
| 关联引擎 | Node.js (与现有技术栈一致) | 无需引入新语言/运行时 |
| 数据存储 | 内存 + JSON 文件持久化 | 告警数据量小, 无需数据库 |
| 规则引擎 | 自研 YAML 规则解析 | 轻量, 可读性好, 易于维护 |
| 仪表盘 | Grafana JSON Dashboard | 已有 Grafana, 统一展示 |
| 调度 | Node.js setInterval / cron | 简单定时任务需求 |

#### 2.4.3 与现有系统集成点

```
                    ┌─────────────────────┐
                    │   AlertManager      │
                    │   (已有, 9093)       │
                    └─────────┬───────────┘
                              │ Webhook (已有M-C03)
                              ▼
                    ┌─────────────────────┐
                    │  WebhookListener    │ ← 已有服务扩展
                    │  (已有, 增强)        │
                    └─────────┬───────────┘
                              │ 内部调用 (新增)
                              ▼
                    ┌─────────────────────┐
                    │ AlertCorrelationSvc │ ← 新增 O01 核心
                    │ RootCauseAnalyzer   │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │SelfHealing  │ │ Grafana     │ │ 通知聚合    │
    │Orchestrator │ │ AIOps       │ │ (合并通知)  │
    │ (新增)      │ │ Dashboard   │ │             │
    └──────┬──────┘ └─────────────┘ └─────────────┘
           │
           ▼
    ┌─────────────┐
    │ Docker API  │ ← 执行容器操作
    │ (restart等) │
    └─────────────┘
```

---

## 第三章：O02 运营知识库详细设计

### 3.1 Runbook 模板体系

#### 3.1.1 Runbook 统一模板结构

每个组件的 Runbook 都遵循统一的模板结构，确保一致性和完整性：

```markdown
# {组件名} Runbook — GlobalReach 运维手册

> **组件标识**: {component-id}
> **版本**: v1.0
> **最后更新**: YYYY-MM-DD
> **维护负责人**: {owner}
> **关联告警规则**: {alert-rule-names}

---

## 1. 组件概述

### 1.1 功能描述
{该组件在 GlobalReach 架构中的角色和职责}

### 1.2 技术规格
| 项目 | 值 |
|------|-----|
| 容器名 | {container-name} |
| 镜像 | {image} |
| 端口 | {ports} |
| 资源限制 | {resource-limits} |
| 数据卷 | {volumes} |
| 依赖服务 | {dependencies} |
| 被依赖方 | {dependents} |

### 1.3 关键配置文件
{列出该组件的关键配置文件及其路径}

---

## 2. 日常健康检查

### 2.1 快速检查命令 (30秒内完成)
```bash
# 容器状态
docker inspect --format='{{.State.Status}}' {container-name}

# 基础健康指标
curl -sf http://localhost:{port}/health || echo "UNHEALTHY"

# 资源使用
docker stats --no-stream {container-name}
```

### 2.2 深度检查命令 (2分钟内完成)
{包含更详细的诊断命令}

### 2.3 健康指标基线
| 指标 | 正常范围 | 警戒值 | 严重值 |
|------|---------|--------|--------|
| CPU 使用率 | < 30% | 30-70% | > 70% |
| 内存使用率 | < 50% | 50-80% | > 80% |
| ... | ... | ... | ... |

---

## 3. Top 5 常见故障及处理

### 故障 #1: {故障名称}
**症状**: {如何识别这个故障}
**原因**: {常见原因列表}
**影响**: {对系统的影响范围}
**排查步骤**:
1. {step 1}
2. {step 2}
3. {step 3}
**解决方案**:
- 方案 A (推荐): {具体操作}
- 方案 B (备选): {具体操作}
**预防措施**: {如何避免再次发生}
**关联 FMB 条目**: {FMB-ID}

### 故障 #2-5: (同上格式)

---

## 4. 维护操作

### 4.1 日常维护清单
- [ ] {每日检查项}
- [ ] {每周检查项}
- [ ] {每月检查项}

### 4.2 配置变更指南
{如何安全地修改该组件的配置}

### 4.3 版本升级指南
{如何安全地升级该组件}

### 4.4 备份与恢复
{该组件的数据备份策略}

---

## 5. 性能调优

### 5.1 当前性能基线
{基准性能数据和采集时间}

### 5.2 已知性能瓶颈
{已发现的性能问题和计划}

### 5.3 调优选项
{可选的性能优化措施及风险}

---

## 6. 安全注意事项

### 6.1 访问控制
{该组件的安全访问配置}

### 6.2 敏感信息
{涉及的安全敏感信息}

### 6.3 审计要点
{需要特别关注的安全审计项}

---

## 附录
- A: 相关文档链接
- B: 相关告警规则详情
- C: 变更历史
```

#### 3.1.2 各组件 Runbook 重点内容

**Runbook-01: Nginx (globalreach-nginx)**

重点内容：
- TLS/SSL 证书管理（有效期检查、续期流程）
- 反向代理配置调试（upstream 健康检查、负载均衡）
- 安全头配置验证（HSTS/CSP/X-Frame-Options 等 6 项）
- 限流规则调优（limit_req / limit_conn）
- 日志格式与访问日志分析
- 常见故障：502 Bad Gateway / 504 Gateway Timeout / SSL 握手失败

**Runbook-02: API Gateway (globalreach-api)**

重点内容：
- Node.js 进程管理（堆内存、事件循环延迟）
- Express.js 中件链路排查
- 数据库连接池状态监控
- Redis 缓存命中率
- 邮件队列积压处理
- JWT Token 刷新机制
- 常见故障：堆内存溢出(OOM)/数据库连接超时/邮件发送失败

**Runbook-03: PostgreSQL (globalreach-postgres)**

重点内容：
- 连接池管理（max_connections / PgBouncer）
- 表空间和索引维护（VACUUM / REINDEX）
- 慢查询分析和优化
- WAL 和备份策略
- 主从复制状态（如果启用 HA）
- 常见故障：连接池耗尽 / 磁盘满 / 慢查询锁表 / WAL 段过多

**Runbook-04: Redis (globalreach-redis)**

重点内容：
- 内存使用策略（maxmemory + eviction policy）
- 持久化配置（RDB / AOF）
- 主从/Sentinel 状态
- 常用命令（INFO / MONITOR / SLOWLOG）
- 常见故障：内存溢出 / 持久化失败 / 主从同步延迟

**Runbook-05: Prometheus (globalreach-prometheus)**

重点内容：
- TSDB 存储管理和保留策略
- 目标(target)可达性管理
- 录制规则和告警规则热加载
- 查询性能优化（高基数标签处理）
- 远程写入配置（如果对接 Thanos）
- 常见故障：TSDB 磁盘满 / 目标抓取失败 / 查询超时

**Runbook-06: Grafana (globalreach-grafana)**

重点内容：
- Dashboard 和 DataSource 管理
- 用户权限和匿名访问配置
- Plugin 管理和安全审查
- 会话和认证配置
- 常见故障：DataSource 连接失败 / Dashboard 加载慢 / 插件兼容性问题

**Runbook-07: AlertManager (alertmanager)**

重点内容：
- 路由树配置和调试
- 抑制(Inhibition)和静默(Silence)管理
- 通知模板和接收器配置
- Webhook 集成和 HMAC 验证
- 高可用集群配置（如需）
- 常见故障：路由配置错误 / 通知发送失败 / 配置热加载失败

**Runbook-08: Loki (loki)**

重点内容：
- LogQL 查询语言速查
- 日志保留策略和压缩
- Promtail 配置和采集管道
- 多租户日志隔离
- 常见故障：日志写入失败 / 查询超时 / 磁盘占用过高

**Runbook-09: Mailpit (globalreach-mailpit)**

重点内容：
- SMTP 邮件捕获和查看
- API 端点使用
- 邮件释放和转发
- 与生产 SMTP 的切换
- 常见故障：端口冲突 / 消息队列满

**Runbook-10: Tempo (globalreach-tempo)**

重点内容：
- Trace 数据采集和查询
- OTel 集成配置
- 存储和保留策略
- 常见故障：采样率配置 / 存储后端连接问题

**Runbook-11: Docker Compose 编排层**

重点内容：
- docker-compose.prod.yml 完整解读
- 网络配置 (Bridge 网络)
- Volume 挂载和环境变量
- 服务启动顺序和 depends_on
- 常见故障：网络冲突 / Volume 权限 / 端口占用

**Runbook-12: 基础设施和网络层**

重点内容：
- Docker daemon 健康检查
- 主机资源监控 (CPU/内存/磁盘/网络)
- DNS 解析配置
- 防火墙规则
- 时间同步 (NTP)
- 常见故障：Docker daemon 崩溃 / 磁盘 I/O 瓶颈 / DNS 解析失败

### 3.2 故障模式库 FMB 结构

#### 3.2.1 FMB 条目模板

```yaml
# Failure Mode Base 条目模板
fmb_entry:
  id: "FMB-{NNN}"                    # 唯一标识
  title: "{故障模式名称}"              # 简短标题
  category: "{组件类别}"               # postgresql/api/nginx/network/...
  severity: critical | high | medium | low | info  # 严重程度
  frequency: frequent | occasional | rare | one-time  # 发生频率
  status: active | resolved | mitigated | archived   # 当前状态

  symptoms:                            # 症状描述
    observable:
      - "{可观察到的现象1}"
      - "{可观察到的现象2}"
    alerts_triggered:
      - "{触发的告警规则名}"
    user_impact: "{对用户的可见影响}"

  root_cause_analysis:                 # 根因分析
    primary_cause: "{主要原因}"
    contributing_factors:
      - "{促成因素1}"
      - "{促成因素2}"
    detection_method: "{如何检测到此故障}"

  resolution:                          # 解决方案
    immediate_fix: "{立即修复方案}"
    permanent_fix: "{永久修复方案}"
    rollback_if_needed: "{回滚方案}"
    estimated_recovery_time: "{预估恢复时间}"

  prevention:                          # 预防措施
    monitoring_enhancement: "{监控增强}"
    process_improvement: "{流程改进}"
    code_change: "{代码变更(如有)}"
    documentation_update: "{文档更新}"

  related_items:                       # 关联项
    runbook_ref: "{关联Runbook}"
    decision_tree_ref: "{关联决策树}"
    session_history: ["S{NNN}", "S{NNN}"]  # 相关Session
    aiops_template: "{关联自愈模板(如有)}"

  metadata:
    first_seen: "YYYY-MM-DD"
    last_seen: "YYYY-MM-DD"
    occurrence_count: N
    mttr_average: "{平均恢复时间}"
    created_by: "{记录人}"
    last_updated: "YYYY-MM-DD"
```

#### 3.2.2 FMB 目录分类

```yaml
fmb_catalog:
  # === 基础设施层 ===
  infrastructure:
    - id: "FMB-001"
      title: "Docker Bridge 网络中断"
      severity: critical
      frequency: rare
      # ...

    - id: "FMB-002"
      title: "主机磁盘空间耗尽"
      severity: critical
      frequency: occasional
      # ...

    - id: "FMB-003"
      title: "Docker Daemon 崩溃/OOM"
      severity: critical
      frequency: rare
      # ...

  # === 数据库层 ===
  database:
    - id: "FMB-010"
      title: "PostgreSQL 连接池耗尽"
      severity: high
      frequency: occasional
      # ...

    - id: "FMB-011"
      title: "PostgreSQL 慢查询导致锁等待"
      severity: high
      frequency: occasional
      # ...

    - id: "FMB-012"
      title: "PostgreSQL WAL 段堆积"
      severity: medium
      frequency: rare
      # ...

    - id: "FMB-013"
      title: "PostgreSQL 磁盘空间不足"
      severity: critical
      frequency: occasional
      # ...

  # === 缓存层 ===
  cache:
    - id: "FMB-020"
      title: "Redis 内存溢出 (OOM)"
      severity: high
      frequency: rare
      # ...

    - id: "FMB-021"
      title: "Redis 持久化失败 (RDB/AOF)"
      severity: medium
      frequency: occasional
      # ...

  # === 应用层 ===
  application:
    - id: "FMB-030"
      title: "API 容器堆内存溢出 (OOM)"
      severity: high
      frequency: occasional
      # ...

    - id: "FMB-031"
      title: "API 事件循环阻塞 (Event Loop Lag)"
      severity: high
      frequency: rare
      # ...

    - id: "FMB-032"
      title: "邮件发送队列积压"
      severity: medium
      frequency: occasional
      # ...

    - id: "FMB-033"
      title: "JWT Token 刷新失败"
      severity: medium
      frequency: rare
      # ...

  # === 接入层 ===
  ingress:
    - id: "FMB-040"
      title: "Nginx 502 Bad Gateway"
      severity: high
      frequency: occasional
      # ...

    - id: "FMB-041"
      title: "SSL/TLS 证书过期或配置错误"
      severity: high
      frequency: rare
      # ...

    - id: "FMB-042"
      title: "Nginx 限流导致正常请求被拒"
      severity: low
      frequency: occasional
      # ...

  # === 监控层 ===
  monitoring:
    - id: "FMB-050"
      title: "Prometheus TSDB 磁盘满"
      severity: medium
      frequency: rare
      # ...

    - id: "FMB-051"
      title: "AlertManager 配置热加载失败"
      severity: low
      frequency: occasional
      # ...

    - id: "FMB-052"
      title: "Loki 日志写入失败"
      severity: medium
      frequency: occasional
      # ...

    - id: "FMB-053"
      title: "Grafana DataSource 连接断开"
      severity: low
      frequency: occasional
      # ...

  # === 历史已解决故障 (来自 Phase A-N) ===
  historical_resolved:
    - id: "FMB-H01"
      title: "API Health Check Worker Status Bug (S068)"
      severity: high
      status: resolved
      # ...

    - id: "FMB-H02"
      title: "Dockerfile HEALTHCHECK Syntax Error (S078)"
      severity: medium
      status: resolved
      # ...

    # ... (共 6 个历史故障)
```

#### 3.2.3 FMB 统计仪表盘指标

FMB 应提供以下统计视图：

| 维度 | 指标 | 说明 |
|------|------|------|
| 按严重度分布 | Critical/High/Medium/Low 各多少 | 了解整体风险态势 |
| 按组件分布 | 每个组件的故障模式数量 | 识别薄弱环节 |
| 按状态分布 | Active/Resolved/Mitigated/Archived | 了解处理进度 |
| MTTR 趋势 | 平均恢复时间的变化 | 衡量运维效率改善 |
| 复发率 | 同一故障模式的复发次数 | 评估预防措施有效性 |
| 新增速率 | 每月新发现的故障模式数 | 了解系统成熟度 |

### 3.3 决策树示例

#### 3.3.1 决策树设计原则

```
决策树设计原则:
1. 每个节点必须是二元判断 (Yes/No)，避免模糊选择
2. 叶子节点必须有明确的行动指令 (不是"继续调查")
3. 最大深度不超过 6 层 (避免决策疲劳)
4. 每条路径的总耗时应有预估 (帮助排优先级)
5. 必须包含"escalate to human"的出口 (不要陷入死循环)
6. 必须引用具体的命令/文件/Runbook (不要说"检查一下")
```

#### 3.3.2 决策树 DT-01: API 不可用

```
                         ┌──────────────────────┐
                         │  用户报告 API 不可用   │
                         │  或 健康检查失败       │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │ curl localhost:3000   │
                         │ /api/v1/health 返回?  │
                         └──────────┬───────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   │ 200 OK         │ 非 200 / 超时    │ 连接拒绝
                   ▼                ▼                ▼
            ┌──────────┐    ┌──────────┐    ┌──────────┐
            │ 检查子组件 │    │ API进程? │    │ 容器状态? │
            │ 状态      │    │          │    │          │
            └────┬─────┘    └────┬─────┘    └────┬─────┘
                 │                │                │
         ┌───────┼───────┐       │         ┌──────┼──────┐
         │DB unhealthy│Redis fail│Email queue│ Up    │ CrashLoop│Exited
         ▼           ▼         ▼          ▼       ▼          ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────┐┌──────┐ ┌─────────┐
    │FMB-010  │ │FMB-020  │ │FMB-032  │ │检查  ││SH-01 │ │查看日志  │
    │PG Runbook│ │Redis    │ │邮件队列  │ │Nginx ││重启  │ │FMB-030  │
    └─────────┘ │Runbook  │ │Runbook  │ │Upstream││模板  │ │API OOM  │
                └─────────┘ └─────────┘ │配置   └──────┘ └─────────┘
                                         └──────┘
                                            │
                                      ┌─────┴─────┐
                                      │FMB-040    │
                                      │Nginx 502  │
                                      │Runbook    │
                                      └───────────┘

预计耗时: 最佳路径 2min / 最差路径 15min
最后更新: S132
关联 Runbook: RB-02 (API Gateway), RB-01 (Nginx), RB-03 (PostgreSQL), RB-04 (Redis)
```

**Markdown 格式文本版**:

```markdown
# DT-01: API 不可用故障排查决策树

## 开始: 用户报告 API 不可用 或 健康检查失败

### Step 1: API 端点可达性检查
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health
```
- **返回 200** → 转 Step 2 (子组件检查)
- **返回非 200 / 超时 / 连接拒绝** → 转 Step 3 (API 进程/容器检查)

### Step 2: 子组件健康检查 (API 本身可达但报告有问题)
检查 health response body 中的各个字段:
```bash
curl -s http://localhost:3000/api/v1/health | jq .
```
- **database != healthy** → 参考 [RB-03 PostgreSQL Runbook](runbooks/postgresql-runbook.md) → FMB-010
- **redis != healthy** → 参考 [RB-04 Redis Runbook](runbooks/redis-runbook.md) → FMB-020
- **email_queue != healthy** → 检查邮件队列积压 → FMB-032
- **system_resources.heapUsagePercent > 80%** → 内存警告, 准备扩容

### Step 3: API 进程/容器检查
```bash
docker compose -f docker-compose.prod.yml ps api
```
- **Status = Up** → 转 Step 4 (Nginx/网络层检查)
- **Status = Restarting / CrashLoop** → 执行 [SH-01 容器重启模板](../aiops/self-heal-templates.md) → 查看 `docker logs globalreach-api --tail=100` → FMB-030
- **Status = Exited** → `docker compose up -d api` → 如果立即退出, 查看日志

### Step 4: Nginx/网络层检查
```bash
# Nginx 到 API 的连通性
docker exec globalreach-nginx wget -qO- http://api:3000/api/v1/health
```
- **可达** → 问题在 Nginx 外部 (客户端 DNS/防火墙)
- **不可达** → 检查 Nginx upstream 配置 → [RB-01 Nginx Runbook](runbooks/nginx-runbook.md) → FMB-040

### Escalate 条件
如果以上所有步骤都无法定位问题:
1. 收集完整日志: `docker compose logs --tail=500 > debug-logs.txt`
2. 收集系统资源: `docker stats --no-stream > resources.txt`
3. 联系 On-call 高级运维人员
4. 如 30 分钟内无法恢复, 考虑执行 [场景 D: 数据库回滚](../ROLLBACK_PROCEDURE.md)
```

#### 3.3.3 其他决策树概要

| 决策树 ID | 名称 | 入口条件 | 预估深度 | 预估最佳耗时 |
|-----------|------|---------|---------|-------------|
| DT-01 | API 不可用 | 健康检查失败 / 用户报错 | 4 层 | 2 min |
| DT-02 | 数据库慢查询 | API 响应时间 > 500ms | 5 层 | 5 min |
| DT-03 | 邮件发送失败 | 邮件队列积压 / 发送错误 | 4 层 | 3 min |
| DT-04 | 告警风暴处理 | 5 分钟内 > 10 条告警 | 3 层 | 1 min |
| DT-05 | 内存泄漏排查 | 堆内存持续增长 | 5 层 | 10 min |
| DT-06 | SSL 证书问题 | HTTPS 访问异常 / 证书告警 | 3 层 | 2 min |

### 3.4 知识库维护流程

#### 3.4.1 知识库生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                    知识库条目生命周期                          │
│                                                             │
│   ┌───────┐   ┌───────┐   ┌───────┐   ┌───────┐   ┌─────┐ │
│   │ Draft │ → │ Review│ → │Active │ → │Update │ → │Archive│
│   │ 草稿  │   │ 审核  │   │ 生效  │   │ 更新  │   │ 归档  │ │
│   └───┬───┘   └───┬───┘   └───┬───┘   └───┬───┘   └───┬─┘ │
│       │           │           │           │           │    │
│  新增故障/  同行审核    可用于    新发现    超过12个月   │
│  新增经验    质量检查    生产排查   补充信息   未更新     │
│                                                             │
│  触发条件:                                                  │
│  • 每次故障处理后必须新增/更新 FMB 条目                      │
│  • 每季度审核一次 Runbook 准确性                             │
│  • 决策树在实际使用中发现缺陷时立即更新                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 3.4.2 维护 SOP

**日常维护 (每次 Session 结束后)**:
1. 本次 Session 是否遇到新的故障？ → 是则新建 FMB 条目
2. 本次 Session 是否使用了知识库？ → 是则反馈使用体验
3. 是否有 Runbook 内容需要修正？ → 提交更新 PR

**月度维护 (每月第一个 Session)**:
1. 审核 FMB 中所有 "active" 条目的时效性
2. 检查 Runbook 中的命令是否仍然有效（环境可能变化）
3. 更新决策树的 Escalate 路径
4. 生成知识库健康报告（覆盖率/准确率/使用频率）

**季度维护 (每季度末)**:
1. 全面审查所有 Runbook，对照最新系统状态
2. 清理归档过时的 FMB 条目（> 6 个月未复发）
3. 评估知识库整体质量，制定下季度改进计划
4. 向项目干系人汇报知识库价值（MTTR 改善数据）

#### 3.4.3 质量保证机制

```yaml
knowledge_base_quality_gates:
  runbook_quality:
    - each_runbook_must_have_top_5_faults: true
    - each_command_must_be_testable: true
    - each_runbook_must_link_to_at_least_one_fmb: true
    - update_frequency: "at_least_quarterly"

  fmb_quality:
    - each_entry_must_have_root_cause: true
    - each_entry_must_have_prevention: true
    - each_entry_must_link_to_runbook: true
    - no_duplicate_entries: true

  decision_tree_quality:
    - max_depth: 6
    - all_leaves_must_have_action: true
    - all_paths_must_have_time_estimate: true
    - must_include_escalation_path: true
```

---

## 第四章：O03-O08 各任务详细规格

### 4.1 O03 自动化巡检引擎

#### 4.1.1 用户故事

```
As a 运维工程师,
I want the system to automatically perform comprehensive health checks on a regular schedule,
So that I don't have to manually run docker compose ps and curl commands every day,
And potential issues are detected and reported before they become incidents.
```

#### 4.1.2 技术方案选型

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| GitHub Actions Cron Job | 免费、无需常驻进程 | 依赖外部服务、延迟较高 | ❌ 备选 |
| Node.js cron 脚本 | 与技术栈一致、灵活 | 需要常驻进程或外部调度 | ✅ 主要方案 |
| Docker 内置健康检查 | 已有、零额外开销 | 只能检查单个容器、不够全面 | ❌ 补充 |
| Prometheus Recording Rules | 已有基础设施、声明式 | 只能做指标计算、不能执行复杂逻辑 | ❌ 辅助 |

**最终方案**: Node.js 脚本 + Windows Task Scheduler / cron 调度

#### 4.1.3 数据流图

```
[调度器: cron/Task Scheduler]
    │
    │ 触发 (每日 09:00 / 每小时 :00)
    ▼
[inspection-engine.js 主程序]
    │
    ├──► [检查模块 1: 基础设施层]
    │   │   docker ps → 容器状态
    │   │   docker stats → 资源使用
    │   │   df -h → 磁盘空间
    │   │   docker info → daemon 健康
    │   │
    ├──► [检查模块 2: 应用层]
    │   │   curl /api/v1/health → API 健康
    │   │   解析 health response → 子组件状态
    │   │   检查 email_queue 积压量
    │   │
    ├──► [检查模块 3: 监控层]
    │   │   Prometheus /api/v1/targets → 目标状态
    │   │   AlertManager /api/v2/alerts → 活跃告警
    │   │   Loki /ready → 日志系统状态
    │   │
    ├──► [检查模块 4: 安全层]
    │   │   openssl x509 → SSL 证书有效期
    │   │   curl -I → 安全头检查
    │   │   npm audit / trivy → 最近扫描结果
    │   │
    ├──► [检查模块 5: 数据层]
    │   │   检查最近备份文件存在性和大小
    │   │   psql 查询表空间使用率
    │   │   检查慢查询统计
    │   │
    ▼
[结果聚合器]
    │   计算总体评分 (0-100)
    │   生成各维度分数
    │   识别异常项
    │
    ├──► [报告生成器]
    │   │   输出 JSON (机器可读)
    │   │   输出 Markdown (人类可读)
    │   │
    ├──► [通知分发器]
    │   │   P0 异常 → 立即通知 (Webhook/邮件)
    │   │   P1-P2 → 汇总到日报
    │   │
    └──► [历史存储]
        │   写入 inspection-history/
        │   用于趋势对比
        ▼
    [Grafana 仪表盘] ← 读取历史数据展示趋势
```

#### 4.1.4 API/UI 设计要点

巡检引擎主要以 CLI 脚本形式运行，不需要独立的 UI。交互方式：

```bash
# 手动触发完整巡检
node scripts/inspection-engine.js --profile full

# 快速巡检 (仅检查关键指标)
node scripts/inspection-engine.js --profile quick

# 仅检查指定维度
node scripts/inspection-engine.js --modules infrastructure,application

# 输出 JSON 格式 (用于程序消费)
node scripts/inspection-engine.js --format json --output report.json

# 查看上次巡检结果
node scripts/inspection-engine.js --last

# 对比两次巡检结果的差异
node scripts/inspection-engine.js --compare --baseline report-20260608.json
```

**Grafana 仪表盘面板设计**:
- 巡检评分趋势线 (过去 30 天)
- 各维度评分雷达图
- 异常事件时间线
- 巡检耗时趋势
- Top 5 最常出现异常的检查项

#### 4.1.5 与现有系统的集成点

- **Prometheus**: 通过 HTTP API 获取目标和告警数据
- **Docker**: 通过 Docker API (或 CLI wrapper) 获取容器状态
- **API Gateway**: 通过 /api/v1/health 获取应用状态
- **Grafana**: 通过 Dashboard 展示巡检历史趋势
- **AlertManager**: 巡检发现的 P0 异常可通过 AlertManager 发送通知

### 4.2 O04 容量规划自动化

#### 4.2.1 用户故事

```
As a 系统管理员,
I want to receive automated capacity forecasts and scaling recommendations,
So that I can proactively address resource bottlenecks before they cause outages,
Instead of reacting to emergencies when disks fill up or memory runs out.
```

#### 4.2.2 技术方案选型

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| PromQL 线性回归 | 利用现有 Prometheus 数据 | 表达能力有限 | ✅ 主要方案 |
| Python statsmodels | 强大的时序分析能力 | 需要额外的 Python 环境 | ❌ 过重 |
| Facebook Prophet | 行业标准的预测工具 | 重量级、学习成本高 | ❌ 过度工程 |
| 简单移动平均 | 简单易懂 | 不适合捕捉趋势 | ❌ 不够准确 |

**最终方案**: Node.js 实现 PromQL 查询 + 简单线性回归 + 季节性因子调整

#### 4.2.3 数据流图

```
[Prometheus TSDB] (历史指标数据)
    │
    │ PromQL 查询 (过去 7/30/90 天)
    ▼
[capacity-planner.js]
    │
    ├──► [数据采集层]
    │   │   CPU 趋势: rate(container_cpu_usage_seconds_total[5m])
    │   │   内存趋势: container_memory_working_set_bytes
    │   │   磁盘趋势: node_filesystem_avail_bytes
    │   │   网络趋势: rate(container_network_transmit_bytes_total[5m])
    │   │   连接趋势: pg_stat_activity count / redis_connected_clients
    │   │
    ├──► [预测引擎]
    │   │   线性回归拟合
    │   │   季节性调整 (工作日 vs 周末)
    │   │   异常值过滤
    │   │   置信区间计算 (95% CI)
    │   │
    ├──► [推荐引擎]
    │   │   当预测值 > 阈值的 80% → 生成 Warning 建议
    │   │   当预测值 > 阈值的 95% → 生成 Critical 建议
    │   │   建议类型: 扩容/优化/清理/迁移
    │   │
    ▼
[输出]
    │
    ├──► 容量报告 (Markdown + JSON)
    ├──► Grafana 仪表盘 (预测曲线 + 阈值线)
    └──► AlertManager 告警 (预测型告警)
```

#### 4.2.4 预测模型细节

**线性回归模型**:

```javascript
// capacity-planner.js - 简单线性回归
function linearRegression(dataPoints) {
  // dataPoints: [{x: timestamp, y: value}, ...]
  const n = dataPoints.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (const point of dataPoints) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // 计算 R² (拟合优度)
  const yMean = sumY / n;
  let ssTotal = 0, ssResidual = 0;
  for (const point of dataPoints) {
    const predicted = slope * point.x + intercept;
    ssTotal += Math.pow(point.y - yMean, 2);
    ssResidual += Math.pow(point.y - predicted, 2);
  }
  const rSquared = 1 - ssResidual / ssTotal;

  return { slope, intercept, rSquared, predict: (x) => slope * x + intercept };
}

function forecast(model, daysAhead, confidenceLevel = 0.95) {
  const predictions = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let d = 1; d <= daysAhead; d++) {
    const futureTime = now + d * dayMs;
    const predictedValue = model.predict(futureTime);
    
    // 简化的置信区间 (假设残差正态分布)
    const margin = predictedValue * 0.15; // ±15% 近似置信区间
    
    predictions.push({
      day: d,
      date: new Date(futureTime).toISOString().split('T')[0],
      predicted: Math.round(predictedValue),
      lowerBound: Math.round(predictedValue - margin),
      upperBound: Math.round(predictedValue + margin),
      confidence: confidenceLevel
    });
  }

  return predictions;
}
```

### 4.3 O05 变更风险评分系统

#### 4.3.1 用户故事

```
As a developer making changes to the codebase,
I want an automated risk assessment score before committing my changes,
So that I can understand the potential impact and take appropriate precautions,
And avoid introducing regressions that could affect production stability.
```

#### 4.3.2 技术方案选型

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| Git Hook (pre-commit) | 实时、集成到工作流 | 仅能分析 staged changes | ✅ 主要方案 |
| CI Pipeline 步骤 | 可分析完整 PR | 反馈较晚 | ✅ 补充方案 |
| IDE 插件 | 即时反馈 | 需要安装、跨 IDE 支持 | ❌ 优先级低 |
| ML 模型 | 可能更准确 | 需要训练数据、黑盒 | ❌ 过度工程 |

**最终方案**: Git pre-commit hook + CI pipeline 双轨并行

#### 4.3.3 风险评分模型

```yaml
risk_scoring_model:
  version: "1.0"
  dimensions:

    # 维度 1: 变更范围 (权重 25%)
    scope:
      weight: 0.25
      factors:
        files_changed:
          single_file: 1        # 1 个文件
          few_files_2_5: 2       # 2-5 个文件
          many_files_6_15: 4     # 6-15 个文件
          large_change_16+: 6    # 16+ 个文件

        components_touched:
          ui_only: 1             # 仅前端
          api_only: 2             # 仅后端 API
          infra_only: 3           # 仅基础设施配置
          api_plus_infra: 4       # API + 基础设施
          full_stack: 6           # 全栈变更

        schema_change:
          none: 0                 # 无 Schema 变更
          additive: 3             # 仅添加列/表
          modificative: 5         # 修改列/表
          destructive: 8          # 删除列/表 (高危!)

    # 维度 2: 变更类型 (权重 20%)
    change_type:
      weight: 0.20
      factors:
        documentation: 1          # 仅文档变更
        test_code: 1              # 测试代码
        feature_addition: 3       # 新功能
        bug_fix: 2                # Bug 修复
        refactoring: 3            # 重构
        config_change: 4          # 配置变更
        dependency_update: 4      # 依赖更新
        infrastructure: 5         # 基础设施变更
        security_fix: 3           # 安全修复 (重要但不一定高风险)

    # 维度 3: 历史影响 (权重 20%)
    history:
      weight: 0.20
      factors:
        file_change_frequency:    # 该文件的变更频率
          rarely_changed: 1       # < 3 次/月
          occasionally: 2         # 3-10 次/月
          frequently: 4            # > 10 次/月 (高频变更文件风险更高)
        
        fault_correlation:        # 该文件/组件的历史故障关联
          no_known_issues: 1       # 无已知问题
          minor_issues: 2          # 有过小问题
          major_incidents: 5       # 曾导致重大故障
        
        recent_changes:            # 最近是否有频繁变更
          stable_period: 1         # 最近 7 天无变更
          recent_changes: 3        # 最近 7 天有变更
          very_recent: 5           # 最近 24 小时有变更

    # 维度 4: 回滚复杂度 (权重 15%)
    rollback:
      weight: 0.15
      factors:
        rollback_ease:
          trivial: 1              # git revert 即可
          simple: 2               # 需要手动回退配置
          moderate: 3             # 需要数据库迁移回滚
          complex: 5              # 涉及多个系统协调
          difficult: 8            # 回滚可能导致数据不一致

        data_migration_required:
          no: 1
          yes_reversible: 4
          yes_irreversible: 8

    # 维度 5: 测试覆盖 (权重 20%)
    testing:
      weight: 0.20
      factors:
        unit_test_coverage:
          full_coverage: 1        # 100% 覆盖
          good_coverage: 2        # > 80% 覆盖
          partial_coverage: 3     # 50-80% 覆盖
          minimal_coverage: 4     # < 50% 覆盖
          no_tests: 6             # 无测试

        integration_test:
          exists_and_passes: 1
          exists_but_failing: 4
          does_not_exist: 3        # 没有集测但有单测比没有测试好

  scoring:
    formula: "weighted_sum of all dimension scores"
    max_score: 100
    risk_levels:
      very_low:    { range: [0, 20],   label: "🟢 极低", action: "常规提交即可" }
      low:         { range: [21, 40],  label: "🟢 低",   action: "自行 review 后提交" }
      medium:      { range: [41, 60],  label: "🟡 中等", action: "需要 peer review" }
      high:        { range: [61, 80],  label: "🟠 高",   action: "需要 peer review + 回滚计划" }
      very_high:   { range: [81, 100], label: "🔴 极高", action: "需要团队评审 + 变更窗口 + 完整回滚方案" }
```

#### 4.3.4 输出示例

```
╔══════════════════════════════════════════════════════════╗
║           Change Risk Assessment Report                   ║
║                                                           ║
║  Commit: abc1234 (feat: add multi-language support)       ║
║  Author: developer@example.com                            ║
║  Timestamp: 2026-06-09T10:30:00Z                         ║
║                                                           ║
║  ┌─────────────────────┬────────┬────────┬────────────┐  ║
║  │ Dimension           │ Score  │ Weight │ Weighted   │  ║
║  ├─────────────────────┼────────┼────────┼────────────┤  ║
║  │ Scope               │ 18/30  │  25%   │   4.50     │  ║
║  │ Change Type         │ 12/20  │  20%   │   2.40     │  ║
║  │ History Impact      │ 8/20   │  20%   │   1.60     │  ║
║  │ Rollback Complexity │ 10/20  │  15%   │   1.50     │  ║
║  │ Test Coverage       │ 6/10   │  20%   │   1.20     │  ║
║  ├─────────────────────┼────────┼────────┼────────────┤  ║
║  │ TOTAL RISK SCORE    │        │        │  **11.20** │  ║
║  ══════════════════════╪════════╪════════╪════════════╣  ║
║  │ Risk Level          │  🟢 LOW (23/100)              │  ║
║  │ Recommended Action  │  自行 review 后提交             │  ║
║  ╚═════════════════════╩════════╩════════╩════════════╝  ║
║                                                           ║
║  Key Findings:                                             ║
║  ✓ Changed 4 files across frontend + i18n modules         ║
║  ✓ No database schema changes detected                    ║
║  ✓ Modified files have good historical stability          ║
║  ⚠ Unit test coverage for i18n files is below 50%         ║
║                                                           ║
╚══════════════════════════════════════════════════════════╝
```

### 4.4 O06 成本优化仪表盘

#### 4.4.1 用户故事

```
As a system owner,
I want a dashboard showing resource utilization efficiency and optimization opportunities,
So that I can identify waste and make informed decisions about resource allocation,
And ensure the system runs cost-effectively as it scales.
```

#### 4.4.2 仪表盘面板设计

| 面板 ID | 面板名称 | 类型 | 数据源 | 说明 |
|---------|---------|------|--------|------|
| C01 | 资源利用率总览 | Gauge | node-exporter | 13 容器的 CPU/内存平均利用率 |
| C02 | 容器资源热力图 | Heatmap | docker stats | 每个容器的实时资源使用 |
| C03 | CPU 利用率趋势 | Time Series | Prometheus | 30 天 CPU 趋势 |
| C04 | 内存利用率趋势 | Time Series | Prometheus | 30 天内存趋势 |
| C05 | 磁盘使用趋势 | Time Series | node-exporter | 分区级别的磁盘使用趋势 |
| C06 | 低效容器识别 | Table | Prometheus | 长期低负载 (< 20%) 的容器列表 |
| C07 | 日志存储成本 | Stat | Loki | Loki 数据量和增长率 |
| C08 | 备份存储成本 | Stat | filesystem | 备份文件大小和保留策略效果 |
| C09 | Docker 清理潜力 | Stat | docker system df | 可回收的空间 |
| C10 | 优化建议优先级 | Table | 综合计算 | 按节省金额排序的优化建议 |
| C11 | 资源浪费趋势 | Time Series | 综合 | 月度资源浪费金额趋势 |
| C12 | 运维效率指标 | Gauge | 综合计算 | MTTR/MTTD/变更频率 |
| C13 | 成本对比 (实际 vs 预算) | Bar Chart | 综合计算 | 实际资源使用 vs 分配额度 |
| C14 | 优化机会时间线 | Timeline | 综合计算 | 历史优化操作和效果 |
| C15 | 资源分配合理性 | Pie Chart | docker-compose | 各容器的资源配额占比 |

#### 4.4.3 优化建议生成逻辑

```javascript
// resource-auditor.sh / resource-auditor.js 核心逻辑
function generateOptimizationRecommendations(metrics) {
  const recommendations = [];

  // 规则 1: 内存过度配置检测
  for (const container of metrics.containers) {
    const avgMem = container.memory.usagePercent.avg30d;
    const limitMem = container.memory.limitPercent;
    if (avgMem < 20 && limitMem > 50) {
      recommendations.push({
        id: `OPT-MEM-${container.name}`,
        priority: 'medium',
        category: 'memory_overprovision',
        container: container.name,
        current: `${avgMem}% avg usage`,
        recommended: `Reduce memory limit from ${limitMem}% to ${Math.max(avgMem * 2, 30)}%`,
        estimated_saving: `~${((limitMem - avgMem * 2) * 512)}MB`,
        effort: 'low',  // 修改 docker-compose 即可
        risk: 'low'
      });
    }
  }

  // 规则 2: 日志保留过长
  const lokiSize = metrics.loki.totalSizeGB;
  const lokiRetentionDays = metrics.loki.retentionDays;
  if (lokiRetentionDays > 7 && lokiSize > 5) {
    recommendations.push({
      id: 'OPT-LOG-001',
      priority: 'medium',
      category: 'log_retention',
      current: `${lokiRetentionDays} days retention, ${lokiSize}GB total`,
      recommended: `Reduce retention to 7 days, enable compaction`,
      estimated_saving: `~${Math.round(lokiSize * (lokiRetentionDays - 7) / lokiRetentionDays)}GB`,
      effort: 'low',
      risk: 'low'
    });
  }

  // 规则 3: Docker 清理
  const danglingImages = metrics.docker.danglingImagesSizeMB;
  const stoppedContainers = metrics.docker.stoppedContainersCount;
  if (danglingImages > 500 || stoppedContainers > 5) {
    recommendations.push({
      id: 'OPT-DOCKER-001',
      priority: 'high',
      category: 'docker_cleanup',
      current: `${danglingImages}MB dangling images, ${stoppedContainers} stopped containers`,
      recommended: 'Run: docker system prune -f',
      estimated_saving: `~${danglingImages}MB immediate`,
      effort: 'minimal',
      risk: 'none'
    });
  }

  // ... 更多规则

  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
```

### 4.5 O07 团队协作工作流

#### 4.5.1 用户故事

```
As a team member responsible for system operations,
I want standardized workflows for on-call handover, incident response, and change management,
So that every team member follows consistent practices regardless of who is on duty,
And knowledge is preserved even when team members change.
```

#### 4.5.2 On-call 值班手册核心内容

```markdown
# On-call 值班手册

## 值班角色定义

| 角色 | 职责 | 要求 |
|------|------|------|
| Primary (主值班) | 第一响应人, 负责处理所有告警和事件 | 熟悉全部 Runbook |
| Secondary (副值班) | 支援 Primary, Primary 不可用时接管 | 熟悉核心 Runbook |
| Escalation (升级联系人) | 处理 P0 级事件和复杂故障 | 系统架构师级别 |

## 交接 Checklist

### 接班时 (Start of Shift)
- [ ] 阅读 On-call 日志中自上次交接以来的所有条目
- [ ] 确认当前活跃的事件和它们的处理状态
- [ ] 检查系统仪表盘, 确认无红色/橙色告警
- [ ] 确认手机/通知渠道畅通
- [ ] 了解即将计划的变更和维护窗口
- [ ] 确认上一班次的遗留事项

### 交班时 (End of Shift)
- [ ] 书写本次值班日志摘要
- [ ] 记录所有处理过的事件和处理结果
- [ ] 标记所有进行中的事项和下一步行动
- [ ] 传递任何重要的上下文信息
- [ ] 确认接班人已完全理解当前状态

## 升级条件

| 条件 | 操作 |
|------|------|
| P0 事件持续 > 30min 未恢复 | 联系 Secondary |
| P0 事件持续 > 60min 未恢复 | 联系 Escalation |
| 不确定如何处理的事件 | 立即联系 Secondary |
| 同时发生 2+ 个 P1 事件 | 联系 Secondary 分担 |
| 涉及数据安全的事件 | 立即联系 Escalation |
```

#### 4.5.3 事件响应 SOP 要点

```
事件响应生命周期 (Incident Response Lifecycle):

DETECT (检测)
  ↓ 自动: AIOps 告警 / 巡检引擎发现
  ↓ 人工: 用户报告 / 运维人员观察
TRIAGE (分诊)
  ↓ 评估严重度 (P0-P3)
  ↓ 确定影响范围
  ↓ 选择初始响应者
RESPOND (响应)
  ↓ 按照 Decision Tree 执行排查
  ↓ 记录每一步操作和时间戳
  ↓ 尝试修复 (参照 Runbook)
ESCALATE (升级) [如需要]
  ↓ 按 On-call 升级条件执行
  ↓ 召集相关人员
RESOLVE (解决)
  ↓ 确认问题已修复
  ↓ 验证系统恢复正常
  ↓ 通知利益相关者
POSTMORTEM (复盘) [P1+ 事件必须]
  ↓ 48小时内完成复盘
  ↓ 更新 FMB 和 Runbook
  ↓ 制定改进措施
```

### 4.6 O08 技术债务追踪板

#### 4.6.1 用户故事

```
As a developer maintaining this codebase,
I want a visible registry of all technical debt items with their severity and repayment plan,
So that technical debt doesn't silently accumulate and degrade system maintainability,
And we can make informed decisions about when to pay down debt vs. build new features.
```

#### 4.6.2 债务登记册结构

```yaml
# debt-register.yml 示例
version: "1.0"
last_updated: "2026-06-09"
summary:
  total_debt_count: 25
  total_estimated_effort: "120h"
  by_severity:
    critical: 2
    high: 5
    medium: 10
    low: 8
  by_category:
    code_smell: 8
    missing_test: 7
    outdated_dependency: 4
    architecture_drift: 3
    documentation_gap: 3

debts:
  - id: "DEBT-001"
    title: "API 路由缺少输入验证中间件"
    location: "api/routes/*.js"
    type: "code_smell"
    severity: "critical"
    introduced_session: "S045"
    interest_rate: "high"           # 每次变更此区域都需额外小心
    estimated_effort: "8h"
    estimated_interest: "2h/month"   # 不还债每月额外付出 2h
    status: "open"
    repayment_priority: 1
    planned_repayment_session: null  # 待安排
    notes: "多个路由直接信任用户输入, 存在安全风险"

  - id: "DEBT-002"
    title: "邮件模板硬编码在前端代码中"
    location: "frontend/src/components/EmailTemplate*.tsx"
    type: "architecture_drift"
    severity: "high"
    introduced_session: "S050"
    interest_rate: "medium"
    estimated_effort: "4h"
    estimated_interest: "1h/month"
    status: "open"
    repayment_priority: 3
    planned_repayment_session: null
    notes: "应从 API 动态加载, 当前每次修改模板都需要重新构建前端"

  - id: "DEBT-003"
    title: "单元测试覆盖率低于 40%"
    location: "api/**/*.test.js (缺失)"
    type: "missing_test"
    severity: "high"
    introduced_session: "S037"
    interest_rate: "very_high"        # 每次改动都要手动全量回归
    estimated_effort: "24h"
    estimated_interest: "4h/month"
    status: "in_progress"
    repayment_priority: 2
    planned_repayment_session: "S134"
    notes: "核心业务逻辑(api/services/)几乎无测试覆盖"

  # ... 更多债务条目
```

#### 4.6.3 利息计算模型

```javascript
// debt-scanner.js - 利息计算
function calculateDebtInterest(debt, monthsUnpaid) {
  const baseEffort = parseEffort(debt.estimated_effort); // hours
  const monthlyInterest = parseEffort(debt.estimated_interest); // hours/month
  
  // 线性利息模型
  const totalInterest = monthlyInterest * monthsUnpaid;
  
  // 复利效应: 随着时间推移, 债务可能引发新的债务
  const compoundFactor = 1 + (monthsUnpaid * 0.05); // 每月 5% 复利
  
  const totalCost = baseEffort + (totalInterest * compoundFactor);
  
  // ROI 分析: 还债的投入产出比
  const monthlySavings = monthlyInterest; // 还债后每月节省的时间
  const paybackMonths = baseEffort / monthlySavings;
  
  return {
    principal: baseEffort,
    interest: Math.round(totalInterest * compoundFactor),
    total_cost: Math.round(totalCost),
    payback_months: Math.ceil(paybackMonths),
    recommendation: paybackMonths <= 3 ? "REPAY_NOW" :
                   paybackMonths <= 6 ? "REPAY_SOON" :
                   "SCHEDULE_FOR_LATER"
  };
}
```

#### 4.6.4 债务偿还路线图

```
Phase O 技术债务偿还建议路线图:

S133 (O01/O02 执行期间):
  └─ DEBT-003: 单元测试覆盖率提升 (优先级最高, 利息最重)
     目标: 核心服务层 coverage 40% → 60%

S134 (O03/O04 执行期间):
  ├─ DEBT-001: API 输入验证中间件 (Critical, 安全相关)
  └─ DEBT-007: 过期的 npm 依赖更新 (Security)

S135 (O05/O06 执行期间):
  ├─ DEBT-002: 邮件模板动态加载 (Architecture improvement)
  └─ DEBT-005: Dockerfile 多阶段构建优化 (Build efficiency)

S136+ (持续):
  └─ 其余 Medium/Low 级别债务按优先级逐步偿还
     目标: 每个 Session 至少偿还 1 笔小债务
```

---

## 第五章：Phase O 实施路线图

### 5.1 任务依赖关系 DAG

```
Phase O 任务依赖关系图 (文字版 DAG):

                    ┌─────┐
                    │ O01 │ ◄══════════════════════════════╗
                    │AIOps │                               ║
                    └──┬──┘                               ║
                       │                                   ║
              ┌────────┼────────┐                          ║
              │        │        │                          ║
              ▼        ▼        ▼                          ║
         ┌─────┐  ┌─────┐  ┌─────┐                       ║
         │ O03 │  │ O04 │  │ O07 │ ══════════════════════╝
         │巡检  │  │容量  │  │协作  │
         └──┬──┘  └──┬──┘  └──┬──┘
            │         │         │
            ▼         ▼         ▼
         ┌─────┐  ┌─────┐  ┌─────┐
         │ O06 │  │ O05 │  │ O08 │
         │成本  │  │风险  │  │债务  │
         └─────┘  └──┬──┘  └─────┘
                      │
                      ▼
                   (独立闭环)

独立启动 (无前置依赖):
  ┌─────┐     ┌─────┐
  │ O02 │     │ O08 │
  │知识库│     │债务  │
  └─────┘     └─────┘

依赖说明:
  O01 → O03: AIOps 告警数据可作为巡检引擎的输入
  O01 → O04: AIOps 的指标增强提高容量预测精度
  O01 → O07: AIOps 事件检测能力支撑事件响应 SOP
  O02 → O03: Runbook 提供巡检的健康检查标准
  O02 → O07: Runbook 和 FMB 是事件响应的基础
  O03 → O06: 巡检的资源数据是成本优化的输入
  O04 → O06: 容量预测数据支撑成本分析
  O05 ↔ O08: 风险评分和债务追踪互补 (双向参考)
  O02 ↔ O08: 知识库中的代码质量问题可录入债务追踪
```

### 5.2 建议执行顺序

#### 5.2.1 Wave 1: 基础能力建设 (S133-S134, 推荐)

```
Wave 1 目标: 建立 Phase O 的两大基石 —— 智能告警和知识体系

S133 (预计 2 个 Session, 20h):
  ├─ O01-A: AIOps 告警关联引擎 (12h)
  │   ├── 告警关联算法实现 (时间聚类 + 拓扑 + 标签)
  │   ├── AlertManager 集成
  │   └── 基础测试
  │
  └─ O02-A: 知识库框架 + 核心 Runbook (8h)
      ├── 知识库目录结构和维护流程
      ├── 5 个核心组件 Runbook (API/PG/Redis/Nginx/Prometheus)
      └── FMB 框架 + 历史故障录入

S134 (预计 2 个 Session, 16h):
  ├─ O01-B: AIOps 自愈动作 + 仪表盘 (剩余 0h from O01, 合并到 S133)
  │
  ├─ O02-B: 知识库完善 (剩余 0h, 合并到 S133)
  │
  ├─ O03: 自动化巡检引擎 (8h)
  │   ├── 巡检框架 + 5 大维度检查
  │   ├── 报告生成 + 通知分发
  │   └── Grafana 巡检仪表盘
  │
  └─ O04: 容量规划自动化 (6h)
      ├── 预测引擎 (线性回归)
      ├── 容量仪表盘
      └── 预测型告警规则
```

#### 5.2.2 Wave 2: 效率提升 (S135-S136, 推荐)

```
Wave 2 目标: 在 Wave 1 基础上进一步提升运营效率和决策质量

S135 (预计 1-2 个 Session, 10-12h):
  ├─ O05: 变更风险评分系统 (6h)
  │   ├── 评分模型实现
  │   ├── Git Hook 集成
  │   └── CI Pipeline 集成
  │
  └─ O06: 成本优化仪表盘 (4h)
      ├── 15 面板 Grafana 仪表盘
      ├── 资源审计脚本
      └── 优化建议生成器

S136 (预计 1 个 Session, 7h):
  ├─ O07: 团队协作工作流 (4h)
  │   ├── On-call 手册
  │   ├── 事件响应 SOP
  │   ├── 复盘模板
  │   └── 交接 Checklist
  │
  └─ O08: 技术债务追踪板 (3h)
      ├── 债务登记册初始化
      ├── 扫描脚本
      └── 偿还路线图
```

#### 5.2.3 替代执行方案

```
最小可行方案 (Minimum Viable Phase O):
  如果时间有限, 可以只执行以下 3 个任务:
  1. O02 (知识库) — 8h — 纯文档, 价值最大/投入比
  2. O03 (巡检引擎) — 8h — 立即可用的自动化工具
  3. O08 (债务追踪) — 3h — 最轻量, 建立意识

  总计: 19h (~2-3 个 Session)
  覆盖: 知识管理 + 自动化 + 工程 discipline

深度方案 (Full Depth Phase O):
  如果资源和时间充足, 可以在每个任务上深入:
  - O01: 加入 ML 模型 (异常检测/趋势预测)
  - O02: 加入知识图谱和语义搜索
  - O03: 加入分布式巡检 (多节点)
  - O04: 加入更复杂的时序预测 (Prophet-like)
  - O05: 加入基于历史的 ML 风险评分
  - O06: 加入云成本对比 (如果上云)
  - O07: 加入 PagerDuty/Slack 集成
  - O08: 加入 SonarQube 集成的自动债务发现
```

### 5.3 风险评估矩阵

| 任务 | 技术风险 | 依赖风险 | 资源风险 | 综合评级 | 缓解措施 |
|------|---------|---------|---------|---------|---------|
| O01 AIOps | 🟡 中 (算法准确性) | 🟢 低 | 🟡 中 (12h 较大) | **Medium** | 先用规则引擎, 不上 ML; 分阶段交付 |
| O02 知识库 | 🟢 低 | 🟢 低 | 🟡 中 (质量要求高) | **Low-Medium** | 先搭框架再填充内容; 利用 AI 辅助编写 |
| O03 巡检引擎 | 🟢 低 | 🟡 中 (依赖 O02) | 🟢 低 | **Low** | 标准化脚本开发; 可脱离 O02 独立启动 |
| O04 容量规划 | 🟡 中 (预测准确度) | 🟡 中 (依赖 O01) | 🟢 低 | **Medium** | 用简单线性回归; 明确误差容忍度 |
| O05 风险评分 | 🟡 中 (模型校准) | 🟢 低 | 🟢 低 | **Low-Medium** | 加权评分法可解释; 基于历史数据迭代 |
| O06 成本优化 | 🟢 低 | 🟡 中 (依赖 O03/O04) | 🟢 低 | **Low** | 主要是仪表盘开发; 技术门槛不高 |
| O07 协作工作流 | 🟢 低 | 🟡 中 (依赖 O01/O02) | 🟢 低 | **Low** | 纯文档工作; 可参考 ITIL 最佳实践 |
| O08 债务追踪 | 🟢 低 | 🟢 低 | 🟢 低 | **Very Low** | 最轻量任务; 可快速交付 |

### 5.4 回滚策略

#### 5.4.1 每个任务的独立回滚方案

| 任务 | 回滚方案 | RTO | 复杂度 |
|------|---------|-----|--------|
| O01 | 删除新增的 JS 服务文件, 移除 AlertManager webhook 配置 | < 2 min | Low |
| O02 | 删除 `docs/knowledge-base/` 目录 | < 1 min | Very Low |
| O03 | 删除巡检脚本和 cron/Task Scheduler 配置 | < 2 min | Low |
| O04 | 删除容量规划脚本和 Grafana dashboard | < 1 min | Very Low |
| O05 | 移除 Git Hook 和 CI 配置变更 | < 2 min | Low |
| O06 | 移除 Grafana dashboard 和录制规则 | < 1 min | Very Low |
| O07 | 删除 `docs/workflows/` 目录 | < 1 min | Very Low |
| O08 | 删除 `docs/technical-debt/` 目录和扫描脚本 | < 1 min | Very Low |

#### 5.4.2 Phase O 整体回滚方案

```
Phase O 整体回滚方案:

Scenario A: 单个任务回滚 (推荐, 最小影响)
  git checkout HEAD~1 -- <affected-files>
  验证系统正常

Scenario B: Wave 1 回滚 (如果 Wave 1 引入问题)
  git revert <wave-1-commits>
  验证 13/13 容器健康
  系统回到 Post-N 状态 (功能不受影响)

Scenario C: Phase O 完全回滚 (极端情况)
  git revert <all-phase-o-commits>
  系统完全回到 S131 状态
  所有 Phase O 产出 (文档/脚本/仪表盘) 被移除
  核心业务功能 100% 不受影响

关键保证:
  ✓ Phase O 不修改任何核心业务代码
  ✓ Phase O 不修改 docker-compose.prod.yml 的服务定义
  ✓ Phase O 不修改数据库 Schema
  ✓ Phase O 不修改现有 API 端点的行为
  ✓ Phase O 的所有产出都是"附加层", 可安全剥离
```

---

## 附录

### A. Phase O 任务总览对照表

| ID | 名称 | 优先级 | 工作量 | 类别 | 代码量估计 | 文档量估计 | Wave |
|----|------|--------|-------|------|-----------|-----------|------|
| O01 | AIOps 智能告警降噪 | P0 | 12h | 智能运维 | ~800 行 JS | ~500 行 MD | 1 |
| O02 | 运营知识库构建 | P0 | 8h | 知识管理 | ~200 行 JS | ~3000 行 MD | 1 |
| O03 | 自动化巡检引擎 | P1 | 8h | 自动化 | ~600 行 JS | ~400 行 MD | 1 |
| O04 | 容量规划自动化 | P1 | 6h | 容量 | ~400 行 JS | ~300 行 MD | 1 |
| O05 | 变更风险评分系统 | P1 | 6h | 风险管控 | ~500 行 JS | ~400 行 MD | 2 |
| O06 | 成本优化仪表盘 | P2 | 4h | 成本 | ~200 行 Shell | ~300 行 MD+JSON | 2 |
| O07 | 团队协作工作流 | P2 | 4h | 协作 | 0 行 | ~1500 行 MD | 2 |
| O08 | 技术债务追踪板 | P2 | 3h | 工程 | ~250 行 JS | ~400 行 MD+YAML | 2 |
| **合计** | | | | **~2950 行** | **~6800 行** | |

### B. 术语表

| 术语 | 全称 | 定义 |
|------|------|------|
| AIOps | Artificial Intelligence for IT Operations | 人工智能 IT 运维 |
| FMB | Failure Mode Base | 故障模式库 |
| MTTR | Mean Time To Recovery | 平均恢复时间 |
| MTTD | Mean Time To Detection | 平均检测时间 |
| Runbook | Run Book | 运行手册/操作手册 |
| SOP | Standard Operating Procedure | 标准操作程序 |
| SLA | Service Level Agreement | 服务级别协议 |
| SLO | Service Level Objective | 服务级别目标 |
| TOIL | Toil | 苦役(重复性手工劳动) |
| SRE | Site Reliability Engineering | 站点可靠性工程 |
| PromQL | Prometheus Query Language | Prometheus 查询语言 |
| LogQL | Log Query Language | Loki 日志查询语言 |
| DAG | Directed Acyclic Graph | 有向无环图 |
| ROI | Return on Investment | 投资回报率 |

### C. 参考资源

- **Google SRE Books**: https://sre.google/books/
- **Prometheus Best Practices**: https://prometheus.io/docs/practices/
- **AlertManager Configuration**: https://prometheus.io/docs/alerting/latest/configuration/
- **Grafana Dashboard Best Practices**: https://grafana.com/docs/grafana/latest/best-practices/
- **ITIL Incident Management**: https://www.axelos.com/best-practice-solutions/itil/incident-management
- **PostgreSQL Monitoring**: https://wiki.postgresql.org/wiki/Monitoring
- **Node.js Production Checklist**: https://github.com/rajatsinghs/production-checklist

---

> **文档结束**
>
> 本文档是 GlobalReach V2.0 Phase O 运营优化阶段的权威规划文档。
> 由 S132 Session 产出，适用于 S133 及之后的 Phase O 执行阶段。
>
> **下一步**: 根据 Wave 1 计划，在 S133 启动 O01 (AIOps) 和 O02 (知识库) 的执行。
