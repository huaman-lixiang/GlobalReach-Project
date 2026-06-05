# GlobalReach V2.0 企业级开发自执行协议 (Self-Execute Protocol)

> **协议版本**: Enterprise-v3.0-S036
> **基于范式**: Trae_IDE 范式进阶飞轮知识库架构 v1.0
> **前置报告**: [GLOBALREACH_S036_ENTERPRISE_AUDIT_REPORT_v1.0.md](./GLOBALREACH_S036_ENTERPRISE_AUDIT_REPORT_v1.0.md)
> **目标**: 从 45% Demo 状态 → 100% 企业级商业系统

---

## 无缝衔接指令

```
请读取并执行协议文件:
C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project\02-ENTERPRISE-REPORTS\GLOBALREACH_S036_SELF_EXECUTE_PROTOCOL_v3.0.md

按照协议第六节的 Trae_IDE 范式开发流程, 从 S037 开始继续飞轮旋转。

【项目当前状态】

- 最新Session: S036 (生产部署完成 + 全量企业级审计 + 注册功能修复)
- 飞轮位置: #1 连续零错误构建 (S036首次通过)
- 当前Phase: Phase A - 打通核心链路 (IN PROGRESS — D01-D05 待执行)
- 下一目标: S037 → D01 (数据库Schema设计与ORM集成)

【已完成模块】✅ S028-S036 共9个Session全部交付

- S028-S032: 后端基础架构 (Docker/API/DB/Nginx) ✅
- S033: React 18 Web管理界面 (7页面+Redux+AntD) ✅
- S034: 测试覆盖体系 (Vitest+Supertest+Playwright) ✅
- S035: 性能优化+生产部署准备 (Terser+PWA+Prometheus) ✅
- S036: 生产部署+注册修复+全量审计 ✅

⭐ 第一轮生产部署成功! 4容器全部运行!
⭐ 注册功能修复完成! (Register.tsx + 路由 + auth挂载)
⭐ 企业级审计完成! 发现25项缺失, 分P0/P1/P2三级

注: 完成后报告中继续输出项目状态报告和无缝衔接指令
```

---

## 一、当前系统状态快照

### 1.1 运行中的服务

| 服务 | 容器 | 状态 | 访问地址 |
|------|------|------|---------|
| API Gateway | globalreach-api-prod | Healthy | http://localhost:3000 |
| Frontend (Nginx) | globalreach-nginx-prod | Running | http://localhost |
| PostgreSQL 15 | globalreach-postgres | Healthy | localhost:5432 |
| Redis 7 | globalreach-redis | Healthy | localhost:6379 |

### 1.2 已验证的端点

```
✅ http://localhost → React SPA (GlobalReach V2.0 登录页)
✅ http://localhost/login → 登录表单 (可提交)
✅ http://localhost/register → 注册表单 (S036新建, 可用!)
✅ http://localhost:3000/api/health → {"status":"healthy","endpoints":25}
✅ http://localhost:3000/api/auth/login → POST 登录接口 (内存Map存储)
✅ http://localhost:3000/api/auth/register → POST 注册接口 (S036新挂载)
```

### 1.3 项目文件结构（关键路径）

```
GlobalReach-Project/
├── api/                          # 后端 Express API (~1500行)
│   ├── server.js                 # 入口 (72行) ✅ 已挂载auth路由
│   ├── routes/                   # 8个路由模块
│   │   ├── auth.js               # login/register/me (144行) ✅
│   │   ├── accounts.js           # 账号管理CRUD框架
│   │   ├── emails.js             # 邮件发送框架
│   │   ├── platforms.js          # 平台管理
│   │   ├── tenants.js            # 多租户
│   │   ├── stats.js              # 统计数据
│   │   ├── health.js             # 健康检查
│   │   └── metrics.js            # Prometheus指标
│   ├── middleware/                # 6个中间件
│   └── package.json              # 依赖含imapflow/nodemailer/xlsx
├── frontend/                     # 前端 React SPA (~2500行)
│   ├── src/
│   │   ├── pages/                # 7个页面 (Login/Register/Dashboard/...)
│   │   ├── store/slices/         # 4个Redux slices
│   │   ├── services/api.ts       # Axios实例
│   │   └── App.tsx               # 路由配置 (含/register)
│   └── dist/                     # 构建产物 (15 chunks)
├── src/modules/                  # 核心业务引擎 (~2000行) ⚠️ 未接入API!
│   ├── m7-multi-platform-manager/  # AccountPoolManager等
│   └── m8-platform-adapter-engine/ # PlatformFactory/GmailAdapter等
├── docker-compose.prod.yml       # 生产编排 (4服务)
├── Dockerfile                    # 多阶段Alpine构建
├── .env.production               # 生产环境变量
└── frontend-dist/                # Nginx静态文件目录
```

