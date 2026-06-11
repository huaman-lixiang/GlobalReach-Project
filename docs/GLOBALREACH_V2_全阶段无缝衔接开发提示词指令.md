# GlobalReach V2.0 全阶段无缝衔接开发提示词指令 v2.0

> **版本**: v2.0 (S133 Final Handoff)
> **生效时间**: 2026-06-09
> **适用场景**: 新 TRAE_IDE 对话窗口启动时使用此指令实现零上下文无缝衔接
> **前置条件**: 新对话无任何历史上下文

---

# 🚀 一、立即执行：新对话启动协议（Startup Protocol）

## Step 1: 全局上下文加载（按顺序执行，不可跳过）

### 1.1 读取资产清单（最高优先级）
读取文件: `docs/GLOBALREACH_V2_完整文档资产清单与项目开发报告.md`
→ 获取: 项目全景、所有文件索引、代码统计、当前状态

### 1.2 读取主协议
读取文件: `02-ENTERPRISE-REPORTS/GLOBALREACH_S037_SELF_EXECUTE_PROTOCOL_v6_0_稳态运维与持续进化.md`
→ 获取: 自执行流程、升级触发条件、Post-O状态栏、Session历史

### 1.3 读取防幻觉模板
读取文件: `docs/GLOBALREACH_V2_功能增删改_防幻觉提示词模板.md`
→ 获取: 所有FACT条目(事实源)、ASSUME条目、快速参考卡

### 1.4 读取技术债务登记册
读取文件: `docs/technical-debt/TECHNICAL_DEBT_REGISTER.md`
→ 获取: 28个债务的详细状态(DONE/OPEN/BLOCKED)

## Step 2: 状态验证（确认 Git 状态）

运行命令:
```bash
git log --oneline -5
git status --short
git rev-list --count origin/main..HEAD
```

预期结果:
- HEAD 应该是 `7550925` 或更新
- ahead of origin/main 应该为 0
- 如果有差异 → 以 Git 实际状态为准，更新所有文档中的 HEAD 引用

## Step 3: 测试基线确认（可选但推荐）
```bash
cd api && npm test   # 预期: 90 tests passing
```

---

# 📊 二、项目当前状态快照（Memory Snapshot）

