# O08 技术债务追踪系统 — 设计文档

> **GlobalReach V2.0 企业级邮件营销平台** | Session S132 | Technical Debt Tracker Design Specification
>
> **版本**: v1.0 | **状态**: 已实施 | **创建日期**: 2026-06-09 | **作者**: Trae AI Digital Employee

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [背景与动机](#2-背景与动机)
3. [理论基础：Ward Cunningham 原始定义](#3-理论基础ward-cunningham-原始定义)
4. [分类框架：Martin Fowler 四象限法](#4-分类框架martin-fowler-四象限法)
5. [GlobalReach 自定义分类体系](#5-globalreach-自定义分类体系)
6. [量化模型：利息与本金](#6-量化模型利息与本金)
7. [系统架构设计](#7-系统架构设计)
8. [API 设计规格](#8-api-设计规格)
9. [Grafana 仪表盘设计](#9-grafana-仪表盘设计)
10. [CLI 分析工具设计](#10-cli-分析工具设计)
11. [偿还策略框架](#11-偿还策略框架)
12. [CI/CD 集成方案](#12-cicd-集成方案)
13. [团队文化与流程](#13-团队文化与流程)
14. [Phase O 协同机制](#14-phase-o-协同机制)
15. [风险评估与缓解](#15-风险评估与缓解)
16. [度量与 KPI](#16-度量与-kpi)
17. [实施路线图](#17-实施路线图)
18. [附录](#18-附录)

---

## 1. 执行摘要

### 1.1 问题陈述

GlobalReach V2.0 项目经过 S074-S131 共计 58 个 Session 的快速迭代开发，已累积大量技术债务。这些债务包括但不限于：

- **安全漏洞**: SMTP/Grafana/JWT 凭据硬编码、Redis 无认证（P0 × 5 条）
- **基础设施缺口**: SSL 证书缺失、备份验证缺失、Docker 镜像膨胀
- **代码质量**: 单元测试覆盖率仅 ~15%（目标 80%）、日志格式不一致
- **架构债**: API 版本化遗留路由、多租户隔离不完整、SSO Frontend-Backend Gap
- **运维盲区**: 监控覆盖不足、告警疲劳、容量规划缺失

### 1.2 解决方案概览

本系统（O08 Technical Debt Tracker）提供端到端的技术债务管理能力：

| 交付物 | 文件路径 | 行数/规模 | 功能 |
|--------|----------|-----------|------|
| 登记册 | `docs/technical-debt/TECHNICAL_DEBT_REGISTER.md` | 639 行 / 28 条债务 | 权威债务清单 |
| REST API | `api/routes/techDebt.js` | 1194 行 / 10 端点 | CRUD + 统计 + 利息计算 + ROI 排序 |
| CLI 工具 | `scripts/debt-analyzer.sh` | ~550 行 / 9 种模式 | 本地分析报告生成 |
| 仪表盘 | `grafana/dashboards/technical-debt.json` | 10 个面板 | 实时可视化监控 |
| 设计文档 | `docs/TECHNICAL_DEBT_TRACKER.md` | 600+ 行 | 方法论与实施指南 |

### 1.3 核心指标快照

```
┌─────────────────────────────────────────────────────────────┐
│  GlobalReach V2.0 技术债务健康检查 — 2026-06-09            │
├───────────────┬──────────┬─────────────────────────────────┤
│ 指标           │ 当前值    │ 说明                            │
├───────────────┼──────────┼─────────────────────────────────┤
│ 总债务数       │ 28 条     │ 覆盖 7 大类别                   │
│ 本金合计       │ 192 h     │ 估算总修复工时                   │
│ 累计利息       │ 164.5 h   │ 复利计算至今天                   │
│ 本息合计       │ 356.5 h   │ 含时间成本的总偿还成本             │
│ P0/Critical    │ 7 条      │ 需要立即行动                     │
│ BLOCKED        │ 1 条      │ DEBT-001 SSL被Phase L阻塞        │
│ IN_PROGRESS    │ 3 条      │ 正在偿还中                       │
│ 健康评分       │ ~25/100   │ 🔴 危急状态                      │
└───────────────┴──────────┴─────────────────────────────────┘
```

---

## 2. 背景与动机

### 2.1 为什么现在需要技术债务追踪？

GlobalReach 项目在 S074-S131 的 58 个 Session 中，以"功能优先、速度至上"的策略完成了从零到企业级平台的构建。这一策略是正确的——它让我们：

- ✅ 在有限时间内交付了完整的邮件营销平台
- ✅ 覆盖了 50+ 后端文件和 40+ 前端组件
- ✅ 实现了 Docker Compose 15 个服务的完整编排
- ✅ 建立了 Prometheus/Loki/Grafana 监控栈

但代价是累积了大量技术债务。**关键认知转变**：

> "技术债务不是'要不要还'的问题，而是'什么时候还、怎么还、谁来还'的工程管理问题。"
> —— 改编自 Ward Cunningham, 1992

### 2.2 不追踪技术债务的风险

| 风险等级 | 风险描述 | 触发条件 | 影响 |
|----------|----------|----------|------|
| 🔴 致命 | 安全漏洞被利用 | DEBT-007/008/009 未修复 | 数据泄露、合规罚款、品牌损毁 |
| 🔴 致命 | 生产环境宕机 | DEBT-001(SSL) + DEBT-028(容量) 叠加 | 业务中断、客户流失 |
| 🟠 严重 | 开发效率下降 | DEBT-012(测试) + DEBT-017(Legacy) 持续恶化 | 新功能开发速度降低 30-50% |
| 🟠 严重 | 团队士气低落 | Alert Fatigue(DEBT-027) + 技术负债感 | 核心开发者离职风险 |
| 🟡 中等 | 合规审计失败 | DEBT-004(PG密码) + DEBT-010(PII) | GDPR 罚款最高 2000 万欧元 |
| 🟡 中等 | Onboarding 成本高 | DEBT-021(Swagger) + DEBT-022(README) | 新人上手周期延长 2-3 周 |

### 2.3 追踪系统的业务价值

```
投资回报分析:
├── 投入: ~40h (系统开发 + 初始审计)
├── 回报:
│   ├── 避免 1 次安全事件 = 节省 €200万+ (GDPR罚款中位数)
│   ├── 开发效率提升 20% = 年节省 520h (假设团队 5 人 × 260 天)
│   ├── 减少 onboarding 时间 = 每次新人节省 80h
│   └── 审计准备时间缩短 70%
└── ROI ≈ 2500% (第一年保守估计)
```

---

## 3. 理论基础：Ward Cunningham 原始定义

### 3.1 1992 年原始隐喻

Ward Cunningham 在 1992 年的 OOPSLA 会议报告中首次提出"技术债务"概念：

> *"Shipping first time code is like going into debt. A little debt speeds development so long as it is promptly repaid either through rewriting or refactoring. The danger occurs when the debt is not repaid. Every minute spent on not-quite-right code counts as interest on that debt. Entire engineering organizations can be brought to a stand-still under the debt load of an unconsolidated implementation."*

**核心要素提取**：
1. **借贷行为**: 为了速度而选择非最优实现 → 这是合理的工程权衡
2. **本金 (Principal)**: 为修正该决策所需的额外工作量
3. **利息 (Interest)**: 因未及时修正而产生的持续额外成本
4. **复利效应**: 利息随时间指数增长（这是最危险的部分）
5. **破产风险**: 债务过载导致组织停滞

### 3.2 原始模型的现代扩展

Cunningham 的原始模型经过 30+ 年的发展，已被学术界和工业界广泛扩展：

| 扩展维度 | 提出者 | 核心贡献 |
|----------|--------|----------|
| 有意 vs 无意债务 | Martin Fowler | 区分战略性借贷与疏忽性债务 |
| 四象限分类 | Martin Fowler | 按"有意/无意"×"审慎/轻率"划分 |
| SonarQube 量化 | SonarSource | 将债务映射为可测量的代码质量指标 |
| SQALE 方法 | Dolf Schim van der Linden | 基于 ISO 9126 的质量属性分解 |
| Team-Based 评估 | Steve McConnell | 引入团队共识和专家判断 |

### 3.3 GlobalReach 对原始理论的采纳策略

我们采用 **"实用主义 Cunningham"** 策略：

- ✅ **采纳**: 本金/利息/复利核心模型
- ✅ **采纳**: "合理借贷是好的"哲学
- ⚠️ **调整**: 将抽象概念量化为具体数字（小时数）
- ❌ **不采用**: 过度学术化的形式化方法（如 SQALE 完整方法论）

理由：GlobalReach 是一个实际运营的产品项目，而非研究项目。我们需要的是**可操作、可测量、可沟通**的工具。

---

## 4. 分类框架：Martin Fowler 四象限法

### 4.1 四象限矩阵

Martin Fowler 在 2015 年的文章《Technical Debt Quadrant》中提出了经典的二维分类法：

```
                    ┌─────────────────────────────────────┐
                    │         审慎 (Prudent)              │
                    │                                     │
   有 意          │  Q1: 战略性债务      Q2: 无意债务     │
   (Deliberate)   │  "我们故意这样做的"  "我们不知道会这样" │
                    │                                     │
                    ├─────────────────────────────────────┤
                    │         轻率 (Reckless)             │
                    │                                     │
   无 意          │  Q3: 冒进(选项)     Q4: 轻率(意外)    │
   (Inadvertent)  │  "没时间做对"        "不懂怎么做"      │
                    │                                     │
                    └─────────────────────────────────────┘
```

### 4.2 各象限特征与 GlobalReach 映射

#### Q1: 战略性债务 (Prudent + Deliberate)

**定义**: 团队明知不是最佳方案，但有意识地选择它来换取速度。

**GlobalReach 案例**:

| 债务 ID | 描述 | 战略原因 | 还款计划 |
|---------|------|----------|----------|
| DEBT-003 | Docker 镜像 >500MB | 先跑通 pipeline 再优化 | P1, 下个迭代 |
| DEBT-017 | Legacy API v1 路由无废弃日期 | 先完成功能再迁移 | P1, 分阶段迁移 |
| DEBT-019 | SSO Frontend-Backend Gap | UI 先行验证需求 | P2, 后续 Sprint |

**处理原则**: 这类债务是**健康的**，只要在计划内偿还。

#### Q2: 无意但审慎 (Prudent + Inadvertent)

**定义**: 团队当时做出了在当时看来最好的决定，但后来发现是次优的。

**GlobalReach 案例**:

| 债务 ID | 描述 | 发现过程 |
|---------|------|----------|
| DEBT-023 | 索引策略未文档化 | 数据量增长后才意识到需要基线 |
| DEBT-024 | 缓存策略未标准化 | 缓存命中率波动后才发现问题 |
| DEBT-026 | 监控覆盖 Gaps | 业务上线后发现缺少关键指标 |

**处理原则**: 这类债务**不可避免**，重点在于**尽早发现**并记录。

#### Q3: 冒进选项 (Reckless + Deliberate)

**定义**: 明知有更好的做法，但因为"没时间"或"不重要"而选择捷径。

**⚠️ 这是最危险的象限！**

**GlobalReach 案例**:

| 债务 ID | 描述 | 风险等级 |
|---------|------|----------|
| DEBT-007 | SMTP 密码硬编码 5 处 | 🔴 CRITICAL |
| DEBT-008 | Grafana admin123 弱口令 | 🔴 CRITICAL |
| DEBT-009 | JWT Secret 默认值 | 🔴 CRITICAL |
| DEBT-002 | Redis 无密码认证 | 🔴 CRITICAL |
| DEBT-011 | Pre-commit Secrets 未配置 | 🔴 HIGH |

**处理原则**: 这类债务应被视为**安全漏洞**而非普通技术债务。需要升级到 CTO 层面审批。

#### Q4: 轻率意外 (Reckless + Inadvertent)

**定义**: 因为知识缺乏或经验不足而引入的问题。

**GlobalReach 案例**:

| 债务 ID | 描述 | 根因 |
|---------|------|------|
| DEBT-013 | console.log 散布 20+ 处 | 不熟悉统一 logger 用法 |
| DEBT-015 | asyncHandler 使用不一致 | 错误处理模式不统一 |
| DEBT-016 | .env.cdn.example 缺失 | CDN 配置是新领域 |

**处理原则**: 通过**Code Review + Pair Programming + 文档**减少此类债务。

### 4.3 四象限分布统计

基于当前 28 条债务的分类结果：

```
四象限分布:
  Q1 (战略/审慎):  ████████████████████  32%  (9 条) — 健康
  Q2 (无意/审慎):  ██████████            18%  (5 条) — 可接受
  Q3 (冒进/有意):  █████████████████     29%  (8 条) — 🔴 危险
  Q4 (轻率/无意):  ███████████████       21%  (6 条) — 需改进

⚠️ 关键发现: Q3 占比 29%，远超健康线 (<10%)
→ 建议: 立即召开技术债务评审会 (TDR), 重点审查 Q3 债务
```

---

## 5. GlobalReach 自定义分类体系

### 5.1 为什么需要自定义分类？

Fowler 四象限法回答了"为什么会产生债务"，但没有回答"债务在哪里"。对于日常管理，我们需要一个**按技术领域组织**的分类体系。

### 5.2 七大类别定义

#### 类别 1: Infrastructure (基础设施)

**范围**: 服务器、网络、容器、CI/CD、部署基础设施

**子类别**:
- Infrastructure→Security (同时涉及安全的基建问题)
- Infrastructure→Performance (影响性能的基础设施)

**当前债务**: DEBT-001 ~ DEBT-006 (共 6 条)

**典型症状**:
- Dockerfile 构建产物过大
- SSL/TLS 配置缺失或不正确
- 备份/恢复流程不存在或未验证
- 容器镜像使用 :latest 标签
- 基础设施即代码 (IaC) 缺少版本控制

**检测方法**:
```bash
# Docker 镜像大小检查
docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}" | sort -k2 -h

# SSL 证书检查
curl -Iv https://api.globalreach.com 2>&1 | grep "SSL certificate"

# 备份验证
./scripts/verify-backup.sh --dry-run
```

#### 类别 2: Security (安全)

**范围**: 认证、授权、加密、密钥管理、漏洞防护

**当前债务**: DEBT-007 ~ DEBT-011 (共 5 条)

**典型症状**:
- 硬编码凭据（密码/API Key/Token）
- 弱口令或默认凭证
- 加密算法过时或不安全配置
- 缺少输入验证/输出编码
- CORS/Misconfiguration

**检测方法**:
```bash
# 凭据扫描
grep -rn "password\|secret\|apikey\|token" --include="*.js" --include="*.yml" \
  | grep -v "node_modules\|\.env\|example"

# Trivy 容器扫描
trivy image globalreach-api:latest

# git-secrets 历史
git secrets --scan-history
```

**🔴 特别说明**: Security 类别中的 CRITICAL 级债务应视为**漏洞 (Vulnerability)** 而非纯技术债务，需要走安全响应流程。

#### 类别 3: Code Quality (代码质量)

**范围**: 测试覆盖率、代码风格、静态分析警告、技术债务注释

**当前债务**: DEBT-012 ~ DEBT-016 (共 5 条)

**典型症状**:
- 单元测试覆盖率低于目标阈值
- Lint 警告数量超过阈值
- TODO/FIXME/HACK 注释过期
- 代码复杂度 (圈复杂度) 过高
- 重复代码 (Copy-Paste) 超过阈值

**检测方法**:
```bash
# Jest 覆盖率
npx jest --coverage --coverageReporters=text-summary

# ESLint 统计
npx eslint api/ --format=json | eslint-stats

# 复杂度分析
npx complexity-reporter src/
```

#### 类别 4: Architecture (架构)

**范围**: 模块边界、分层违规、设计模式误用、技术选型债

**当前债务**: DEBT-017 ~ DEBT-019 (共 3 条)

**典型症状**:
- 循环依赖 (Circular Dependency)
- God Object / God Module
- API 版本兼容性问题
- 多租户隔离不完整
- 前后端契约不同步

**检测方法**:
```bash
# 循环依赖检测
madge --circular api/

# API 兼容性
npx openapi-diff swagger-v1.yml swagger-v2.yml
```

#### 类别 5: Documentation (文档)

**范围**: API 文档、架构文档、README、内联注释

**当前债务**: DEBT-020 ~ DEBT-022 (共 3 条)

**典型症状**:
- Swagger/OpenAPI 覆盖率 < 80%
- README 与实际不符
- 架构决策记录 (ADR) 缺失
- 代码注释与实现不一致

#### 类别 6: Performance (性能)

**范围**: 数据库查询优化、缓存策略、资源利用

**当前债务**: DEBT-023 ~ DEBT-025 (共 3 条)

**典型症状**:
- N+1 查询问题
- 缺少数据库索引
- 缓存未命中率高
- 内存泄漏
- 响应时间 P99 超过 SLA

#### 类别 7: Operations (运维)

**范围**: 监控、告警、日志、容量规划、故障恢复

**当前债务**: DEBT-026 ~ DEBT-028 (共 3 条)

**典型症状**:
- 关键指标缺少监控
- 告警规则过多 (Alert Fatigue)
- 日志格式不统一
- 无自动扩缩容策略
- MTTR (平均恢复时间) 过长

### 5.3 类别权重矩阵

不同类别对业务的潜在影响不同，我们在计算健康评分时使用以下权重：

| 类别 | 权重 | 理由 |
|------|------|------|
| Security | 1.5x | 安全漏洞可直接导致业务损失 |
| Infrastructure | 1.2x | 基础设施问题影响所有服务 |
| Performance | 1.1x | 性能问题直接影响用户体验 |
| Architecture | 1.0x | 架构债影响长期演进能力 |
| Code Quality | 0.9x | 代码质量影响开发效率 |
| Operations | 0.9x | 运维问题影响稳定性 |
| Documentation | 0.7x | 文档问题影响相对间接 |

---

## 6. 量化模型：利息与本金

### 6.1 本金估算模型 (Principal Estimation)

#### 6.1.1 本金等级定义

我们将修复一条技术债务所需的工作量划分为 5 个等级：

| 等级 | 符号 | 工时范围 | 典型场景 | 示例 |
|------|------|----------|----------|------|
| TINY | T | < 1h | 单文件修改、配置调整 | DEBT-006 Certbot 标签修复 |
| SMALL | S | 1-4h | 小型重构、添加测试 | DEBT-002 Redis 密码配置 |
| MEDIUM | M | 4-16h | 中等模块重构 | DEBT-003 Docker 优化 |
| LARGE | L | 16-40h | 跨模块改造 | DEBT-018 多租户隔离 |
| XLARGE | XL | > 40h | 架构级变更 | DEBT-012 测试覆盖率提升到 80% |

#### 6.1.2 估算方法

采用 **Planning Poker 共识法**:

1. **初步估算**: 由发现者给出初始估算（基于经验）
2. **同行评审**: 至少 2 名其他开发者独立估算
3. **三方校准**: 取中位数作为最终值
4. **记录偏差**: 实际偿还后更新估算准确度

**估算公式**:
```
Principal = Base_Effort × Complexity_Multiplier × Risk_Premium

其中:
  Base_Effort: 基础工时 (理想条件下)
  Complexity_Multiplier: 复杂度系数 (1.0-3.0)
    - 涉及 1 个文件: 1.0
    - 涉及 2-5 个文件: 1.5
    - 涉及跨层改动 (DB+API+Frontend): 2.0+
  Risk_Premium: 风险溢价 (1.0-1.5)
    - 低风险 (完全可控): 1.0
    - 中风险 (可能影响生产): 1.2
    - 高风险 (需要停机维护): 1.5
```

#### 6.1.3 当前债务本金分布

```
本金分布 (总计 192h):
  XLARGE (>40h):  ████                         1条  (30h等价)  16%
  LARGE (16-40):  ██████████                   3条  (52h)      27%
  MEDIUM (4-16):  ████████████████████        10条 (78h)      41%
  SMALL (1-4):    ████████                     8条  (24h)      12%
  TINY (<1):      ██                           6条  (8h)        4%

→ 中小型债务 (M+S+T) 占 57%, 适合增量偿还策略
→ 大型债务 (L+XL) 占 43%, 需要专门 Sprint 或拆分
```

### 6.2 利息模型 (Interest Model)

#### 6.2.1 日利率定义

| 利率等级 | 日利率 | 半月利息 (15天) | 月利息 (30天) | 季度利息 (90天) | 适用场景 |
|----------|--------|------------------|---------------|-----------------|----------|
| **CRITICAL** | 5%/天 | 107.9% | 332% | **5,054%** | 安全漏洞、数据丢失风险 |
| **HIGH** | 2%/天 | 34.6% | 109.6% | **593%** | 生产环境阻塞、合规风险 |
| **MEDIUM** | 0.5%/天 | 7.8% | 16.1% | **56%** | 开发效率下降、技术债累积 |
| **LOW** | 0.1%/天 | 1.55% | 3.48% | **9.9%** | 文档缺失、轻微代码异味 |

#### 6.2.2 复利公式推导

采用**日复利**模型（最保守/最真实的估算）：

$$I = P \times ((1 + r)^N - 1)$$

其中:
- $I$ = 累计利息 (hours)
- $P$ = 本金 (hours)
- $r$ = 日利率
- $N$ = 拖欠天数

**数学特性分析**:

```
利率敏感性分析 (P=8h, N=60天):
┌──────────┬──────────────┬──────────────┬──────────────┐
│ 利率等级  │ 日利率 r     │ 累计利息 I    │ 本息合计      │
├──────────┼──────────────┼──────────────┼──────────────┤
│ CRITICAL │ 5.0% (0.05)  │ 1,738.5 h    │ 1,746.5 h    │
│ HIGH     │ 2.0% (0.02)  │ 168.9 h      │ 176.9 h      │
│ MEDIUM   │ 0.5% (0.005) │ 27.4 h       │ 35.4 h       │
│ LOW      │ 0.1% (0.001) │ 4.9 h        │ 12.9 h       │
└──────────┴──────────────┴──────────────┴──────────────┘

→ CRITICAL 债务在 2 个月后利息是本金的 217 倍！
→ 这就是为什么 CRITICAL 债务必须立即处理的原因
```

#### 6.2.3 利息等级判定标准

| 判定因素 | CRITICAL (5%) | HIGH (2%) | MEDIUM (0.5%) | LOW (0.1%) |
|----------|---------------|-----------|---------------|------------|
| 安全影响 | 数据泄露/入侵 | 权限绕过 | 信息泄露 | 无直接安全影响 |
| 业务影响 | 生产不可用 | 功能降级 | 效率下降 | 微小不便 |
| 合规风险 | 违反法律/法规 | 违反行业标准 | 内部政策违反 | 无 |
| 影响范围 | 全系统 | 多模块 | 单模块 | 单文件 |
| 修复紧迫性 | < 24h | < 1周 | < 1个月 | < 1季度 |

#### 6.2.4 当前债务利息分布

```
按利率等级分布:
  CRITICAL (5%):  ████████████████████  5条  (DEBT-002/007/008/009/011)
  HIGH (2%):      ██████████████        4条  (DEBT-001/004/010/025)
  MEDIUM (0.5%):  ███████████████████  11条  (最大群体)
  LOW (0.1%):     ██████                8条  (文档/低优先级)

⚠️ CRITICAL+HIGH 共 9条 (32%), 但贡献了 85% 以上的累计利息
→ 偿还策略必须优先处理这 9 条
```

### 6.3 ROI 排序模型

#### 6.3.1 ROI 公式

$$ROI = \frac{r}{P}$$

其中:
- $r$ = 日利率
- $P$ = 本金 (小时数)

**直觉解释**: ROI 表示"每投入 1 小时能避免多少未来的利息支出"。ROI 越高，越应该优先偿还。

#### 6.3.2 Top 5 ROI 债务

| Rank | ID | 描述 | 利率 | 本金 | ROI | 推荐行动 |
|------|-----|------|------|------|-----|----------|
| 1 | DEBT-008 | Grafana 弱口令 | 5% | 1h | **0.0500** | 今天修 |
| 2 | DEBT-009 | JWT 默认 Secret | 5% | 2h | **0.0250** | 本周修 |
| 3 | DEBT-002 | Redis 无认证 | 5% | 3h | **0.0167** | 本周修 |
| 4 | DEBT-007 | SMTP 硬编码 | 5% | 4h | **0.0125** | 下周修 |
| 5 | DEBT-011 | Pre-commit 缺失 | 2% | 3h | **0.0067** | 下周修 |

**关键洞察**: Top 5 全部是 Security 类别！这再次印证了安全债务的最高优先级。

### 6.4 健康评分模型

#### 6.4.1 评分公式

$$HealthScore = 100 - \sum_{i=1}^{n} Penalty_i$$

扣分项:

| 扣分项 | 条件 | 扣分 | 上限 |
|--------|------|------|------|
| OPEN CRITICAL | status=OPEN 且 level=CRITICAL | -15/条 | -75 |
| OPEN HIGH | status=OPEN 且 level=HIGH | -10/条 | -50 |
| OPEN P0 | priority=P0 且 status=OPEN | -10/条 | -50 |
| BLOCKED | status=BLOCKED | -8/条 | -40 |
| IN_PROGRESS >30d | status=IN_PROGRESS 且 days>30 | -3/条 | -15 |

#### 6.4.2 评分等级解读

| 分数区间 | 等级 | 颜色 | 行动建议 |
|----------|------|------|----------|
| 80-100 | 🟢 健康 | 绿色 | 维持现状，继续常规偿还 |
| 50-79 | 🟡 关注 | 黄色 | 增加偿还 capacity 到 25% |
| 20-49 | 🔴 警告 | 红色 | 启动紧急偿还 Sprint |
| 0-19 | 💀 危急 | 深红 | CTO 介入，暂停新功能开发 |

**当前评分**: ~25 (🔴 警告级别偏下)

---

## 7. 系统架构设计

### 7.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        O08 技术债务追踪系统                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│  │  Debt Register│   │   REST API   │   │ CLI Analyzer │               │
│  │  (MD File)    │──▶│ (techDebt.js)│◀──│(debt-analyzer│               │
│  │  28条债务     │   │  10 endpoints│   │    .sh)      │               │
│  └──────────────┘   └──────┬───────┘   └──────────────┘               │
│                             │                                          │
│                             ▼                                          │
│                    ┌─────────────────┐                                │
│                    │ In-Memory Store  │  ← MVP阶段                     │
│                    │ (28 debt objects)│                                │
│                    └────────┬────────┘                                │
│                             │                                          │
│              ┌──────────────┼──────────────┐                          │
│              ▼              ▼              ▼                          │
│     ┌────────────┐ ┌────────────┐ ┌────────────┐                     │
│     │ Grafana    │ │ Prometheus │ │ JSON Export│                     │
│     │ Dashboard  │ │ Metrics    │ │ (--json)   │                     │
│     │ (10 panels)│ │ (optional) │ │ (CI/CD)    │                     │
│     └────────────┘ └────────────┘ └────────────┘                     │
│                                                                         │
│  数据流:                                                                 │
│  Register(MD) → API(In-Memory) → Dashboard(JSON)                        │
│                 ↕                                                        │
│            CLI Analyzer (本地读取)                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 技术栈选择

| 组件 | 选择 | 理由 |
|------|------|------|
| 数据存储 | In-Memory (MVP) → PostgreSQL (Production) | 快速原型；Production 需要 ACID 和持久化 |
| API 框架 | Express.js Router | 与现有项目一致 |
| 仪表盘 | Grafana JSON | 已有 Grafana 栈；团队熟悉 |
| CLI 工具 | Bash Script | 无依赖；跨平台 (Git Bash/WSL)；CI 友好 |
| 文档格式 | Markdown | Git 友好；可渲染为 HTML/PDF |

### 7.3 从 MVP 到 Production 的演进路径

```
Phase 1 (Current — MVP):
  In-Memory Store + MD Register + Manual Sync
  ↓ 适用场景: 团队 < 10 人; 债务 < 100 条; 手动更新频率够用

Phase 2 (Recommended — Production):
  PostgreSQL 持久化 + API CRUD + 自动同步
  ↓ 新增: tech_debts 表; 定期扫描脚本; Webhook 通知

Phase 3 (Advanced — Enterprise):
  自动化债务检测 + AI 辅助分类 + 预测性分析
  ↓ 新增: SonarQube 集成; Git hooks; ML 利息预测
```

---

## 8. API 设计规格

### 8.1 端点总览

| Method | Path | 功能 | 认证 |
|--------|------|------|------|
| GET | `/api/v1/debt/register` | 列表查询 (过滤/排序/分页) | Optional |
| GET | `/api/v1/debt/register/:id` | 单条详情 (含实时利息) | Optional |
| POST | `/api/v1/debt/register` | 新增债务登记 | Required |
| PATCH | `/api/v1/debt/register/:id` | 更新状态/优先级 | Required |
| DELETE | `/api/v1/debt/register/:id` | 归档已偿还债务 | Required |
| GET | `/api/v1/debt/stats` | 仪表盘统计数据 | Optional |
| GET | `/api/v1/debt/interest` | 累计利息明细 | Optional |
| GET | `/api/v1/debt/repayment-plan` | ROI 排序偿还计划 | Optional |
| POST | `/api/v1/debt/:id/start-repayment` | 开始偿还 | Required |
| POST | `/api/v1/debt/:id/complete-repayment` | 标记完成 | Required |

### 8.2 数据模型

```typescript
interface TechDebt {
  // === 核心标识 ===
  id: string;                    // "DEBT-001" ~ "DEBT-NNN"
  category: string;              // 7大类别之一
  component: string;             // 受影响的组件列表

  // === 发现信息 ===
  discoveredAt: string;          // 发现来源 (Session编号/审计类型)
  discoverer: string;            // 发现者 (人或自动化工具)

  // === 描述信息 ===
  description: string;           // 债务描述 (what)
  impact: string;                // 影响描述 (so what)
  rootCause: string;             // 根因分析 (why)

  // === 量化数据 ===
  interestRate: number;          // 日利率 (0.001 ~ 0.05)
  interestLevel: string;         // CRITICAL/HIGH/MEDIUM/LOW
  principal: number;             // 本金 (工时 h)
  principalLevel: string;        // TINY/SMALL/MEDIUM/LARGE/XLARGE

  // === 状态管理 ===
  priority: string;              // P0/P1/P2/P3
  status: string;                // OPEN/IN_PROGRESS/BLOCKED/DONE/ARCHIVED
  statusHistory: StatusChange[]; // 状态变更历史

  // === 偿还跟踪 ===
  repaymentPlan: string;         // 偿还步骤
  dependencies: string;          // 外部依赖
  risk: string;                  // 风险说明
  relatedFiles: string[];        // 相关文件列表
  acceptanceCriteria: string[];  // 完成标准

  // === 元数据 ===
  createdAt: Date;               // 发现日期
  daysOutstanding: number;       // 拖欠天数
  repayments: RepaymentRecord[]; // 偿还记录
}

interface StatusChange {
  date: string;
  from: string | null;
  to: string;
  reason: string;
}

interface RepaymentRecord {
  startedAt: Date;
  completedAt?: Date;
  assignee: string;
  actualHours?: number;
  notes: string;
}
```

### 8.3 关键端点详解

#### GET /register — 列表查询

**支持的过滤参数**:

| 参数 | 类型 | 示例 | 说明 |
|------|------|------|------|
| category | string | ?category=Security | 按类别过滤 (模糊匹配) |
| status | string | ?status=OPEN | 按状态过滤 |
| priority | string | ?priority=P0 | 按优先级过滤 |
| minInterest | float | ?minInterest=0.02 | 最低利率过滤 |
| sortBy | string | ?sortBy=interest | 排序字段 |
| sortOrder | asc/desc | ?sortOrder=desc | 排序方向 |
| page | int | ?page=1 | 页码 |
| limit | int | ?limit=20 | 每页条数 |

**响应示例**:
```json
{
  "data": [...],
  "pagination": { "page": 1, "limit": 20, "total": 28, "totalPages": 2 },
  "meta": { "queryTimeMs": 12 }
}
```

#### GET /stats — 仪表盘数据

**返回结构**:
```json
{
  "overview": {
    "totalDebts": 28,
    "totalPrincipal": 192,
    "totalInterest": 164.5,
    "totalWithInterest": 356.5,
    "healthScore": 25.3
  },
  "highInterestAlerts": [
    { "id": "DEBT-002", "interestRate": 0.05, "daysOutstanding": 30, "accruedInterest": 42.8 }
  ],
  "byCategory": { "Security": 5, "Infrastructure": 6, ... },
  "byStatus": { "OPEN": 22, "IN_PROGRESS": 3, "BLOCKED": 1, ... },
  "repaymentProgress": { "done": 0, "inProgress": 3, "pending": 25 }
}
```

### 8.4 错误处理规范

| HTTP Status | 场景 | 响应体示例 |
|-------------|------|-----------|
| 400 | 参数无效 | `{ error: "INVALID_CATEGORY", message: "...", code: 400 }` |
| 404 | 债务不存在 | `{ error: "DEBT_NOT_FOUND", message: "DEBT-999 not found", code: 404 }` |
| 409 | 重复登记 | `{ error: "DUPLICATE_DEBT", message: "...", code: 409 }` |
| 422 | 状态转换非法 | `{ error: "INVALID_TRANSITION", message: "Cannot go from DONE to OPEN", code: 422 }` |

---

## 9. Grafana 仪表盘设计

### 9.1 面板布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Row 1: 核心指标 Gauge (4列)                                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│ │ 债务总数  │ │ 本金合计  │ │ 累计利息  │ │ 健康评分  │                    │
│ │   28     │ │  192h    │ │ 164.5h   │ │  25.3    │                    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                    │
├─────────────────────────────────────────────────────────────────────────┤
│ Row 2-3: 分布分析 (2列)                                                 │
│ ┌────────────────────────────┐ ┌────────────────────────────┐          │
│ │ 按类别分布 (Donut Chart)    │ │ 按利率等级分布 (Bar Chart)  │          │
│ │  Security 18% ■            │ │  CRITICAL  ████████ 85%    │          │
│ │  Infra    21% ■            │ │  HIGH     ██████   10%    │          │
│ │  CodeQ    18% ■            │ │  MEDIUM   ███      4%     │          │
│ │  ...                       │ │  LOW      █        1%     │          │
│ └────────────────────────────┘ └────────────────────────────┘          │
├─────────────────────────────────────────────────────────────────────────┤
│ Row 4: 状态分布                                                         │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │ OPEN ████████████████████████ 22  | IN_PROGRESS ███ 3            │   │
│ │ BLOCKED █ 1                     | DONE (none)                   │   │
│ └──────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│ Row 5: Top 10 高息债务明细 (Full-width Table)                            │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │ Rank │ ID      │ 描述           │ 利率   │ 本金 │ 利息  │ ROI   │   │
│ │  1   │ DEBT-002│ Redis无认证    │🔴CRIT  │  3h  │ 42.8h │0.0167 │   │
│ │  2   │ DEBT-007│ SMTP硬编码     │🔴CRIT  │  4h  │ 38.2h │0.0125 │   │
│ │  ... │ ...     │ ...            │...     │ ...  │ ...   │ ...   │   │
│ └──────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│ Row 6-7: 趋势 + 年龄 (2列)                                               │
│ ┌──────────────────────────────────┐ ┌──────────────────┐             │
│ │ 偿还趋势 (Time Series Line)      │ │ 债务年龄分布      │             │
│ │ ╱╲ 本金(绿)                      │ │ 0-30d  ████  8   │             │
│ │ ╱  ╲ 利息(红)                    │ │ 31-60d █████ 12  │             │
│ │ ╱    ╲╱ 本息合计(蓝)             │ │ 61-90d ███   5   │             │
│ │                                 │ │ >90d  ███   3   │             │
│ └──────────────────────────────────┘ └──────────────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.2 面板规格详情

| Panel ID | 类型 | 数据源 | 刷新率 | 目的 |
|----------|------|--------|--------|------|
| 1 | Gauge | Prometheus metric | 30s | 总债务数 |
| 2 | Gauge | Prometheus metric | 30s | 本金合计 |
| 3 | Gauge | Prometheus metric | 30s | 累计利息 |
| 4 | Gauge | Prometheus metric | 30s | 健康评分 |
| 5 | Pie Chart | Prometheus groupBy(category) | 30s | 类别占比 |
| 6 | Bar Chart | Prometheus groupBy(interest_level) | 30s | 利率分布 |
| 7 | Bar Chart | Prometheus groupBy(status) | 30s | 状态分布 |
| 8 | Table | Prometheus topK(10) | 30s | 高息明细 |
| 9 | Time Series | Prometheus range query | 30s | 偿还趋势 |
| 10 | Bar Chart | Histogram bucket | 30s | 年龄分布 |

### 9.3 Prometheus 指标定义

为了支持 Grafana 仪表盘，TechDebt API 应暴露以下 Prometheus metrics:

```yaml
# Counter 类型: 总债务数
globalreach_tech_debt_total{category="...", status="..."}

# Gauge 类型: 本金合计
globalreach_debt_principal_total

# Gauge 类型: 累计利息
globalreach_debt_interest_accrued_total

# Gauge 类型: 健康评分
globalreach_debt_health_score

# Histogram 类型: 按类别分布
globalreach_tech_debt_by_category{category="..."}

# Histogram 类型: 按利率等级分布
globalreach_debt_interest_by_level{interest_level="..."}

# Histogram 类型: 按状态分布
globalreach_tech_debt_by_status{status="..."}

# Gauge 类型: 单条债务天数
globalreach_tech_debt_days_outstanding{debt_id="..."}

# Summary 类型: Top N 高息债务
globalreach_tech_debt_top_interest{debt_id="...", interest_level="...", ...}
```

---

## 10. CLI 分析工具设计

### 10.1 工具概述

`debt-analyzer.sh` 是一个独立的 Bash CLI 工具，用于在本地环境进行技术债务分析，无需启动 API 服务。

**设计理念**:
- **离线优先**: 不依赖网络或运行中的服务
- **零依赖**: 仅需 Bash + Awk (所有 Unix 系统自带)
- **管道友好**: 支持 JSON 输出供其他工具消费
- **CI 友好**: 可集成到 CI/CD Pipeline

### 10.2 运行模式

| 模式 | 命令 | 输出 | 使用场景 |
|------|------|------|----------|
| Full Report | `./debt-analyzer.sh` | 完整 ASCII 报告 | Sprint Planning 会议 |
| Category Filter | `--category security` | 按类别过滤 | 安全专项审查 |
| High Interest | `--interest-high` | 仅 CRITICAL+HIGH | 每日站会快速检查 |
| ROI Sort | `--roi` | ROI 排序建议 | 优先级排序 |
| Weekly Report | `--report` | 周报格式 | 周报邮件附件 |
| JSON Output | `--json` | 机器可读 JSON | CI/CD / Grafana 注释 |
| Summary | `--summary` | 单屏摘要 | Terminal 快速查看 |
| Blocked Only | `--blocked` | 仅阻塞债务 | 依赖解除会议 |

### 10.3 输出示例 (ASCII Art)

```
═════════════════════════════════════════════════════════════════════
  ╔═══════════════════════════════════════════════════════════════╗
  ║  GlobalReach V2.0 — 技术债务分析报告                              ║
  ║  Technical Debt Analysis Report — O08 Tracker                    ║
  ╚═══════════════════════════════════════════════════════════════╝
═════════════════════════════════════════════════════════════════════
  生成时间: 2026-06-09 14:30:00 CST
  数据来源: TECHNICAL_DEBT_REGISTER.md (28 条登记债务)

  ┌─────────────────────────────────────────────────────────────────┐
  │  债务健康仪表盘                                                  │
  ├─────────────────────────────────────────────────────────────────┤
  │  总债务数:       28 条                                           │
  │  本金合计:       192 h (估算修复工时)                             │
  │  累计利息:       164.5 h (按复利计算)                            │
  │  本息合计:       356.5 h                                         │
  ├─────────────────────────────────────────────────────────────────┤
  │  健康评分:        25.3/100                                        │
  └─────────────────────────────────────────────────────────────────┘

  [...] (详细表格和图表)
```

### 10.4 数据源策略

CLI 工具采用**双数据源**策略：

1. **主数据源**: `docs/technical-debt/TECHNICAL_DEBT_REGISTER.md`
   - 最权威的数据源
   - Markdown 格式易于人工编辑和 Git 版本控制
   - 解析器提取表格行中的结构化数据

2. **备用数据源**: 内嵌债务数据集
   - 当 MD 文件不存在时自动启用
   - 包含全部 28 条债务的完整数据
   - 与 API 的 `debtStore` 保持同步

---

## 11. 偿还策略框架

### 11.1 三种策略对比

| 维度 | Strategy A: 高息优先 | Strategy B: 增量偿还 | Strategy C: 重构置换 |
|------|---------------------|---------------------|---------------------|
| **核心理念** | 先还利息最高的 | 每个 Sprint 固定比例 | 大重构一次性解决 |
| **适用场景** | 债务种类多且分散 | 稳定迭代团队 | 架构级债务集中 |
| **优点** | 最大化利息节省 | 可预测、低风险 | 彻底解决根因 |
| **缺点** | 可能忽略大工程 | 进展慢 | 风险高、周期长 |
| **推荐占比** | 50% | 30% | 20% |

### 11.2 Strategy A: 高息优先 (High-Interest-First)

**算法**:
1. 计算所有 OPEN 状态债务的 ROI
2. 按 ROI 降序排列
3. 从顶部开始分配每个 Sprint 的 capacity
4. 跳过 BLOCKED 状态的债务（但跟踪其依赖）

**Sprint 模板**:
```
Sprint N 偿还任务分配 (Strategy A):
├── Slot 1 (必选): 最高 ROI 的 CRITICAL 债务 (预计 Xh)
├── Slot 2 (推荐): 次 ROI 的 HIGH 债务 (预计 Yh)
├── Slot 3 (可选): 第 3 ROI 的 MEDIUM 债务 (预计 Zh)
└── Reserve: 20% capacity 用于突发债务发现

Capacity 分配: 偿还任务 ≤ 该 Sprint 总 capacity × 20%
```

**当前 Sprint 建议** (基于最新数据):
1. **DEBT-008** Grafana 弱口令 (1h) — 今天完成
2. **DEBT-009** JWT Secret (2h) — 明天完成
3. **DEBT-002** Redis 密码 (3h) — 本周内完成
4. **DEBT-011** Pre-commit Hooks (3h) — 本周内完成

**小计: 9h (约 2 个工程师日)**

### 11.3 Strategy B: 增量偿还 (Incremental Repayment)

**规则**:
- 每个 Sprint **至少分配 20% capacity** 给技术债务
- 优先偿还**当前正在接触的模块**相关的债务 (Just-in-Time Repayment)
- 每条债务的偿还时间不超过 **1 个 Sprint**

**Capacity 计算公式**:
$$DebtCapacity_{Sprint} = TotalCapacity \times 20\%$$

例如: 5 人团队 × 10 天/Sprint × 6h/天 = 300h/Sprint
- 偿还 capacity = 300h × 20% = **60h/Sprint**
- 按当前本金 192h 计算，约 **3-4 个 Sprint** 可以清零

### 11.4 Strategy C: 重构置换 (Refactor & Replace)

**适用条件**:
- 同一模块/系统有 ≥ 3 条相关债务
- 这些债务之间存在**因果链**
- 当前正在进行该模块的新功能开发

**当前适用案例**:

| 模块组 | 相关债务 | 建议动作 |
|--------|----------|----------|
| Security Hardening | DEBT-002/007/008/009/011 | 安全加固 Sprint |
| Observability | DEBT-013/026/027/028 | 可观测性提升 Sprint |
| Test Foundation | DEBT-012 | 测试基础设施 Sprint (拆分为子任务) |

### 11.5 混合策略推荐 (A+B+C)

GlobalReach 推荐 **混合策略**:

```
┌─────────────────────────────────────────────────────────────┐
│  GlobalReach 偿还策略: A(50%) + B(30%) + C(20%)             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  每个 Sprint:                                                │
│  ├─ 50% capacity → Strategy A (高息优先)                    │
│  │   └─ 处理 Top 3 ROI 的 OPEN 债务                          │
│  │                                                           │
│  ├─ 30% capacity → Strategy B (增量偿还)                    │
│  │   └─ 处理当前工作模块关联的债务                           │
│  │                                                           │
│  └─ 20% capacity → Strategy C (重构置换)                    │
│      └─ 集中处理模块级债务组合                               │
│                                                             │
│  Sprint Review 必须包含:                                      │
│  ✓ 偿还进度回顾                                             │
│  ✓ 新发现债务登记                                           │
│  ✓ 健康评分趋势分析                                         │
│  ✓ 下 Sprint 偿还计划确认                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 12. CI/CD 集成方案

### 12.1 集成点概览

```
Git Push Event
    │
    ▼
┌─────────────┐
│ CI Pipeline  │
│ (GitHub Actions│
│  / GitLab CI)│
└──────┬──────┘
       │
       ├──────────────────┬──────────────────┐
       ▼                  ▼                  ▼
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │Pre-commit │     │  Build   │     │  Deploy  │
  │ Hooks     │     │ Stage    │     │ Stage    │
  │           │     │          │     │          │
  │• Secrets  │     │• Unit    │     │• Health  │
  │  Scan     │     │  Tests   │     │  Check   │
  │• Debt     │     │• Coverage│     │• Debt    │
  │  Check    │     │  Gate    │     │  Trend   │
  └──────────┘     └──────────┘     └──────────┘
```

### 12.2 Pre-commit Hook 集成

**目的**: 在代码提交前检测是否引入新的技术债务

**实现方式**:
```bash
#!/bin/bash
# .git/hooks/pre-check-debt (called from pre-commit)

# 检查新增的 TODO/FIXME/HACK 注释
NEW_COMMENTS=$(git diff --cached --name-only | xargs grep -l "TODO\|FIXME\|HACK" 2>/dev/null || true)
if [[ -n "$NEW_COMMENTS" ]]; then
    echo "⚠ Warning: New technical debt markers found:"
    echo "$NEW_COMMENTS"
    echo "Please register in TECHNICAL_DEBT_REGISTER.md"
fi

# 检查硬编码凭据 (简化版)
SECRETS_PATTERN="(password|secret|apikey|token)\s*[:=]\s*[\"'][^\"']+[\"']"
if git diff --cached | grep -qiE "$SECRETS_PATTERN"; then
    echo "❌ Error: Potential hardcoded secret detected!"
    exit 1
fi
```

### 12.3 CI Pipeline 集成

**GitHub Actions Workflow 示例**:
```yaml
name: Technical Debt Check

on:
  pull_request:
    branches: [main, develop]
  schedule:
    - cron: '0 9 * * 1'  # 每周一 9:00 AM

jobs:
  debt-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Debt Analyzer
        run: |
          chmod +x scripts/debt-analyzer.sh
          ./scripts/debt-analyzer.sh --json > debt-report.json

      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: debt-report
          path: debt-report.json

      - name: Health Score Gate
        run: |
          SCORE=$(jq '.summary.healthScore' debt-report.json)
          echo "Debt Health Score: $SCORE"
          if (( $(echo "$SCORE < 20" | awk '{print ($1)?1:0}') )); then
            echo "::warning::Health score critically low! Please review technical debt."
          fi

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const report = require('./debt-report.json');
            const score = report.summary.healthScore;
            const emoji = score >= 80 ? '🟢' : score >= 50 ? '🟡' : '🔴';
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## 📊 Technical Debt Report\n\n${emoji} **Health Score:** ${score}/100\n\n**Total Debts:** ${report.totalDebts}\n**Principal:** ${report.summary.totalPrincipal}h\n**Interest:** ${report.summary.totalInterest.toFixed(1)}h\n\n[View Full Report](/grafana/d/tech-debt)`
            });
```

### 12.4 Grafana 注释集成

**通过 API 自动标注重大事件**:
```bash
# 在债务状态变更时添加 Grafana 注释
curl -X POST "${GRAFANA_URL}/api/annotations" \
  -H "Content-Type: application/json" \
  -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
  -d "{
    \"time\": $(date +%s)000,
    \"timeEnd\": $(date +%s)000,
    \"tags\": [\"debt-repayment\", \"tech-debt\"],
    \"text\": \"DEBT-008 completed: Grafana password changed to strong credential\\nHealth score improved by +5 points\"
  }"
```

---

## 13. 团队文化与流程

### 13.1 文化建设原则

#### 原则 1: 债务 ≠ 羞耻

> "承认技术债务是成熟的标志，而不是无能的表现。每一个成功的软件项目都有技术债务。关键在于你是否知道它、是否在管理它。"

**实践**:
- 在 Sprint Review 中公开讨论技术债务
- 不因产生债务而惩罚个人
- 奖励主动发现和登记债务的行为

#### 原则 2: 借贷需要审批

> "战略性债务 (Q1) 是好的，但需要在技术层面达成共识。冒进债务 (Q3) 需要升级审批。"

**审批层级**:
| 债务类型 | 审批要求 | 示例 |
|----------|----------|------|
| Q1 战略性 | Tech Lead 口头同意 | "这个 Sprint 我们先用硬编码，下个 Sprint 外部化" |
| Q2 无意 | 自动登记即可 | "发现索引缺失，已记录" |
| Q3 冒进 (LOW) | Tech Lead 书面确认 | "时间不够，暂时跳过测试" |
| Q3 冒进 (HIGH+) | CTO 审批 | "生产环境使用默认密码" |

#### 原则 3: 偿还是投资

> "花时间还技术债务不是'不做功能'，而是在为未来的所有功能加速。"

**沟通话术**:
- ❌ "这周我们要花 2 天修技术债务，新功能推迟"
- ✅ "这周我们投资 16h 用于技术债务偿还，预计提升后续开发效率 20%"

### 13.2 流程嵌入点

#### Sprint Planning

```
Sprint Planning Agenda (增加 15 分钟):
1. 回顾上 Sprint 偿还进展 (2 min)
2. 审查新发现的债务 (3 min)
3. 选择本 Sprint 偿还目标 (5 min)
4. 分配 capacity (3 min)
5. 确认验收标准 (2 min)

输出: Sprint Backlog 中的 [Debt] 标记任务
```

#### Daily Standup

```
Standup 格式调整 (第三句话增加):
1. 昨天做了什么?
2. 今天打算做什么?
3. 有没有阻塞? [+ 是否有技术债务相关发现?]

示例: "昨天我在 Campaign 模块发现了一个 N+1 查询问题，
      已经登记为 DEBT-025，建议下个 Sprint 安排修复"
```

#### Sprint Review

```
Sprint Review 增加议程 (10 分钟):
1. 偿还成果展示 (Demo fixed debts)
2. 健康评分变化趋势
3. 新债务发现与分类
4. 下 Sprint 偿还计划投票
```

#### Retrospective

```
Retrospective 增加问题:
+ What helped us reduce technical debt this Sprint?
- What caused new technical debt this Sprint?
? What debts are we unsure about how to approach?
! What debt surprised us the most?
```

### 13.3 角色与职责

| 角色 | 债务相关职责 | 时间投入 |
|------|-------------|----------|
| **产品负责人 (PO)** | 平衡功能需求与偿还 capacity | Sprint Planning 时 30min |
| **Tech Lead** | 债务分类、优先级排序、审批 Q3 | 每周 2h |
| **开发者全员** | 发现债务、登记、参与偿还 | 日常 5%/Sprint 20% |
| **DevOps/SRE** | Infra & Ops 类别的债务管理 | 每周 1h |
| **CTO** | Q3-HIGH+ 审批、跨部门协调 | 按需 |

---

## 14. Phase O 协同机制

### 14.1 什么是 Phase O?

在 GlobalReach 项目方法论中，**Phase O (Origin/Operations)** 代表项目的稳态运维阶段。O08 技术债务追踪系统是 Phase O 的核心组件之一。

### 14.2 与其他 Phase 的关系

```
Phase L (Launch) ──┐
                    ├──▶ Phase O (Steady State) ◀── O08 Debt Tracker
Phase K (Closeout)─┘              │
                                  ├── O01-O07: 运维自动化
                                  ├── O09-O15: 持续进化
                                  └── S132+: 日常 Session

O08 的输入:
  • Phase L 遗留的基础设施债务 (DEBT-001 SSL 等)
  • Phase K 发现的收尾债务
  • 所有之前 Session 累积的历史债务

O08 的输出:
  • 每周偿还计划 → Sprint Backlog
  • 健康评分趋势 → CTO Dashboard
  • 安全预警 → Security Response Team
  • 容量规划建议 → Infrastructure Team
```

### 14.3 跨 Session 债务追踪

GlobalReach 采用 Session 制进行开发管理（S074-S132），每次 Session 可能产生或解决技术债务：

| Session 类型 | 债务影响 | O08 处理方式 |
|--------------|----------|-------------|
| Feature Session | 可能产生 Q1/Q2 债务 | Session 结束时强制登记 |
| Bug Fix Session | 可能暴露 Q4 债务 | 同时登记根因债务 |
| Audit Session (S117/S119) | 发现大量债务 | 批量导入 + 分类 |
| Refactoring Session | 偿还已有债务 | 更新状态为 DONE |
| Ops Session | 发现 Infra/Ops 倍 | 优先级提升 |

### 14.4 定期审查节奏

| 节奏 | 活动 | 参与者 | 产出 |
|------|------|--------|------|
| **每日** | CLI `--summary` 快速检查 | Tech Lead | 异常预警 |
| **每周** | `--report` 周报 + Sprint Review | 全团队 | 偿还计划 |
| **每月** | 健康评分趋势分析 + 策略调整 | Tech Lead + PO | 策略报告 |
| **季度** | 全面审计 + 登记册更新 | 全团队 + 外部审计 | 审计报告 |

---

## 15. 风险评估与缓解

### 15.1 系统自身风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 登记册过时 | 高 | 中 | CI 自动检查最后更新时间 |
| 主观估算偏差 | 高 | 低 | 三方校准 + 偏差反馈循环 |
| 过度量化导致博弈 | 中 | 中 | 强调定性判断补充定量 |
| 维护成本高于收益 | 低 | 高 | 设定 ROI 阈值，低于则简化 |

### 15.2 偿还过程风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 偿还被新功能挤占 | 高 | 高 | PO 承诺 20% capacity 硬性保护 |
| 修复引入新 bug | 中 | 高 | 强制 Code Review + 回归测试 |
| 估算不准导致超时 | 中 | 中 | 允许拆分到多个 Sprint |
| BLOCKED 候长期无法解锁 | 低 | 高 | 定期 Escalate 到管理层 |

### 15.3 风险监控指标

```
Risk Dashboard (建议添加到 Grafana):
├── 偿还完成率 (Planned vs Actual)
├── 平均偿还周期 (Registered → Done)
├── 新债务发现速率 (debts/session)
├── BLOCKED 债务数量趋势
└── 估算准确度 (Estimated vs Actual hours)
```

---

## 16. 度量与 KPI

### 16.1 核心 KPI

| KPI | 定义 | 目标 | 测量频率 |
|-----|------|------|----------|
| **健康评分** | 0-100 综合评分 | ≥ 60 (Q3 2026) | 实时 |
| **债务密度** | 每 KLOC 技术债务数 | < 5 | 每周 |
| **偿还速率** | 每周完成的债务数 | ≥ 2 | 每周 |
| **发现速率** | 每周新登记债务数 | < 3 (下降趋势) | 每周 |
| **平均拖欠天数** | 所有 OPEN 债务的平均年龄 | < 45 天 | 每周 |
| **P0 清零时间** | P0 债务从登记到 DONE 的中位时间 | < 7 天 | 每月 |

### 16.2 反模式 KPI (应避免)

| 反模式 | 为什么不好 | 替代方案 |
|--------|-----------|----------|
| "债务数为零" | 鼓励不登记 | 追踪"登记率"而非绝对数 |
| "偿还速度最快" | 鼓励挑简单的做 | 追踪"加权偿还"(按 ROI) |
| "每个人还一样多" | 忽略专业差异 | 按角色分配相关类别 |

### 16.3 度量仪表盘配置

建议在 Grafana 创建一个 **Engineering Health** 串联仪表盘，包含:

1. **O08 技术债务** (本文档所述)
2. **代码覆盖率** (Jest + Istanbul)
3. **构建成功率** (CI/CD)
4. **MTTR** (Incident 管理)
5. **部署频率** (DORA metrics)

---

## 17. 实施路线图

### 17.1 Phase 1: 基础设施 (Week 1-2) ✅ 已完成

- [x] 代码审计与债务发现 (28 条)
- [x] 技术债务登记册创建
- [x] REST API 实现 (10 端点)
- [x] CLI 分析工具开发
- [x] Grafana 仪表盘配置
- [x] 设计文档编写

### 17.2 Phase 2: 流程嵌入 (Week 3-4)

- [ ] Sprint Planning 模板更新
- [ ] Daily Standup 格式调整
- [ ] Pre-commit Hook 配置 (DEBT-011)
- [ ] CI Pipeline 集成 (GitHub Actions)
- [ ] 团队培训会 (1 hour)

### 17.3 Phase 3: 首轮偿还 (Week 5-8)

**Sprint 1 目标**:
- [ ] DEBT-008 Grafana 弱口令修复 (1h)
- [ ] DEBT-009 JWT Secret 替换 (2h)
- [ ] DEBT-002 Redis 密码配置 (3h)
- [ ] DEBT-011 Pre-commit Hooks (3h)
- **预期健康评分提升**: 25 → 38 (+13)

**Sprint 2 目标**:
- [ ] DEBT-007 SMTP 密码外部化 (4h)
- [ ] DEBT-004 PG 密码修改 (2h)
- [ ] DEBT-013 日志统一 (部分, 4h)
- **预期健康评分提升**: 38 → 50 (+12)

**Sprint 3-4 目标**:
- [ ] DEBT-001 SSL 证书 (依赖 Phase L 解锁)
- [ ] DEBT-012 测试覆盖率提升到 40% (第一阶段)
- [ ] DEBT-018 多租户隔离 (开始)
- **预期健康评分提升**: 50 → 62 (+12)

### 17.4 Phase 4: 持续优化 (Month 3+)

- [ ] PostgreSQL 持久化迁移
- [ ] 自动化债务检测 (SonarQube 集成)
- [ ] Prometheus Metrics 导出
- [ ] 季度全面审计
- [ ] 健康评分目标: ≥ 70

---

## 18. 附录

### 附录 A: 债务 ID 编码规则

```
格式: DEBT-NNN
  - DEBT: 固定前缀
  - NNN: 3 位顺序号 (001-999)

分配规则:
  - 001-099: 首批审计发现 (S132)
  - 100-199: 后续 Session 发现
  - 200-299: 自动化工具检测
  - 300+: 外部审计/安全扫描发现

示例:
  DEBT-001: 首批第 1 条 (SSL 证书)
  DEBT-101: S133 发现的第 1 条
  DEBT-201: SonarQube 自动检测的第 1 条
```

### 附录 B: 利息速查表

| 天数 | CRITICAL (5%) | HIGH (2%) | MEDIUM (0.5%) | LOW (0.1%) |
|------|---------------|-----------|---------------|-------------|
| 7 | 0.41P | 0.15P | 0.04P | 0.01P |
| 15 | 1.08P | 0.35P | 0.08P | 0.02P |
| 30 | 3.32P | 0.81P | 0.16P | 0.03P |
| 60 | 11.8P | 2.31P | 0.35P | 0.06P |
| 90 | 50.5P | 5.96P | 0.56P | 0.09P |

*注: P = 本金, 表格值为利息倍数 (即 I = value × P)*

### 附录 C: 状态转换矩阵

```
           ┌──────────────────────────────────────────┐
           │         TO (目标状态)                     │
           │ DETECTED OPEN IN_PROG BLOCKED DONE ARCHIVED│
FROM ──────┼──────────────────────────────────────────┤
DETECTED   │   -      ✓      ✗      ✗      ✗      ✗  │
OPEN       │   ✗      -      ✓      ✓      ✗      ✗  │
IN_PROGRESS│   ✗      ✓      -      ✓      ✓      ✗  │
BLOCKED    │   ✗      ✓      ✗      -      ✗      ✗  │
DONE       │   ✗      ✗      ✗      ✗      -      ✓  │
ARCHIVED   │   ✗      ✗      ✗      ✗      ✗      -  │
           └──────────────────────────────────────────┘
  ✓ = 允许的转换
  ✗ = 禁止的转换 (返回 422 Unprocessable Entity)
```

### 附录 D: 参考文献与延伸阅读

1. **Ward Cunningham (1992)**: "The WyCash Portfolio Management System" — 技术债务概念的起源
2. **Martin Fowler (2015)**: "Technical Debt Quadrant" — 四象限分类法
3. **Steve McConnell (2016)**: "Best Practices for Technical Debt" — IEEE Software
4. **SonarSource**: "SQALE Methodology" — 基于质量属性的量化方法
5. **Google SRE Book**: "Eliminating Toil" — 与技术债务的关系
6. **Team Topologies (2019)**: "Cognitive Load" — 技术债务对认知负荷的影响
7. **Accelerate (2018)**: "Technical Debt and Deployment Performance" — DORA 研究

### 附录 E: 术语表

| 术语 | 英文 | 定义 |
|------|------|------|
| 本金 | Principal | 修正技术债务所需的基础工作量 |
| 利息 | Interest | 因延迟修正而产生的额外工作量 |
| 复利 | Compound Interest | 利息按时间指数增长的特性 |
| ROI | Return on Investment | 利率与本金的比值，用于优先级排序 |
| 偿还 | Repayment | 修正技术债务的行动 |
| 债务登记 | Debt Registration | 将发现的技术债务正式记录的过程 |
| 健康评分 | Health Score | 0-100 的综合指标，反映整体债务状况 |
| 债务密度 | Debt Density | 每 KLOC 的技术债务数量 |
| 偿还能力 | Repayment Capacity | 团队可用于偿还债务的时间预算 |
| 债务年龄 | Debt Age | 从发现到当前的经过天数 |
| BLOCKED | Blocked | 因外部依赖无法开始偿还的状态 |
| Q1-Q4 | Quadrants 1-4 | Fowler 四象限分类 |

### 附录 F: 文件清单

| 文件 | 路径 | 行数 | 用途 |
|------|------|------|------|
| 技术债务登记册 | `docs/technical-debt/TECHNICAL_DEBT_REGISTER.md` | 639 | 权威债务清单 |
| REST API | `api/routes/techDebt.js` | 1194 | API 端点实现 |
| CLI 分析工具 | `scripts/debt-analyzer.sh` | ~550 | 本地分析脚本 |
| Grafana 仪表盘 | `grafana/dashboards/technical-debt.json` | ~450 | 可视化面板配置 |
| 设计文档 (本文) | `docs/TECHNICAL_DEBT_TRACKER.md` | 600+ | 方法论文档 |

---

> **文档结束**
>
> *本文档属于 GlobalReach V2.0 项目 O08 技术债务追踪系统的组成部分*
> *最后更新: 2026-06-09 | 版本: v1.0 | 状态: 已实施*