---

## 二、Phase A: 打通核心链路 (S037-S042)

> 目标: 让系统从"Demo"变成"可用MVP" — 用户能真正登录、管理账号、发送邮件

### Task D01: 数据库 Schema 设计与 ORM 集成 [8h] 🔴 P0

**目标**: 用 Sequelize 或 Prisma 替代内存Map，实现数据持久化

#### D01.1 技术选型
```yaml
推荐方案: Prisma (更现代, 类型安全, 更好的DX)
备选方案: Sequelize (社区更大, 文档更多)
选择标准: 团队TypeScript熟悉度 → 推荐 Prisma
```

#### D01.2 需要设计的表

```sql
-- 1. users 表 (用户认证)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'user',  -- admin/user/viewer
  is_email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. email_accounts 表 (邮箱账号池)
CREATE TABLE email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  platform VARCHAR(50) NOT NULL,     -- gmail/outlook/qq/163/custom_smtp
  email VARCHAR(255) NOT NULL,
  password_encrypted TEXT NOT NULL,
  imap_host VARCHAR(255),
  imap_port INTEGER,
  smtp_host VARCHAR(255),
  smtp_port INTEGER,
  encryption_type VARCHAR(20),      -- ssl/tls/starttls/none
  status VARCHAR(20) DEFAULT 'active',  -- active/restricted/banned/error
  daily_limit INTEGER DEFAULT 100,
  hourly_limit INTEGER DEFAULT 20,
  sent_today INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  health_score INTEGER DEFAULT 100,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. clients 表 (客户数据)
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  company VARCHAR(255),
  country VARCHAR(100),
  industry VARCHAR(100),
  status VARCHAR(20) DEFAULT 'prospect',
  tags TEXT[],
  custom_fields JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. campaigns 表 (营销活动)
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50),                 -- cold_warm/follow_up/newsletter
  status VARCHAR(20) DEFAULT 'draft',
  subject_template TEXT,
  body_template TEXT,
  target_segment JSONB,
  account_ids UUID[],
  schedule_config JSONB,
  stats JSONB,                      -- sent/opened/clicked/bounced
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. emails 表 (邮件记录)
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  client_id UUID REFERENCES clients(id),
  account_id UUID REFERENCES email_accounts(id),
  to_address VARCHAR(255) NOT NULL,
  from_address VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,
  status VARCHAR(20) DEFAULT 'pending',  -- pending/sent/delivered/bounced/failed
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  bounced_reason TEXT,
  error_message TEXT,
  provider_message_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. refresh_tokens 表 (JWT刷新令牌)
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

-- 7. audit_logs 表 (操作审计)
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(100),
  ip_address INET,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### D01.3 实施步骤

```
Step 1: 安装 Prisma (10min)
  npm install prisma @prisma/client
  npx prisma init

Step 2: 编写 schema.prisma (30min)
  定义上述7个表的Prisma Schema

Step 3: 生成迁移 (15min)
  npx prisma migrate dev --name init_schema

Step 4: 创建 seed 脚本 (20min)
  插入admin测试账号 + 示例邮箱账号 + 示例客户

Step 5: 重构 auth.js (40min)
  Map → Prisma.user.findUnique / create
  密码bcrypt比较逻辑保持不变