## 2.1 项目身份
| 属性 | 值 |
|------|-----|
| 名称 | GlobalReach V2.0 |
| 定位 | AI驱动的全球化邮件营销 SaaS 平台 |
| 架构 | Node.js Express + PG 15 + Redis 7.4.9 + Nginx + Docker Compose |
| 租户模式 | 多租户(Tenant Context Middleware) |
| API版本管理 | Legacy /api/* (Sunset 2027-06-01) + Versioned /api/v1/* |

## 2.2 开发阶段
```
Phase M (基础架构) ████████████████████ 100% ✅ 26/26
Phase N (核心功能) ████████████████████ 100% ✅  8/8
Phase O (运维优化) ████████████████████ 100% ✅  8/8
Steady State       ████████████████████  ACTIVE ← 你在这里
                   S133: 技术债务偿还 16/28 (60.7%)
```

## 2.3 最近一次 Session 完整记录: S133
- **时间**: 2026-06-09
- **类型**: Post-O Steady State — 技术债务系统性偿还
- **成果**: 16个技术债务偿还 (4 Batch × 4 Agent 并行)
- **Commits**: ~14 (5e72fad → 7550925)
- **新增资产**:
  - 安全: gitleaks防护网 + 9处强制必填密码 + Redis认证
  - 测试: Jest框架 + 90 tests全绿 + CI quality gate激活
  - 文档: DB索引策略(450行) + 缓存策略(770行) + 监控矩阵 + 告警手册 ≈ 3500行
  - 代码: deprecation中间件 + asyncHandler全覆盖(26文件) + cacheService增强
  - 监控: 15条新Prometheus规则 + legacy-api rules
  - 脚本: validate-passwords + audit-n-plus-one + generate-secrets + pre-commit-secrets

## 2.4 关键决策记录 (CDR)
1. **密码管理模式**: 统一采用 `${VAR:?ERROR}` 强制必填 + `.env.prod.template` 占位符
2. **日志方案**: 使用已有 `createLogger('component')` 工厂函数，禁止裸 console.log
3. **错误处理标准**: 所有 async 路由必须 `asyncHandler()` 包装
4. **Legacy API 策略**: RFC 8594 Sunset header + Deprecation warning，迁移窗口至 2027-06-01
5. **测试策略**: Jest(supertest/sinon) 单元测试 + K6 性能 + E2E 冒烟，CI gate 激活

---

# 🎯 三、下一步行动选项（Next Action Options）

新对话启动后，根据用户需求选择以下路径之一:

## Option A: 继续技术债务偿还 (Debt Repayment Continuation)
**推荐理由**: 剩余12个OPEN债务，可继续Batch模式推进
**目标债务**:
- P1残留: DEBT-014(i18n), DEBT-027部分(告警调优深化)
- P2主要: DEBT-005(国际化), DEBT-020(过时注释清理), DEBT-022(README完善)
- P3: DEBT-006(Certbot latest), DEBT-016(.env.cdn整理)
- 新发现: emailService.js N+1×2 (已审计定位), tenantService.setex() bug

## Option B: 新功能开发 (New Feature Development)
**推荐理由**: 核心功能已完成，可进入增值功能迭代
**候选功能**:
- A/B Testing Engine (邮件内容变体测试)
- AI Content Generator (AI驱动邮件文案生成)
- Advanced Analytics Dashboard (用户行为漏斗分析)
- Webhook Event System Enhancement (更多事件类型支持)

## Option C: 生产部署准备 (Production Readiness)
**前提**: 需解决 Blocked 项 (DNS/SSL证书/域名)
**检查清单**:
- [ ] DNS公网解析 *.globalreach.com → 服务器IP
- [ ] Let's Encrypt SSL证书申请 (DEBT-001)
- [ ] 生产环境 .env.prod 配置填充
- [ ] 安全基线扫描 (gitleaks + npm audit)
- [ ] 全量回归测试通过
- [ ] 备份恢复演练

## Option D: 运维优化深化 (Ops Deepening)
- 容量规划自动化 (O04 已有基础，可扩展)
- Chaos Engineering (故障注入测试)
- 成本优化 (资源利用率分析)
- 备份策略完善 (PG WAL归档 + Redis AOF/RDB)

---

# 🔧 四、多Agent并行开发模板（Multi-Agent Parallel Execution）

当任务复杂度需要并行加速时，使用以下模板:

## 4.1 Agent 分工原则
| Agent 类型 | 适用任务 | 示例 |
|------------|----------|------|
| Agent-A (安全/配置) | docker-compose修改、密钥管理、环境变量 | DEBT类安全修复 |
| Agent-B (API/路由) | middleware新增、route修改、handler重构 | asyncHandler/日志统一 |
| Agent-C (测试/质量) | Jest测试编写、覆盖率提升、CI配置 | DEBT-012扩展 |
| Agent-D (文档/策略) | 策略文档编写、债务登记册更新、协议同步 | DEBT-023/024/027类 |
| Agent-E (基础设施) | Prometheus规则、Nginx配置、Docker优化 | DEBT-026/监控类 |

## 4.2 并行执行约束
1. **同一文件不分配给多个Agent**（避免merge conflict）
2. **每个Agent必须独立commit**（不要跨Agent合并）
3. **文档同步Agent最后执行**（依赖其他Agent的commit hash）
4. **Push由主线程统一执行**（避免网络并发问题）
5. **每个Agent的任务描述必须自包含**（包含完整上下文，因为Agent无此对话上下文）

## 4.3 标准并行Batch模板
```
Batch N: [主题]
├── Agent A: [任务名] → 目标文件列表 → 预期产出
├── Agent B: [任务名] → 目标文件列表 → 预期产出
├── Agent C: [任务名] → 目标文件列表 → 预期产出
└── Agent D (文档): 债务登记册+协议三件套同步 → commit last, push all
```

---

# 📁 五、关键文件快速引用索引（Quick Reference Index）

## 5.1 入口文件
| 文件 | 用途 |
|------|------|
| `api/server.js` | Express应用主入口 (module.exports = app) |
| `api/package.json` | 依赖管理 + scripts (test/test:coverage/test:ci) |
| `docker-compose.prod.yml` | 生产编排 (9服务, ${VAR:?ERROR} 模式) |
| `.env.prod.template` | 环境变量占位符模板 |

## 5.2 核心业务目录
| 目录 | 文件数 | 说明 |
|------|--------|------|
| `api/routes/` | 29 | 路由模块 (全部asyncHandler覆盖) |
| `api/middleware/` | 15 | 含 errorHandler/auth/rateLimiter/logger/deprecation |
| `api/services/` | 17 | 业务逻辑层 |
| `api/models/` | ~10 | Sequelize ORM模型 |
| `api/db/` | 3 | optimize.js(18索引)/连接/迁移 |

## 5.3 策略文档 (S133新建)
| 文件 | 行数 | 用途 |
|------|------|------|
| `docs/DATABASE_INDEX_STRATEGY.md` | ~450 | 52索引/13表清单 + 维护策略 |
| `docs/CACHE_STRATEGY.md` | ~770 | Key命名/TTL矩阵/失效/监控 |
| `docs/MONITORING_COVERAGE_MATRIX.md` | ~200 | 86%覆盖率矩阵(30/35故障模式) |
| `docs/ALERT_TUNING_PLAYBOOK.md` | ~340 | 告警分级/调优/Runbook/记分卡 |

## 5.4 协议三件套 (每次Session必须同步)
| 文件 | 用途 |
|------|------|
| `02-ENTERPRISE-REPORTS/GLOBALREACH_S037_SELF_EXECUTE_PROTOCOL_v6_0_*.md` | 主协议(自执行流程) |
| `docs/GLOBALREACH_V2_功能增删改_防幻觉提示词模板.md` | 事实源(防幻觉) |
| `docs/GLOBALREACH_V2_全阶段无缝衔接开发提示词指令.md` | 本文件(衔接指令) |

## 5.5 技术债务管理
| 文件 | 版本 | 状态 |
|------|------|------|
| `docs/technical-debt/TECHNICAL_DEBT_REGISTER.md` | v1.4.0 | 17 DONE / 11 OPEN / 4 BLOCKED |

---

# ⚠️ 六、已知问题与风险 (Known Issues & Risks)

## 6.1 已识别Bug (待修复)
| Bug | 位置 | 严重度 | 发现来源 |
|-----|------|--------|----------|
| `setex()` 方法不存在 | tenantService.js:404 | HIGH | DEBT-024审计 |
| N+1 查询 ×2 | emailService.js:546,663 | MEDIUM | DEBT-025审计 |

## 6.2 外部依赖Blocked项
| ID | 问题 | 解除条件 |
|----|------|----------|
| DEBT-001 | SSL证书缺失 | 需DNS公网解析后申请LE证书 |
| DNS | *.globalreach.com 无公网解析 | 需购买域名+服务器公网IP |

## 6.3 注意事项
- 网络环境不稳定(git push可能需多次重试)
- Windows PowerShell环境下某些bash语法需调整
- 文件编码: 衔接指令文件含Unicode box-drawing字符，Edit工具可能无法匹配，需用Node.js脚本或Write覆写

---

# 🔄 七、无缝衔接飞轮旋转协议 (Flywheel Rotation Protocol)

## 7.1 飞轮当前转速: 🟢 HIGH
- 106 commits delivered across 104 sessions
- 16/28 debts repaid in single session (S133)
- 4-Agent parallel execution validated
- All documentation auto-syncing

## 7.2 维持飞轮旋转的关键动作
1. **每Session结束时**: 更新债务登记册版本号 + 协议三件套 + 推送
2. **每Batch开始前**: 读取最新债务登记册确认优先级
3. **并行Agent**: 任务描述必须自包含(假设Agent零上下文)
4. **文档先行**: 策略文档先于代码实现(Design-first)

## 7.3 飞轮加速方向
- 从"债务偿还"转向"功能增值"(Option B)
- 从"单Session"转向"Sprint规划"(多Session目标对齐)
- 从"代码交付"转向"生产就绪"(Option C)

---

# 📝 八、版本变更日志

| 版本 | 时间 | 变更内容 |
|------|------|----------|
| v1.0 | S131 | 初始版 |
| v2.0 | S133 Final | **全面重构**: 基于v2.0资产清单重写; 新增多Agent并行模板; 新增飞轮旋转协议; 新增已知问题库; Memory Snapshot更新至S133完成态; 下一步Option A/B/C/D完整定义 |

---

*本文件由 S133 Session 最终生成。新对话读取此文件即可获得完整项目上下文。*
*Git HEAD: 7550925 | 总Commits: 106 | 债务偿还率: 60.7%*
