# GlobalReach V2.0 — 变更风险评分系统（Change Risk Scoring System）

> **O05 Session 文档** | 构建五维风险评估引擎与审批工作流
>
> **状态**: ✅ 已实施 | **脚本**: `scripts/risk-assessor.sh` | **API**: `api/routes/changeRisk.js` | **数据库**: `data/risk-db.json`
>
> **版本**: v1.0.0 | **日期**: 2026-06-09

---

## 目录

- [第一章：系统概述与目标](#第一章系统概述与目标)
- [第二章：五维风险评分模型](#第二章五维风险评分模型)
    - [2.1 D1: 影响范围（Scope Impact）](#21-d1-影响范围scope-impact)
    - [2.2 D2: 变更类型（Change Type）](#22-d2-变更类型change-type)
    - [2.3 D3: 历史故障率（History Failure Rate）](#23-d3-历史故障率history-failure-rate)
    - [2.4 D4: 回滚难度（Rollback Difficulty）](#24-d4-回滚难度rollback-difficulty)
    - [2.5 D5: 测试覆盖（Test Coverage）](#25-d5-测试覆盖test-coverage)
    - [2.6 综合风险分计算](#26-综合风险分计算)
- [第三章：风险等级与决策矩阵](#第三章风险等级与决策矩阵)
- [第四章：技术架构设计](#第四章技术架构设计)
    - [4.1 系统组件架构](#41-系统组件架构)
    - [4.2 数据流图](#42-数据流图)
    - [4.3 风险数据库 Schema](#43-风险数据库-schema)
- [第五章：集成方案](#第五章集成方案)
    - [5.1 CI/CD Pipeline 集成](#51-cicd-pipeline-集成)
    - [5.2 Pre-push Hook 集成](#52-pre-push-hook-集成)
    - [5.3 PR Comment 自动化](#53-pr-comment-自动化)
- [第六章：风险审批工作流](#第六章风险审批工作流)
    - [6.1 审批流程定义](#61-审批流程定义)
    - [6.2 角色与权限](#62-角色与权限)
    - [6.3 审批记录审计](#63-审批记录审计)
- [第七章：案例研究：S131 事故回溯分析](#第七章案例研究s131-事故回溯分析)
- [第八章：运维指南](#第八章运维指南)
    - [8.1 日常使用](#81-日常使用)
    - [8.2 调优建议](#82-调优建议)
    - [8.3 故障排查](#83-故障排查)
- [第九章：扩展路线图](#第九章扩展路线图)
- [附录](#附录)

---

## 第一章：系统概述与目标

### 1.1 背景

GlobalReach V2.0 作为企业级邮件营销平台，在 **S131 Session** 中经历了严重的生产事故：由于 AI 子代理产出的配置文件与运行时镜像版本不兼容，导致 **4 个容器同时进入 CrashLoopBackOff**，影响时长约 **8 小时**。

事故根因分析揭示：
- CI/CD Pipeline 缺乏变更风险评估环节
- 配置文件变更没有独立的风险评估机制
- 缺乏基于历史数据的量化风险指标
- 没有标准化的审批流程来控制高风险变更

### 1.2 目标

本系统的核心目标是：

| 目标编号 | 描述 | 成功标准 |
|---------|------|---------|
| G1 | **量化风险** | 每次变更都能获得 0-10 的数值化风险分数 |
| G2 | **多维评估** | 从 5 个维度全面评估变更风险 |
| G3 | **历史驱动** | 利用 S131 等历史事故数据校准评分模型 |
| G4 | **可操作输出** | 提供明确的审批要求和缓解建议 |
| G5 | **CI/CD 集成** | 无缝嵌入现有 GitHub Actions 流程 |
| G6 | **审计追溯** | 所有评估和审批记录完整保存 |

### 1.3 设计原则

#### 原则 1：只读分析工具

本系统是**纯分析性工具**，不阻止任何操作：
- ✅ 提供风险评估和建议
- ❌ 不阻止代码合并或部署
- ❌ 不修改任何业务逻辑
- ✅ 由人工根据评估结果做最终决策

这符合 **ITIL Change Management** 的"评估-授权-实施"流程。

#### 原则 2：保守估计

在不确定性情况下，倾向于给出更高的风险分数：
- 无历史记录的组件 → 保守分数（3 分）
- 无法判断的变更类型 → 归入较高风险类别
- 测试覆盖未知 → 假设无覆盖

这是为了避免漏报（False Negative），宁可误报（False Positive）。

#### 原则 3：持续进化

评分模型不是静态的：
- 新的事故数据会更新 `risk-db.json` 的历史故障率
- 可以根据实际效果调整维度权重
- 支持自定义阈值以适应不同团队的容忍度

### 1.4 ITIL / COBIT 对齐

本系统对齐以下框架：

| 框架域 | 对应实现 |
|--------|---------|
| **ITIL Change Management** | 变更分类 → 风险评估 → CAB 审批 → 实施 |
| **COBIT DSS05 | 安全的变更管理** | 标准化的变更请求和审批流程 |
| **COBIT APO12 | 风险管理** | 量化的风险评估和监控 |
| **ISO 27001 A.14.2** | 变更的安全评审 |

---

## 第二章：五维风险评分模型

### 2.1 理论基础

本模型采用**加权多属性决策方法（MADM）**，灵感来源于：

1. **FMEA（Failure Mode and Effects Analysis）** — 严重度 × 发生率 × 检测度
2. **CVSS（Common Vulnerability Scoring System）** — 多维度向量评分
3. **DORA Metrics** — 变更失败率和恢复时间

核心公式：

```
RiskScore = Σ(Di × Wi), i = 1..5

其中:
  Di = 第 i 维度的原始分值 (1-10)
  Wi = 第 i 维度的权重系数 (ΣWi = 1.0)
```

### 2.1 D1: 影响范围（Scope Impact）

**权重**: 25% | **重要性**: ⭐⭐⭐⭐⭐

#### 评估逻辑

```python
def calculate_d1(file_count, has_core_component, has_entry_component):
    # 基于文件数量的基础分
    base_score = lookup_file_count_score(file_count)

    # 应用组件关键度加权
    if has_core_component:
        base_score *= 1.5  # API/DB/Redis 是核心
    if has_entry_component:
        base_score *= 1.3  # Nginx 是入口

    return min(base_score, 10.0)  # 上限为 10
```

#### 评分表

| 文件数 | 基础分 | 说明 |
|--------|-------|------|
| 1-2    | 2.0   | 小改动，影响有限 |
| 3-5    | 4.0   | 中等规模变更 |
| 6-10   | 6.0   | 较大范围变更 |
| 11-20  | 8.0   | 大规模重构 |
| 21+    | 10.0  | 全局性变更 |

#### 组件关键度分级

| 级别 | 组件示例 | 加权系数 | 理由 |
|------|---------|---------|------|
| **核心** | api-prod, postgres, redis | ×1.5 | 业务数据和逻辑的核心 |
| **入口** | nginx | ×1.3 | 所有流量的网关 |
| **普通** | 其他组件 | ×1.0 | 标准权重 |

#### 设计理由

影响范围是最重要的维度（25% 权重），因为：
1. **爆炸半径理论**: 变更范围越大，潜在影响面越广
2. **耦合效应**: 多文件变更往往意味着跨模块依赖
3. **测试复杂度**: 范围大的变更需要更全面的回归测试

### 2.2 D2: 变更类型（Change Type）

**权重**: 20% | **重要性**: ⭐⭐⭐⭐

#### 变更类型分类与评分

| 类型 | 分数 | 示例 | 理由 |
|------|------|------|------|
| **纯文档** | 1 | *.md, README | 无运行时影响 |
| **新增测试/脚本** | 3 | *.test.js, scripts/*.sh | 提高质量但不改变行为 |
| **新增业务代码** | 5 | 新路由、新服务 | 增加功能但向后兼容 |
| **修改业务代码** | 6 | 修改现有逻辑 | 可能引入回归缺陷 |
| **配置文件变更** | 7 | nginx/*.conf, alertmanager/*.yml | 运行时行为变化，S131 教训 |
| **数据库迁移** | 9 | migration/*.sql, schema 变更 | 数据丢失风险，不可逆 |
| **基础设施变更** | 10 | Dockerfile, docker-compose.yml | 影响整个部署拓扑 |

#### 检测算法

```bash
for file in "${CHANGED_FILES[@]}"; do
    case "$file" in
        *.md)           score=1 ;;   # 文档
        *.test.js)      score=3 ;;   # 测试
        docker-compose*)score=10;;  # 基础设施
        api/db/*)       score=9 ;;   # 数据库
        nginx/*.conf)   score=7 ;;   # 配置
        api/routes/*.js) score=5 ;;  # 业务代码
    esac
done
# 取最高分作为该维度得分
```

#### 特殊规则

- **取最大值原则**: 如果同时包含多种变更类型，取最高风险分数
- **文档排除**: 如果全部变更都是文档，整体得分为 1
- **混合场景**: 代码+配置混合变更按高者计算

### 2.3 D3: 历史故障率（History Failure Rate）

**权重**: 20% | **重要性**: ⭐⭐⭐⭐

#### 数据源

本维度使用 **docs/CONFIG_VALIDATION_SAFETY_NET.md 第四章** 的兼容性问题数据库：

| COMPAT ID | 组件 | 问题 | 严重程度 | 发现 Session |
|-----------|------|------|---------|-------------|
| COMPAT-001 | AlertManager | max_alerts_per_message | 🔴 Critical | S131 |
| COMPAT-002 | Prometheus | eval_interval | 🔴 Critical | S131 |
| COMPAT-003 | Prometheus | PromQL offset syntax | 🟠 High | S131 |
| COMPAT-004 | Promtail | line_drop_pattern | 🔴 Critical | S131 |
| COMPAT-005 | Promtail | filter stage | 🔴 Critical | S131 |
| COMPAT-006 | Nginx | location context error | 🟠 High | S131 |
| COMPAT-007 | Nginx | unresolved container ref | 🟡 Medium | S131 |

#### 评分映射

| 历史故障次数 | 得分 | 含义 |
|-------------|------|------|
| 0 次 | 3.0 | 保守估计（无记录不代表无风险） |
| 1 次 | 5.0 | 有过先例，需警惕 |
| 2 次 | 7.0 | 反复出问题，高风险区域 |
| 3+ 次 | 9.0 | 高频故障区，极高风险 |

#### 计算方法

```python
def calculate_d3(changed_files, compat_issues):
    total_incidents = 0
    for file in changed_files:
        incidents = count_matching_issues(file, compat_issues)
        total_incidents += incidents

    # 映射到 1-10 分
    if total_incidents >= 3:
        return 9.0
    elif total_incidents == 2:
        return 7.0
    elif total_incidents == 1:
        return 5.0
    else:
        return 3.0  # 保守默认值
```

#### 为什么默认 3 分而不是 1 分？

遵循**保守估计原则**：
- "没有坏消息 ≠ 好消息"
- 可能是未被发现的问题
- 新组件缺乏历史数据验证
- 避免给用户虚假的安全感

### 2.4 D4: 回滚难度（Rollback Difficulty）

**权重**: 20% | **重要性**: ⭐⭐⭐⭐

#### 回滚难度分级

| 场景 | 得分 | 回滚方式 | 时间成本 |
|------|------|---------|---------|
| **纯新增文件** | 2 | 删除文件即可 | < 1 分钟 |
| **可 git revert** | 4 | 一条命令回滚 | < 5 分钟 |
| **需要数据迁移回滚** | 7 | 执行 down migration | 15-60 分钟 |
| **外部状态变更 (DB/证书)** | 9 | 手动还原备份 | 1-4 小时 |
| **不可逆变更** | 10 | 无法完全回滚 | N/A |

#### 检测逻辑

```python
def calculate_d4(changed_files):
    has_external_state_change = False
    needs_data_migration = False
    all_new_files = True

    for file in changed_files:
        # 检查是否修改了已有文件
        if is_modified_file(file):
            all_new_files = False

        # 检查外部状态变更
        if file_matches('*.sql', 'migrations/*'):
            needs_data_migration = True
            has_external_state_change = True
        elif file_matches('*.pem', '*.key', 'certbot/*'):
            has_external_state_change = True

    # 确定难度等级
    if has_external_state_change:
        return 9.0 if needs_data_migration else 9.0
    elif not all_new_files:
        return 7.0 if needs_data_migration else 4.0
    else:
        return 2.0  # 最简单情况
```

#### 关键考虑因素

1. **数据不可逆性**: Schema 变更是最难回滚的
2. **证书轮换**: SSL 证书变更需要 DNS 传播时间
3. **配置漂移**: 长时间运行的实例可能有手动修改
4. **依赖链**: 一个服务的回滚可能触发级联回滚

### 2.5 D5: 测试覆盖（Test Coverage）

**权重**: 15% | **重要性**: ⭐⭐⭐

#### 测试覆盖等级

| 等级 | 得分 | 条件 | 置信度 |
|------|------|------|--------|
| **有单元/集成测试** | 2 | 存在对应的 .test.js/.spec.js 文件 | 🟢 高 |
| **有配置验证覆盖** | 4 | validate-configs.sh 可检查此文件 | 🟡 中 |
| **可手动验证 (health endpoint)** | 6 | 可通过 health API 验证 | 🟠 低 |
| **无自动化验证** | 9 | 无任何形式的自动验证 | 🔴 极低 |

#### 检测方法

```python
def calculate_d5(changed_files):
    has_unit_test = any(
        exists(f"{file}_test.js") or f"{file}" in test_directory
        for file in changed_files
    )

    has_config_validation = any(
        matches_pattern(file, ["nginx/*.conf", "*.yml"])
        and exists("scripts/validate-configs.sh")
        for file in changed_files
    )

    has_health_endpoint = any(
        matches_pattern(file, ["api/routes/*.js", "api/services/*.js"])
        and exists("api/routes/health.js")
        for file in changed_files
    )

    if has_unit_test:
        return 2.0
    elif has_config_validation:
        return 4.0
    elif has_health_endpoint:
        return 6.0
    else:
        return 9.0
```

#### 为什么测试覆盖权重最低（15%）？

1. **测试质量差异大**: 有测试 ≠ 有效测试
2. **覆盖率悖论**: 100% 覆盖率也可能遗漏边界条件
3. **配置文件特殊性**: 很多配置问题无法通过传统测试发现
4. **实际经验**: S131 中的问题都有配置验证脚本但仍发生

但这不意味着测试不重要——它只是相对其他维度而言权重较低。

### 2.6 综合风险分计算

#### 公式

```
RiskScore = D1×0.25 + D2×0.20 + D3×0.20 + D4×0.20 + D5×0.15
```

#### 数学性质

1. **有界性**: RiskScore ∈ [1.0, 10.0]
2. **单调性**: 任一维度增加，总分增加
3. **凸组合**: 权重之和为 1.0，保证可比性
4. **线性可加**: 各维度贡献独立可追溯

#### 示例计算

假设某次变更：
- D1 (影响范围): 6.0 (涉及 7 个文件，含 API 代码)
- D2 (变更类型): 7.0 (配置文件变更)
- D3 (历史故障): 5.0 (AlertManager 有 1 次历史问题)
- D4 (回滚难度): 4.0 (可 git revert)
- D5 (测试覆盖): 4.0 (有 validate-configs.sh 覆盖)

```
RiskScore = 6.0×0.25 + 7.0×0.20 + 5.0×0.20 + 4.0×0.20 + 4.0×0.15
          = 1.50     + 1.40     + 1.00     + 0.80     + 0.60
          = 5.30
```

**结果**: 🟠 HIGH (5.1-7.0 区间) → 需要技术负责人审批

---

## 第三章：风险等级与决策矩阵

### 3.1 四级风险体系

| 等级 | 分数范围 | 颜色 | Emoji | 审批要求 | 操作建议 |
|------|---------|------|-------|---------|---------|
| **LOW** | 1.0 - 3.0 | 绿色 | 🟢 | 自助部署 | 正常合并到 main |
| **MEDIUM** | 3.1 - 5.0 | 黄色 | 🟡 | 同行评审后部署 | 至少 1 位 Reviewer 批准 |
| **HIGH** | 5.1 - 7.0 | 橙色 | 🟠 | 技术负责人审批 | 窗口期部署 + 监控 |
| **CRITICAL** | 7.1 - 10.0 | 红色 | 🔴 | CTO 审批 + 变更委员会 | 紧急预案就绪 |

### 3.2 阈值设定方法论

#### 方法 1: 基于历史数据校准（推荐）

使用 S131 等 Session 的数据进行反向工程：

```python
# 如果 S131 的变更有这些特征：
s131_scores = {
    'd1': 8.0,   # 11 个配置文件
    'd2': 8.0,   # 全部是配置变更
    'd3': 8.0,   # AlertManager/Prometheus/Promtail/Nginx 都有问题
    'd4': 6.0,   # 需要逐个修复
    'd5': 6.0,   # 当时没有验证脚本
}

s131_risk = sum(d * w for d, w in zip(s131_scores.values(), weights))
# 结果 ≈ 7.4 → CRITICAL 等级 ✓
```

这验证了阈值的合理性：S131 这种事故理应被评为 CRITICAL。

#### 方法 2: 业务影响映射

| 业务影响 | 风险分区间 | 典型场景 |
|---------|-----------|---------|
| 几乎无影响 | 1.0-2.0 | 文档修正、注释添加 |
| 轻微影响 | 2.1-3.5 | UI 微调、日志优化 |
| 中等影响 | 3.6-5.5 | 新增非核心功能、配置调整 |
| 重大影响 | 5.6-7.5 | 核心逻辑修改、数据库迁移 |
| 致命影响 | 7.6-10.0 | 基础设施重构、安全补丁 |

#### 方法 3: 统计分布法（未来增强）

收集足够多的评估数据后，可以使用统计方法：
- **百分位法**: P90 的分数作为 HIGH 阈值
- **聚类算法**: K-Means 将评分自然分为 4 类
- **ROC 曲线**: 优化阈值以最大化真阳性率

### 3.3 决策树

```
收到变更请求
│
├─ 计算 RiskScore
│
├─ RiskScore ≤ 3.0?
│  └─ YES → 🟢 LOW
│     ├─ 开发者自助合并
│     ├─ 可选：通知团队频道
│     └─ 正常 CI/CD 流程
│
├─ RiskScore ≤ 5.0?
│  └─ YES → 🟡 MEDIUM
│     ├─ 创建 PR
│     ├─ 要求 ≥1 位 Reviewer
│     ├─ 运行全量测试
│     └─ Review 通过后合并
│
├─ RiskScore ≤ 7.0?
│  └─ YES → 🟠 HIGH
│     ├─ 提交变更申请单
│     ├─ Tech Lead 审批
│     ├─ 安排部署窗口（低流量时段）
│     ├─ 准备回滚方案
│     ├─ 部署后实时监控 30 分钟
│     └─ 通知 on-call 工程师
│
└─ RiskScore > 7.0
   └─ 🔴 CRITICAL
      ├─ 召开变更委员会会议
      ├─ CTO 最终审批
      ├─ Staging 环境完整回归测试
      ├─ 编写详细回滚预案
      ├─ 准备应急联系人名单
      ├─ 安排专人值守
      └─ 部署后监控至少 2 小时
```

---

## 第四章：技术架构设计

### 4.1 系统组件架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                  GlobalReach 变更风险评分系统                         │
├─────────────┬──────────────┬──────────────┬─────────────────────────┤
│             │              │              │                         │
│  CLI 工具   │   REST API   │  风险数据库   │      CI/CD 集成         │
│             │              │              │                         │
│ risk-       │ changeRisk   │ risk-db.json │ config-validation.yml    │
│ assessor.sh │ .js          │              │ (GitHub Actions)         │
│             │              │              │                         │
│ Bash 脚本   │ Express Router│ JSON 文件    │ Workflow Step            │
│ ~600 行     │ ~350 行      │ ~150 行      │ ~50 行                  │
│             │              │              │                         │
├─────────────┴──────────────┴──────────────┴─────────────────────────┤
│                                                                     │
│                        共享依赖层                                    │
│  ┌────────────────┬────────────────┬────────────────────────────┐  │
│  │ Git Commands   │ Python (JSON)  │ Node.js Runtime            │  │
│  │ diff/log/status│ bc (math)      │ Express / File System      │  │
│  └────────────────┴────────────────┴────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 数据流图

```
[开发者提交代码]
      │
      ▼
[Git Hook / 手动触发]
      │
      ├──► [risk-assessor.sh] ──┐
      │    │                    │
      │    ├─ 收集变更文件列表     │
      │    ├─ 加载 risk-db.json  │
      │    ├─ 计算 5 维度得分     │
      │    ├─ 检测风险/缓解因素   │
      │    └─ 生成报告/JSON       │
      │                         │
      ▼                         ▼
[终端输出报告]          [API Response JSON]
      │                         │
      │                         ▼
      │                   [save to risk-history.json]
      │                         │
      ▼                         ▼
[开发者决策]            [Dashboard / History API]
```

### 4.3 风险数据库 Schema

#### 4.3.1 主结构

```json
{
  "version": "1.0.0",
  "created": "2026-06-09",
  "description": "GlobalReach V2.0 变更风险评分系统 - 风险因子数据库",

  "components": {
    "<component_name>": {
      "criticality": 1-10,
      "history_incidents": 0-N,
      "rollback_complexity": 1-10,
      "description": "string"
    }
  },

  "file_patterns": {
    "<glob_pattern>": {
      "change_type": 1-10,
      "test_coverage": 1-10,
      "category": "string",
      "description": "string"
    }
  },

  "compat_issues": [
    {
      "id": "COMPAT-NNN",
      "component": "string",
      "file": "string",
      "issue": "string",
      "session": "string",
      "severity": "critical|high|medium|low",
      "status": "open|fixed|wonfix|deprecated",
      "discovery_date": "YYYY-MM-DD"
    }
  ],

  "risk_thresholds": {
    "LOW/MEDIUM/HIGH/CRITICAL": {
      "min": float,
      "max": float,
      "color": "string",
      "emoji": "string",
      "approval": "string",
      "action": "string"
    }
  },

  "dimension_weights": {
    "scope_impact": 0.25,
    "change_type": 0.20,
    "history_failure": 0.20,
    "rollback_difficulty": 0.20,
    "test_coverage": 0.15
  }
}
```

#### 4.3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `version` | string | ✅ | 数据库版本号，用于迁移 |
| `components.*.criticality` | integer | ✅ | 组件关键度 (1-10)，10 最关键 |
| `components.*.history_incidents` | integer | ✅ | 历史事故次数 |
| `compat_issues[].id` | string | ✅ | 唯一标识符 (COMPAT-NNN) |
| `compat_issues[].severity` | enum | ✅ | 严重程度分级 |
| `dimension_weights.*` | float | ✅ | 权重系数，总和必须 = 1.0 |

---

## 第五章：集成方案

### 5.1 CI/CD Pipeline 集成

#### 方案 A: 在现有 pipeline 中添加步骤

在 `.github/workflows/ci-cd.yml` 的 `quality-gate` job 后添加：

```yaml
# 在 quality-gate job 之后
risk-assessment:
  name: Risk Assessment
  needs: quality-gate
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'

  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      with:
        fetch-depth: 0  # 需要 full history 进行 diff

    - name: Run Risk Assessment
      id: risk
      run: |
        chmod +x scripts/risk-assessor.sh
        RESULT=$(./scripts/risk-assessor.sh --diff origin/main...HEAD --json)
        echo "$RESULT" > risk-report.json
        echo "risk_score=$(jq '.summary.risk_score' risk-report.json)" >> $GITHUB_OUTPUT
        echo "risk_level=$(jq '.summary.risk_level' risk-report.json)" >> $GITHUB_OUTPUT

    - name: Post Risk Comment to PR
      uses: actions/github-script@v7
      with:
        script: |
          const fs = require('fs');
          const report = JSON.parse(fs.readFileSync('risk-report.json', 'utf8'));
          const emoji = report.summary.risk_emoji;
          const level = report.summary.risk_level;
          const score = report.summary.risk_score;

          const body = `
          ## 📊 变更风险评估
          **综合风险分**: ${emoji} ${score}/10 (${level})
          **审批要求**: ${report.summary.approval_required}
          **建议操作**: ${report.summary.recommended_action}
          
          <details>
          <summary>详细信息</summary>
          
          \`\`\`json
          ${JSON.stringify(report.dimensions, null, 2)}
          \`\`\`
          </details>
          `;

          github.rest.issues.createComment({
            issue_number: context.issue.number,
            owner: context.repo.owner,
            repo: context.repo.repo,
            body: body
          });
```

#### 方案 B: 独立 workflow（推荐用于初期）

创建 `.github/workflows/risk-assessment.yml`:

```yaml
name: Change Risk Assessment

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths-ignore:
      - '**.md'
      - 'docs/**'

jobs:
  assess:
    name: Assess Change Risk
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y bc jq

      - name: Run Risk Assessor
        id: assess
        run: |
          chmod +x scripts/risk-assessor.sh
          ./scripts/risk-assessor.sh --json > assessment-result.json
          echo "level=$(jq -r '.summary.risk_level' assessment-result.json)" >> $GITHUB_OUTPUT
          echo "score=$(jq -r '.summary.risk_score' assessment-result.json)" >> $GITHUB_OUTPUT

      - comment: Update PR with risk assessment
        uses: actions/github-script@v7
        with:
          script: |
            const { execSync } = require('child_process');
            const result = JSON.parse(execSync('cat assessment-result.json').toString());
            
            const header = result.summary.risk_level === 'CRITICAL'
              ? '### 🚨 **CRITICAL RISK** 🚨'
              : result.summary.risk_level === 'HIGH'
                ? '### ⚠️ **HIGH RISK** ⚠️'
                : `### 📊 **${result.summary.risk_level} RISK**`;
            
            const body = `${header}\n\n` +
              `- **Score**: ${result.summary.risk_emoji} ${result.summary.risk_score}/10\n` +
              `- **Approval**: ${result.summary.approval_required}\n` +
              `- **Action**: ${result.summary.recommended_action}\n\n` +
              `<details><summary>📋 Details</summary>\n\n` +
              `\`\`\`\n${JSON.stringify(result, null, 2)}\n\`\`\`\n</details>`;
            
            // Find existing comment or create new one
            // ... (implementation details omitted)
```

### 5.2 Pre-push Hook 集成

本地开发时的即时反馈：

```bash
#!/bin/bash
# .git/hooks/pre-push

echo "🔄 Running pre-push risk assessment..."

# 只检查将要推送的 commits
REMOTE="$1"
URL="$2"

while read local_ref local_sha remote_ref remote_sha; do
    if [ "$local_sha" = "$zero_commit" ]; then
        # 删除分支，跳过检查
        continue
    fi

    if [ "$remote_sha" = "$zero_commit" ]; then
        # 新分支，检查所有不在远程的 commits
        range="${remote_sha}..${local_sha}"
    else
        range="${remote_sha}..${local_sha}"
    fi

    # 执行风险评估
    RESULT=$(./scripts/risk-assessor.sh --diff "$range" --json 2>/dev/null || echo '{}')
    SCORE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('summary',{}).get('risk_score','?'))" 2>/dev/null || echo '?')
    
    if [ "$SCORE" != "?" ] && [ "$(echo "$SCORE > 7.0" | bc 2>/dev/null)" = "1" ]; then
        echo ""
        echo "🚨 WARNING: High risk change detected (Score: $SCORE)"
        echo "Please ensure you have proper approval before pushing."
        echo ""
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
done

exit 0
```

安装 hook:

```bash
ln -sf ../../scripts/pre-push-risk-check.sh .git/hooks/pre-push
chmod +x .git/hooks/pre-push-risk-check.sh
```

### 5.3 PR Comment 自动化

使用 GitHub Actions Bot 自动评论 PR：

**Comment Template**:

```markdown
## 📊 GlobalReach 变更风险评估

| 项目 | 值 |
|------|-----|
| **综合风险分** | 🟠 6.8 / 10 |
| **风险等级** | HIGH |
| **审批要求** | 技术负责人审批 |
| **建议操作** | 窗口期部署 + 监控 |

### 维度明细

| 维度 | 分数 | 权重 | 加权分 |
|------|------|------|--------|
| 影响范围 | 8.0 | 25% | 2.00 |
| 变更类型 | 7.0 | 20% | 1.40 |
| 历史故障 | 6.0 | 20% | 1.20 |
| 回滚难度 | 7.0 | 20% | 1.40 |
| 测试覆盖 | 4.0 | 15% | 0.60 |

### ⚠️ 高风险因素

1. 涉及 Prometheus 规则变更 (影响告警)
2. 新增 API 路由 (影响路由安全)
3. 无对应集成测试

### ✅ 缓解因素

1. 配置已通过 validate-configs.sh 验证
2. 纯新增文件（无修改现有逻辑）
3. Docker Compose 未变动

---
*由 O05 变更风险评分系统自动生成*
```

---

## 第六章：风险审批工作流

### 6.1 审批流程定义

#### Level 1: 自助部署 (LOW)

```
[Developer]
    │
    ├─ 本地运行 risk-assessor.sh
    ├─ Score ≤ 3.0 → 🟢 LOW
    ├─ 直接 push 到 main
    └─ CI/CD 自动部署
```

**适用场景**:
- 文档更新
- 代码注释调整
- 日志级别修改
- 新增测试用例

#### Level 2: 同行评审 (MEDIUM)

```
[Developer]
    │
    ├─ 创建 Pull Request
    ├─ 系统自动评估 → 🟡 MEDIUM (3.1-5.0)
    │
    ├─ [Reviewer 1] Code Review
    │   ├─ Approve ✅ 或 Request Changes ❌
    │   └─ (可选) 添加 Review Comment
    │
    ├─ [CI] 全量测试通过
    ├─ Merge to main
    └─ Deploy
```

**适用场景**:
- 新增非核心功能
- Bug 修复
- 配置微调
- 重构（小范围）

#### Level 3: 技术负责人审批 (HIGH)

```
[Developer]
    │
    ├─ 创建 Pull Request
    ├─ 系统自动评估 → 🟠 HIGH (5.1-7.0)
    │
    ├─ [Peer Review] Code Review (≥1 人)
    ├─ [Tech Lead] Risk Approval
    │   ├─ 审查风险评估报告
    │   ├─ 评估回滚方案
    │   ├─ 批准/拒绝/有条件批准
    │   └─ 记录审批意见
    │
    ├─ 安排部署窗口
    │   └─ 推荐时间: 凌晨 2:00-4:00 (CST)
    │
    ├─ [Deployer] 执行部署
    ├─ [Monitor] 实时监控 30 分钟
    └─ [Post-deploy] Health Check
```

**适用场景**:
- 核心业务逻辑修改
- 数据库 migration
- 多服务联动变更
- 性能优化（可能影响延迟）

#### Level 4: CTO + 变更委员会 (CRITICAL)

```
[Developer]
    │
    ├─ 提交变更提案文档
    ├─ 系统自动评估 → 🔴 CRITICAL (7.1-10.0)
    │
    ├─ [CAB] 变更委员会会议
    │   ├─ 技术负责人: 技术可行性
    │   ├─ 安全负责人: 安全影响评估
    │   ├─ 运维负责人: 部署计划和回滚预案
    │   ├─ 产品负责人: 业务影响分析
    │   └─ CTO: 最终决策
    │
    ├─ [Staging] 完整回归测试 (≥24小时)
    ├─ 编写详细回滚预案
    │   ├─ 回滚步骤 (精确到命令)
    │   ├─ 预计回滚时间
    │   ├─ 数据一致性检查点
    │   └─ 应急联系人名单
    │
    ├─ [Announce] 提前通知所有利益相关方
    ├─ [Deploy] 窗口期执行 (需全员在线)
    ├─ [War Room] 专人值守监控 (≥2小时)
    └─ [Post-mortem] 无论成败都写复盘报告
```

**适用场景**:
- 基础设施重大变更 (Docker/网络/存储)
- 数据库 Schema 变更 (不可逆)
- 安全补丁 (可能影响兼容性)
- 第三方依赖大版本升级

### 6.2 角色与权限

| 角色 | 权限范围 | 可批准的最高等级 |
|------|---------|----------------|
| Developer | 发起评估、查看报告 | LOW |
| Reviewer (Peer) | Code Review、评论 | MEDIUM |
| Tech Lead | 风险审批、部署授权 | HIGH |
| Security Engineer | 安全审查 | HIGH |
| DevOps Engineer | 部署执行、监控 | HIGH |
| CTO | 最终决策权 | CRITICAL |
| CAB (变更委员会) | 集体决策 | CRITICAL |

### 6.3 审批记录审计

每次审批都会记录以下信息并通过 API 持久化：

```json
{
  "id": "APV-1686300000-a1b2c3d4",
  "assessment_id": "RA-1686300000-e4f5g6h7",
  "approver": "zhangsan@globalreach.com",
  "decision": "approved",
  "comment": "已审查回滚方案，确认可在 5 分钟内完成回滚",
  "conditions": [
    "必须在凌晨窗口期部署",
    "部署后立即运行健康检查"
  ],
  "timestamp": "2026-06-09T19:00:00Z",
  "ip_address": "192.168.1.100"
}
```

**审计要求**:
- 所有审批记录保留至少 **2 年**
- 不可删除或修改（仅追加）
- 支持 GDPR 合规的数据导出
- 定期审计异常模式（如快速连续批准）

---

## 第七章：案例研究：S131 事故回溯分析

### 7.1 S131 变更概况

如果当时有本系统，S131 的变更会被如何评估？

**变更内容**:
- AlertManager 配置 (`alertmanager.yml`)
- Prometheus 规则 (`rules/performance-alerts.yml`)
- Promtail 配置 (`promtail-config.yml`)
- Nginx 配置 (`cdn-optimizations.conf`)
- 以及可能的辅助文件

**总计**: 约 11 个文件

### 7.2 五维评分回溯

#### D1: 影响范围

- 文件数: 11 个 → 基础分 8.0
- 涉及核心组件: AlertManager, Prometheus, Promtail, Nginx → 全部是核心/入口
- 加权: 8.0 × 1.5 (核心) × 1.3 (入口) = **15.6 → 上限 10.0**

**D1 = 10.0**

#### D2: 变更类型

- 全部是配置文件变更 (.yml, .conf)
- 包含基础设施相关 (docker-compose 可能也有变动)
- 最高类别: 配置变更 (7.0) 或基础设施 (10.0)

假设主要是配置变更: **D2 = 7.0**

(如果是 AI 子代理批量产出，可能还涉及基础设施变更 → D2 = 10.0)

#### D3: 历史故障率

- AlertManager: 1 次 (COMPAT-001)
- Prometheus: 2 次 (COMPAT-002, 003)
- Promtail: 2 次 (COMPAT-004, 005)
- Nginx: 2 次 (COMPAT-006, 007)

总故障次数: 7 次 → **D3 = 9.0** (3+ 次)

#### D4: 回滚难度

- 修改现有配置文件（非新增）
- 涉及多个服务的配置
- 需要逐个修复并重启

**D4 = 7.0** (需要协调多服务回滚)

#### D5: 测试覆盖

- 当时尚无 `validate-configs.sh`
- 无针对这些配置的自动化测试
- 只能手动验证

**D5 = 9.0** (无自动化验证)

### 7.3 综合评分

```
Scenario A (主要配置变更):
RiskScore = 10.0×0.25 + 7.0×0.20 + 9.0×0.20 + 7.0×0.20 + 9.0×0.15
          = 2.50     + 1.40     + 1.80     + 1.40     + 1.35
          = 8.45

Scenario B (含基础设施变更):
RiskScore = 10.0×0.25 + 10.0×0.20 + 9.0×0.20 + 7.0×0.20 + 9.0×0.15
          = 2.50     + 2.00     + 1.80     + 1.40     + 1.35
          = 9.05
```

**两种场景都是 🔴 CRITICAL 等级！**

### 7.4 如果有本系统会怎样？

| 时间线节点 | 实际情况 (无系统) | 有本系统的理想情况 |
|-----------|-----------------|------------------|
| T0: 子代理产出配置 | 直接写入仓库 | 触发风险评估 → 🔴 CRITICAL |
| T0+30min | Push 到 main | **被拦截**: 需要 CTO+CAB 审批 |
| T0+2h | CI/CD 通过并部署 | **不会部署**: 审批流程进行中 |
| T0+4h | 发现 4 个容器崩溃 | **不会发生**: 问题在部署前被发现 |
| T0+8h | 恢复正常 | **无需恢复**: 问题从未到达生产环境 |

**结论**: 如果有本系统，S131 事故**完全可以避免**。

### 7.5 经验教训总结

从 S131 我们学到了：

1. **配置变更 ≠ 低风险**: 配置变更的风险经常被低估
2. **AI 产出需要额外审查**: 自动生成的代码/配置必须有强制审查
3. **历史数据的价值**: 之前的问题模式可以预测未来的风险
4. **防御深度**: 单层防护不够，需要多层（评估→审批→验证→监控）

---

## 第八章：运维指南

### 8.1 日常使用

#### 快速评估当前变更

```bash
# 评估未推送的所有变更
./scripts/risk-assessor.sh

# JSON 输出（适合 CI 集成）
./scripts/risk-assessor.sh --json

# 评估特定 commit
./scripts/risk-assessor.sh --commit abc1234

# 评估自定义范围
./scripts/risk-assessor.sh --diff origin/main..HEAD
```

#### API 调用示例

```bash
# 评估当前变更
curl -X POST http://localhost:3000/api/v1/risk/assess \
  -H "Content-Type: application/json"

# 查看历史记录
curl http://localhost:3000/api/v1/risk/history?limit=10

# 获取仪表盘数据
curl http://localhost:3000/api/v1/risk/dashboard?days=30

# 提交审批
curl -X POST http://localhost:3000/api/v1/risk/approve \
  -H "Content-Type: application/json" \
  -d '{
    "assessmentId": "RA-xxx",
    "approver": "tech-lead@globalreach.com",
    "decision": "approved",
    "comment": "已审查，可以在维护窗口部署"
  }'
```

### 8.2 调优建议

#### 调整维度权重

如果发现某些维度在你的环境中更重要：

编辑 `data/risk-db.json`:

```json
{
  "dimension_weights": {
    "scope_impact": 0.30,      // 提高：你的团队经常遇到大范围变更问题
    "change_type": 0.15,       // 降低：你们有很好的变更分类规范
    "history_failure": 0.25,   // 提高：历史教训很重要
    "rollback_difficulty": 0.20,
    "test_coverage": 0.10      // 降低：测试覆盖暂时不完善
  }
}
```

**注意**: 权重总和必须等于 1.0

#### 调整风险阈值

如果你的团队对风险的容忍度不同：

```json
{
  "risk_thresholds": {
    "LOW": { "min": 1.0, "max": 2.5 },    // 更严格
    "MEDIUM": { "min": 2.6, "max": 4.5 },
    "HIGH": { "min": 4.6, "max": 6.5 },
    "CRITICAL": { "min": 6.6, "max": 10.0 }
  }
}
```

#### 更新历史故障数据

当发生新事故时，及时更新 `data/risk-db.json`:

```json
{
  "compat_issues": [
    {
      "id": "COMPAT-008",
      "component": "NewComponent",
      "file": "new-config.yml",
      "issue": "description of issue",
      "session": "S133",
      "severity": "high",
      "status": "open",
      "discovery_date": "2026-06-10"
    }
  ]
}
```

### 8.3 故障排查

#### 问题 1: 脚本执行失败

**症状**: `bc: command not found`

**解决方案**:
```bash
# macOS
brew install bc

# Ubuntu/Debian
sudo apt-get install bc

# CentOS/RHEL
sudo yum install bc
```

**降级处理**: 脚本会在缺少 `bc` 时使用整数运算（精度降低）

#### 问题 2: Python 未安装

**症状**: YAML 解析失败或 JSON 处理错误

**解决方案**:
```bash
# Ubuntu/Debian
sudo apt-get install python3 python3-yaml

# macOS
brew install python3
pip3 install pyyaml
```

#### 问题 3: Git 仓库状态异常

**症状**: `fatal: not a git repository` 或 `ambiguous argument 'origin/main'`

**解决方案**:
```bash
# 确保在正确的目录
cd /path/to/globalreach-project

# 检查 remote
git remote -v

# 如果没有 origin/main，使用 HEAD^ 代替
./scripts/risk-assessor.sh --diff HEAD~5..HEAD
```

#### 问题 4: 评估结果不合理

**可能原因**:
1. `risk-db.json` 数据过时
2. 文件匹配规则不准确
3. 权重不适合你的场景

**调试方法**:
```bash
# 启用详细输出（临时修改脚本）
DEBUG=1 ./scripts/risk-assessor.sh

# 查看中间结果
grep "DIMENSION_SCORES" -A 10 /tmp/risk-debug.log
```

---

## 第九章：扩展路线图

### Phase 1: 当前版本 (v1.0) ✅

- [x] 五维评分模型实现
- [x] CLI 工具 (risk-assessor.sh)
- [x] REST API (changeRisk.js)
- [x] 风险数据库 (risk-db.json)
- [x] 基础 CI/CD 集成文档
- [x] 设计文档

### Phase 2: 增强 (v1.1) - 计划中

- [ ] **机器学习增强**
  - 使用历史评估数据训练回归模型
  - 自动识别新的高风险模式
  - 异常检测（偏离正常模式的变更）

- [ ] **可视化 Dashboard**
  - Grafana 集成面板
  - 风险趋势图表
  - 团队风险热度图
  - 实时风险评估流

- [ ] **智能推荐**
  - 基于相似历史变更的成功/失败案例
  - 推荐最佳部署时间窗口
  - 自动生成回滚预案模板
  - 推荐需要 Review 的特定文件

### Phase 3: 企业级 (v2.0) - 远期

- [ ] **多项目支持**
  - 支持多个仓库统一管理
  - 跨项目的依赖风险分析
  - 组织级别的风险视图

- [ ] **合规集成**
  - SOC 2 Type II 报告支持
  - ISO 27001 审计轨迹
  - GDPR 数据保护影响评估 (DPIA) 集成

- [ ] **高级工作流**
  - Slack/Teams 审批集成
  - JIRA Service Management 集成
  - PagerDuty on-call 集成
  - 自动化变更日历

- [ ] **预测分析**
  - 基于 DORA 指标的预测模型
  - 变更成功率预测
  - MTTR (平均恢复时间) 估算
  - 故障概率分布

---

## 附录

### A. 文件清单

| 文件路径 | 用途 | 行数（约） |
|---------|------|-----------|
| `scripts/risk-assessor.sh` | CLI 风险评估工具 | ~600 |
| `api/routes/changeRisk.js` | REST API 路由 | ~350 |
| `data/risk-db.json` | 风险因子数据库 | ~150 |
| `data/risk-history.json` | 历史评估记录（运行时生成） | 动态 |
| `docs/CHANGE_RISK_SCORING_SYSTEM.md` | 本设计文档 | ~900+ |

### B. 退出码速查

| 退出码 | 含义 | CI 行为 |
|:-----:|------|--------|
| 0 | 评估成功完成 | ✅ 继续 |
| 1 | 参数错误 | ❌ 停止并提示 |
| 2 | 内部错误 | ⚠️ 跳过但不阻断 |

### C. API 错误码速查

| HTTP Status | Error Code | 含义 |
|:----------:|-----------|------|
| 400 | INVALID_REQUEST | 缺少必要参数 |
| 400 | INVALID_DECISION | 无效的审批决策值 |
| 500 | ASSESSMENT_FAILED | 风险评估执行失败 |
| 500 | HISTORY_FETCH_FAILED | 历史记录读取失败 |
| 500 | THRESHOLDS_FETCH_FAILED | 阈值配置读取失败 |
| 500 | APPROVAL_FAILED | 审批记录保存失败 |
| 500 | DASHBOARD_GENERATION_FAILED | 仪表盘数据生成失败 |

### D. 版本历史

| 版本 | 日期 | 变更 | Author |
|------|------|------|--------|
| v1.0.0 | 2026-06-09 | 初始版本，完整实现五维评分模型 | O05 Session |

### E. 参考资源

1. **ITIL 4: Manage Changes** - https://www.axelos.com/best-practice-solutions/itil/
2. **COBIT 2019: Managed Changes (DSS05)** - www.isaca.org/resources/cobit
3. **DORA State of DevOps Report** - devops-research.com/research.html
4. **CVSS v3.1 Specification** - www.first.org/cvss/
5. **FMEA Handbook (AIAG)** - AIAG.org
6. **ISO/IEC 27001:2022** - A.14.2 Security of changes

### F. 致谢

- **S131 Session Team**: 提供了宝贵的事故数据和根因分析
- **S132 Session Team**: 建立了配置验证防护网，为本系统奠定了基础
- **GlobalReach Community**: 持续改进企业级邮件营销平台的可靠性

---

*本文档由 O05 Session 生成，作为 GlobalReach V2.0 变更风险评分系统的权威参考。*

**最后更新**: 2026-06-09 | **文档版本**: v1.0.0