Step 6: 重构 accounts.js (30min)
  Map → Prisma.emailAccounts CRUD
  添加分页/排序/筛选

Step 7: Docker集成验证 (15min)
  确保容器内能连接PostgreSQL
  执行migrate deploy

验收标准:
□ Prisma schema定义完整 (7张表)
□ migration成功执行 (DB中有所有表)
□ seed数据插入成功 (可使用admin@globalreach.com登录)
□ login/register API 使用真实DB
□ TypeScript编译 0 错误
□ Docker容器健康运行
```

### Task D02: 核心业务引擎接入 API 层 [16h] 🔴 P0

**目标**: 将 M7/M8 引擎代码连接到 Express routes

#### D02.1 接入架构

```
当前状态:
  Route (accounts.js) → 直接返回mock数据
                    ↓ (断裂)
  M7 AccountPoolManager → 有完整实现但无人调用

目标状态:
  Route (accounts.js) → Service Layer → M7 AccountPoolManager
                                              ↓
                                    M8 PlatformFactory → GmailAdapter
```

#### D02.2 需要创建的 Service 层

```javascript
// api/services/accountService.js - 新建
const { AccountPoolManager } = require('../../src/modules/m7-multi-platform-manager/AccountPoolManager');
const poolManager = new AccountPoolManager();

module.exports = {
  // 列出所有账号 (带平台过滤/状态筛选)
  async listAccounts(filters) { ... },
  
  // 添加新账号 (自动检测平台类型)
  async addAccount(accountData) { ... },
  
  // 测试账号连接 (IMAP/SMTP连通性)
  async testConnection(accountId) { ... },
  
  // 获取最优账号 (智能选择算法)
  async selectBestAccount(criteria) { return poolManager.selectBest(criteria); },
  
  // 获取账号健康度
  async getHealthStatus() { ... }
};

// api/services/emailService.js - 新建
const { PlatformFactory } = require('../../src/modules/m8-platform-adapter-engine/PlatformFactory');

module.exports = {
  // 发送单封邮件
  async sendEmail(emailData) { ... },
  
  // 批量发送 (Campaign驱动)
  async sendBatch(campaignId, clientIds) { ... },
  
  // 获取发送队列状态
  async getQueueStatus() { ... }
};
```

#### D02.3 实施步骤

```
Step 1: 创建 Service 层骨架 (30min)
  api/services/accountService.js
  api/services/emailService.js

Step 2: 接入 AccountPoolManager (2h)
  验证import路径正确 (注意Docker内路径为/app/src/modules/)
  实现 listAccounts/addAccount/testConnection

Step 3: 接入 PlatformFactory (2h)
  验证GmailAdapter/OutlookAdapter可实例化
  实现 sendEmail 核心流程

Step 4: 重写 accounts route (2h)
  所有endpoint改为调用accountService
  添加正确的错误处理和响应格式

Step 5: 重写 emails route (2h)
  发送接口接入emailService
  添加发送状态查询

Step 6: 集成测试 (3h)
  端到端验证: 添加账号→选择账号→发送邮件→查看状态
  
Step 7: Docker重建验证 (1h)
  确保容器内M7/M8模块可正常加载

验收标准:
□ accounts CRUD 通过Service层调用M7引擎
□ email发送通过Service层调用M8适配器
□ 可以添加Gmail账号并测试连接
□ 可以选择账号并发送测试邮件
□ 发送记录可查询
□ TypeScript编译 0 错误 (如涉及TS文件)
```

### Task D03: 邮件发送管道完整实现 [12h] 🔴 P0

**目标**: 实现完整的邮件发送流水线

#### D03.1 发送管道架构

```
用户点击"发送" 
    ↓
Campaign Service (创建发送任务)
    ↓
Email Queue (Redis队列 / 内存队列)
    ↓
Worker (逐封处理)
    ├─ 选择最优账号 (M7 AccountPoolManager)
    ├─ 渲染邮件内容 (模板引擎)
    ├─ 调用平台适配器 (M8 GmailAdapter.send())
    ├─ 记录发送结果 (DB emails表)
    └─ 更新账号限额 (sent_today++)
    ↓
回调通知 (WebSocket/SSE → 前端实时更新进度)
```

#### D03.2 实施步骤

```
Step 1: 邮件模板引擎 (2h)
  使用 Handlebars/Nunjucks
  支持 {{client.name}}, {{company}} 等变量替换
  支持HTML富文本模板

Step 2: 发送队列实现 (3h)
  使用bull (Redis-backed queue) 或 内存队列
  支持优先级/重试/延迟发送
  并发控制 (避免单账号过载)

Step 3: Worker进程 (3h)
  消费队列任务
  调用emailService.sendEmail()
  错误处理与重试策略
  发送速率限制

Step 4: 进度通知 (2h)
  WebSocket或SSE推送发送进度
  前端实时显示发送百分比

Step 5: 发送结果处理 (2h)
  回调处理 (打开/点击追踪 - 如支持)
  退信处理 (bounced标记)
  统计更新 (campaign.stats)

验收标准:
□ 可以创建 Campaign 并选择收件人列表
□ 点击"发送"后进入队列
□ Worker自动消费并发送
□ 前端可看到实时发送进度
□ 发送完成后可查看详细报告
□ 退信自动标记客户状态
```

### Task D04: 数据库迁移脚本完善 [4h] 🔴 P0

**目标**: 确保 PostgreSQL 中有完整的表结构和初始数据

#### D04.1 实施步骤

```
Step 1: Prisma Migration 脚本 (1h)
  npx prisma migrate dev --name full_schema
  包含所有7张表 + 索引 + 外键约束

Step 2: Seed 数据脚本 (1.5h)
  admin用户: admin@globalreach.com / Admin123456
  3个示例邮箱账号 (gmail/outlook/qq)
  20个示例客户 (多国分布)
  1个示例Campaign

Step 3: Docker迁移自动化 (1h)
  Dockerfile中添加 prisma migrate deploy
  或 docker-compose entrypoint脚本
  确保容器启动时自动执行migration

Step 4: 验证 (0.5h)
  docker exec 进入容器检查表结构
  验证seed数据存在

验收标准:
□ docker compose up 后 DB 自动建表
□ seed数据自动注入
□ admin账号可直接登录使用
```

### Task D05: 认证安全增强 [6h] 🔴 P0

**目标**: JWT refresh token + RBAC 权限控制

#### D05.1 实施步骤

```
Step 1: Refresh Token机制 (2h)
  login时同时返回 access_token + refresh_token
  refresh_token存入DB (refresh_tokens表)
  /api/auth/refresh 端点换取新access_token
  /api/auth/logout 吊销token

Step 2: RBAC权限中间件 (2h)
  middleware/rbac.js - 新建
  角色定义: admin(全部) / user(自己的数据) / viewer(只读)
  路由级别权限声明
  自动检查user.role

Step 3: 密码重置流程 (2h)
  /api/auth/forgot-password 发送重置链接
  /api/auth/reset-password 接受新密码
  reset token 有效期24h

验收标准:
□ 登录返回双token
□ token即将过期时可刷新
□ logout后token立即失效
□ admin/user角色权限隔离
□ 忘记密码可自助重置
```

---

## 三、Phase B: 功能完善 (S043-S050)

> 目标: MVP → 功能完整产品

### Task D06: 前端页面功能填充 [20h]

每个页面需要完成的子任务:

**Dashboard (4h)**:
- [ ] 真实API数据绑定 (statsSlice → /api/stats)
- [ ] 今日发送量/打开率/点击率卡片
- [ ] 最近活动列表
- [ ] 账号健康度仪表盘
- [ ] 图表数据动态加载 (Recharts + API)

**Accounts (4h)**:
- [ ] 账号列表 (真实CRUD)
- [ ] 添加账号弹窗 (平台类型选择 → 差异化配置表单)
- [ ] 测试连接按钮 (调用testConnection API)
- [ ] 账号详情页 (发送历史/健康度曲线)
- [ ] 批量操作 (启用/禁用/删除)

**Campaigns (4h)**:
- [ ] 活动列表 (状态筛选/搜索)
- [ ] 创建活动向导 (4步: 基本信息 → 选择收件人 → 编辑邮件 → 确认发送)
- [ ] 邮件编辑器 (富文本/模板选择/变量插入)
- [ ] 收件人选择器 (按标签/国家/状态筛选)
- [ ] 活动详情 (发送进度/效果统计)

**Reports (4h)**:
- [ ] 发送报表 (按时间/账号/活动维度)
- [ ] 打开率/点击率趋势图
- [ ] A/B测试对比视图
- [ ] 导出CSV/PDF
- [ ] 客户活跃度分析

**Settings (4h)**:
- [ ] 个人资料编辑
- [ ] 修改密码
- [ ] API密钥管理
- [ ] 系统偏好设置 (语言/主题/通知)
- [ ] 操作日志查看

### Task D07-D14: 安全加固 (详见审计报告)

---

## 四、Phase C: 生产就绪 (S051-S058)

> 目标: 产品 → 企业级系统

### Task D15-D25: 监控/文档/性能 (详见审计报告)

---

## 五、质量门禁标准

每个 Task 完成后必须通过:

```yaml
质量门禁:
  TypeScript:
    - 前端: `npx tsc --noEmit` → 0 errors
    - 如新增TS文件需确保strict模式
  
  测试:
    - 单元测试: 新增代码覆盖率 ≥ 80%
    - 集成测试: 关键API endpoint必须有测试
    - E2E测试: 核心用户流程必须覆盖
  
  构建:
    - `npm run build` 成功
    - Docker build 成功
    - 容器启动健康检查通过
  
  安全:
    - 无硬编码密码/密钥
    - 输入验证完整
    - SQL注入/XSS防护到位
  
  文档:
    - 新增API端点需Swagger注释
    - 复杂业务逻辑需注释说明
```

---

## 六、Trae_IDE 范式开发流程

### Session 启动 SOP

每次开始新Session时:

```
1. 读取本协议文件 (SELF_EXECUTE_PROTOCOL)
2. 读取最新状态报告 (AUDIT_REPORT)
3. 确认Docker环境就绪 (docker ps)
4. 确认当前Task编号和状态
5. 执行TS编译检查
6. 开始当日Task开发
7. 完成后更新状态报告
8. 输出无缝衔接指令给下一个Session
```

### 飞轮旋转规则

```
每次Session结束时必须产出:
  ✅ 至少1个 Task 的实质性进展 (不是仅调研)
  ✅ 代码变更通过质量门禁
  ✅ 更新 SESSION_LOG
  ✅ 更新 STATUS_REPORT (如有里程碑)
  ✅ 输出无缝衔接指令 (包含精确的下一步Task)
  
禁止行为:
  ❌ 仅做调研不写代码
  ❌ 代码未通过质量门禁就结束
  ❌ 不输出衔接指令就结束
  ❌ 跳过质量门禁
```

---

## 七、下一步行动 (S037)

```
╔════════════════════════════════════════════════════╗
║                                                    ║
║   🎯 S037 首要任务: D01 数据库持久化              ║
║                                                    ║
║   Step 1: 安装 Prisma                             ║
║   Step 2: 编写 schema.prisma (7张表)              ║
║   Step 3: 生成 migration + seed                   ║
║   Step 4: 重构 auth.js (Map → Prisma)            ║
║   Step 5: Docker验证                              ║
║                                                    ║
║   预估时间: 8小时                                  ║
║   验收标准: 能用真实DB登录注册                      ║
║                                                    ║
╚════════════════════════════════════════════════════╝
```

---

**协议版本**: v3.0-FINAL
**生成时间**: 2026-06-03 (S036 Session)
**适用范围**: S037及后续所有Session
**下次更新**: D01 完成后 (S037 结束时)
