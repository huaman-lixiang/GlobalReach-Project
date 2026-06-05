# GlobalReach V2.0 常见问题解答 (FAQ)

> **版本**: V2.0 | **最后更新**: 2026-06-05 | **适用环境**: Docker Compose (8 服务)
>
> 本文档面向刚加入 GlobalReach 项目的新成员，涵盖从快速上手到运维排障的完整知识体系。

---

## 目录

- [一、快速入门 (Q1–Q5)](#一快速入门-q1--q5)
- [二、架构与设计 (Q6–Q10)](#二架构与设计-q6--q10)
- [三、认证与用户管理 (Q11–Q15)](#三认证与用户管理-q11--q15)
- [四、运维与维护 (Q16–Q20)](#四运维与维护-q16--q20)
- [五、监控与排障 (Q21–Q25)](#五监控与排障-q21--q25)
- [六、部署与 CI/CD (Q26–Q28)](#六部署与-cicd-q26--q28)

---

## 一、快速入门 (Q1–Q5)

### Q1: GlobalReach V2.0 是什么？它能做什么？

**A:** GlobalReach V2.0 是一套**企业级邮件营销平台**，基于 Docker Compose 编排运行，包含 8 个微服务容器。核心能力包括：

| 能力模块 | 说明 |
|---------|------|
| 用户注册/登录 | JWT 认证体系，支持多角色权限 |
| 邮件营销活动 | 创建、管理和追踪邮件营销活动 |
| 客户数据管理 | 按邮箱账户分组的客户画像系统 |
| 系统监控 | Prometheus + Grafana 全栈可观测性 |
| 自动化部署 | GitHub Actions 5 阶段 CI/CD 流水线 |

**UAT 测试结果**: 17/20 PASS, 0 BLOCKED（2 FAIL 为测试方法问题，非产品缺陷）。

---

### Q2: 运行 GlobalReach 需要什么系统要求？

**A:** 最低硬件要求如下：

| 资源项 | 最低要求 | 推荐配置 |
|-------|---------|---------|
| CPU | 2 核 | 4 核+ |
| 内存 | 2 GB RAM | 4 GB RAM |
| 磁盘空间 | 10 GB 可用空间 | 30 GB+（含日志和数据增长） |
| 操作系统 | Linux (Ubuntu 20.04+) / macOS / Windows (Docker Desktop) | Ubuntu 22.04 LTS |
| Docker | >= 20.10 | 最新稳定版 |
| Docker Compose | >= 2.0 (V2 插件) | 最新版 |

软件依赖：

```bash
# 检查 Docker 版本
docker --version
# 期望输出: Docker version 24.x.x

# 检查 Compose 版本
docker compose version
# 期望输出: Docker Compose version v2.x.x
```

---

### Q3: 如何首次启动系统？

**A:** 按以下步骤操作：

```bash
# 1. 克隆项目仓库
git clone <repo-url> globalreach-project
cd globalreach-project

# 2. 复制并编辑环境变量文件
cp .env.example .env
# 编辑 .env 文件，修改以下关键值：
#   - JWT_SECRET          → 至少32字符的随机字符串
#   - DB_PASSWORD         → 数据库密码
#   - CORS_ORIGIN         → 你的域名（开发时可用 *）

# 3. 创建外部网络（生产 compose 需要）
docker network create globalreach-project_globalreach-network

# 4. 启动所有服务（使用生产配置，包含全部8个容器）
docker compose -f docker-compose.prod.yml up -d

# 5. 等待服务就绪后验证健康状态
sleep 30
curl http://localhost:3000/api/v1/health
```

首次启动预期输出：

```json
{
  "status": "healthy",
  "uptime": 45.2,
  "healthScore": 100,
  "subsystems": {
    "database": "healthy",
    "redis": "healthy",
    "api": "healthy"
  }
}
```

> **提示**: 如果使用开发环境（仅 API + Nginx），用 `docker compose up -d` 即可。

---

### Q4: 启动后如何访问各个服务？

**A:** 各服务的访问地址汇总：

| 服务 | 容器名 | 内部端口 | 外部端口 | 访问地址 | 默认凭据 |
|------|--------|---------|---------|---------|---------|
| **API Server** | `globalreach-api-prod` | 3000 | 3000 | `http://localhost:3000` | — |
| **Nginx (反向代理)** | `globalreach-nginx-prod` | 80/443 | 80/443 | `http://localhost` / `https://localhost` | — |
| **PostgreSQL** | `globalreach-postgres` | 5432 | *仅内部* | 宿主机不暴露 | `globalreach_user` / `.env` 中密码 |
| **Redis** | `globalreach-redis` | 6379 | *仅内部* | 宿主机不暴露 | 无密码（内网） |
| **Prometheus** | `globalreach-prometheus` | 9090 | 9090 | `http://localhost:9090` | 无需登录 |
| **Grafana** | `globalreach-grafana` | 3000 | 3002 | `http://localhost:3002` | **admin / admin** |
| **Node Exporter** | `globalreach-node-exporter` | 9100 | *仅内部* | 由 Prometheus 抓取 | — |
| **PostgreSQL Exporter** | `globalreach-pg-exporter` | 9187 | *仅内部* | 由 Prometheus 抓取 | — |

> **安全提醒**: PostgreSQL 和 Redis 在生产环境中仅通过 Docker 内部网络暴露，不映射到宿主机端口。如需调试，可临时添加端口映射。

---

### Q5: 默认管理员账户是什么？

**A:** GlobalReach **没有预置默认管理员账户**。管理员需要通过以下方式创建：

**方法一：通过注册接口创建第一个用户**

```bash
# 注册第一个用户（自动成为管理员）
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourcompany.com",
    "password": "YourSecurePassword123!",
    "name": "System Admin",
    "role": "admin"
  }'
# 期望返回: 201 Created
```

**方法二：直接操作数据库（适用于丢失访问权限的情况）**

详见 [Q14](#q14-如果丢失了管理员访问权限如何重新创建-admin-用户)。

---

## 二、架构与设计 (Q6–Q10)

### Q6: GlobalReach 使用了哪些技术栈？

**A:** 完整技术栈一览：

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **运行时** | Node.js | 20 LTS (Alpine) | API 服务端运行环境 |
| **Web 框架** | Express.js | 4.x | HTTP 路由和中间件 |
| **ORM** | Sequelize | 6.x | PostgreSQL 数据库操作 |
| **数据库** | PostgreSQL | 15 Alpine | 主数据存储 |
| **缓存** | Redis | 7 Alpine | 会话缓存、限流计数器 |
| **反向代理** | Nginx | Alpine | SSL 终结、负载均衡、静态资源 |
| **监控采集** | Prometheus | Latest | 时序指标收集 |
| **可视化** | Grafana | Latest | 监控仪表盘 |
| **主机指标** | Node Exporter | Latest | 服务器级 CPU/内存/磁盘指标 |
| **DB 指标** | PostgreSQL Exporter | Latest | 数据库连接数、查询性能等 |
| **容器编排** | Docker Compose | V2 | 多容器生命周期管理 |
| **CI/CD** | GitHub Actions | — | 5 阶段自动化流水线 |
| **认证** | JWT (jsonwebtoken) | — | 无状态令牌认证 |
| **密码加密** | bcrypt | rounds=10 | 密码哈希 |

**关键优化参数：**

```javascript
// V8 引擎堆内存限制
NODE_OPTIONS: --max-old-space-size=384   // 生产环境 384MB

// 数据库连接池
{ max: 10, min: 2 }                       // 最大10个，最小2个空闲连接

// bcrypt 加密轮次
const SALT_ROUNDS = 10;                    // 从12降到10，修复DEFECT-001超时问题

// 定期垃圾回收
setInterval(() => global.gc?.(), 60_000); // 每60秒触发一次GC
```

---

### Q7: 为什么选择 Docker Compose 而不是 Kubernetes？

**A:** 选择 Docker Compose 的核心原因：

| 对比维度 | Docker Compose | Kubernetes |
|---------|---------------|------------|
| **学习曲线** | 低，一个 YAML 文件搞定 | 高，需要掌握 Pod/Service/Deployment 等概念 |
| **运维复杂度** | 单机即可运行 | 需要 Master + Worker 节点集群 |
| **适合规模** | 单机/小团队 (1–8 个服务) | 大规模微服务 (50+ 服务) |
| **启动时间** | 秒级 | 分钟级 |
| **资源开销** | 几乎无额外开销 | 需要额外运行 K8s 组件 |
| **GlobalReach 匹配度** | ✅ 8 个服务，单机完全够用 | ❌ 过度工程化 |

**何时考虑迁移到 K8s：**
- 服务数量超过 20 个
- 需要多节点高可用（HA）
- 需要自动扩缩容（HPA）
- 团队已有成熟的 K8s 运维能力

当前阶段，Docker Compose + GitHub Actions Deploy job 的方案已经满足企业级需求。

---

### Q8: 8 个容器是如何组织的？各自负责什么？

**A:** 架构拓扑图：

```
┌─────────────────────────────────────────────────────┐
│                   Internet / Browser                 │
└──────────────────────┬──────────────────────────────┘
                       │  :80 / :443
                       ▼
              ┌─────────────────┐
              │     nginx       │ ← 反向代理、SSL终结、静态文件
              │   (alpine)      │
              └────────┬────────┘
                       │  :3000 (proxy_pass)
                       ▼
              ┌─────────────────┐
              │       api       │ ← Node.js 20 核心业务逻辑
              │  (node:20-alpine│
              └──┬──────────┬───┘
                 │          │
        ┌────────┘          └────────┐
        ▼                            ▼
┌───────────────┐           ┌───────────────┐
│   postgres    │           │     redis      │
│  (15-alpine)  │           │   (7-alpine)   │
│ 主数据持久化   │           │ 缓存/会话/限流  │
└───────────────┘           └───────────────┘

┌─────────────────────────────────────────────────┐
│               可观测性层 (Monitoring)             │
│                                                   │
│  ┌────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ prometheus  │◄─│ node-exporter│  │ pg-exporter│ │
│  │  (:9090)    │  │  (主机指标)   │  │ (DB指标)   │ │
│  └──────┬──────┘  └──────────────┘  └───────────┘ │
│         │                                         │
│         ▼                                         │
│  ┌────────────┐                                   │
│  │   grafana   │  ← 仪表盘展示 (:3002)            │
│  └────────────┘                                   │
└─────────────────────────────────────────────────┘
```

各容器详细说明：

| # | 容器 | 基础镜像 | 内存限制 | 核心职责 |
|---|------|---------|---------|---------|
| 1 | **api** | `node:20-alpine` | 512MB (上限) | REST API、业务逻辑、JWT 签发 |
| 2 | **postgres** | `postgres:15-alpine` | 默认 | 用户表、活动表、客户数据持久化 |
| 3 | **redis** | `redis:7-alpine` | 默认 | Token 缓存、Rate Limiting 计数器 |
| 4 | **nginx** | `nginx:alpine` | 128MB | 反向代理、HTTPS、静态资源托管 |
| 5 | **prometheus** | `prom/prometheus:latest` | 默认 | 指标采集和存储 (TSDB) |
| 6 | **grafana** | `grafana/grafana:latest` | 默认 | 可视化仪表盘和告警 |
| 7 | **node-exporter** | `prom/node-exporter:latest` | 128MB | 服务器 CPU/内存/磁盘/网络指标 |
| 8 | **postgres-exporter** | `prometheuscommunity/postgres-exporter:latest` | 128MB | PG 连接数、查询耗时等 DB 级指标 |

---

### Q9: 从浏览器发起请求到数据返回，完整的请求流是怎样的？

**A:** 典型请求的生命周期：

```
浏览器 (Chrome/Firefox)
  │
  │  ① HTTPS 请求 (GET /api/v1/campaigns)
  │  Header: Authorization: Bearer <jwt_token>
  │
  ▼
Nginx (反向代理层)
  │
  │  ② SSL 解密 → 路由匹配 → proxy_pass 到上游
  │  配置位置: ./nginx/conf.d/default.conf
  │
  ▼
API Server (Express.js, :3000)
  │
  │  ③ 中间件链依次执行:
  │     a) Helmet (安全头)
  │     b) CORS (跨域检查)
  │     c) express.json() (请求体解析)
  │     d) Rate Limiter (Redis 限流检查)
  │     e) JWT Auth Middleware (令牌验证)
  │     f) validateRequest (请求校验)
  │     g) Route Handler (业务处理)
  │
  ▼
Service Layer (Sequelize ORM)
  │
  │  ④ 数据库操作:
  │     - 从连接池获取连接 (pool.acquire)
  │     - 执行 SQL 查询
  │     - 归还连接到池中 (pool.release)
  │
  ▼
PostgreSQL (:5432)
  │
  │  ⑤ 返回查询结果集
  │
  ▼
[原路返回] → API 组装 JSON Response → Nginx → 浏览器
```

**关键路径代码示例：**

```javascript
// auth middleware 示例 — 验证 JWT 并附加 user 信息
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) return res.status(401).json({ error: 'TOKEN_MISSING' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'TOKEN_INVALID' });
    req.user = user;       // 将解码后的用户信息挂载到 req 上
    next();                // 放行到下一个中间件/路由处理器
  });
};
```

---

### Q10: 数据模型是什么样的？有哪些核心表？

**A:** 基于 Sequelize ORM 的核心数据表：

```
┌────────────────────────────────────────────────────────────┐
│                    globalreach_prod 数据库                  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │                    users 表                        │      │
│  ├──────────────────────────────────────────────────┤      │
│  │  id          INTEGER  PK  AUTO_INCREMENT           │      │
│  │  email       VARCHAR(255)  UNIQUE  NOT NULL        │      │
│  │  password    VARCHAR(255)  NOT NULL  (bcrypt哈希)  │      │
│  │  name        VARCHAR(100)                           │      │
│  │  role        ENUM('admin','user','viewer')          │      │
│  │  isActive    BOOLEAN  DEFAULT true  ★ L04修复新增   │      │
│  │  createdAt   TIMESTAMP                             │      │
│  │  updatedAt   TIMESTAMP                             │      │
│  └──────────────────────────────────────────────────┘      │
│                         │                                  │
│                         │ 1:N                              │
│                         ▼                                  │
│  ┌──────────────────────────────────────────────────┐      │
│  │                 campaigns 表                      │      │
│  ├──────────────────────────────────────────────────┤      │
│  │  id          INTEGER  PK                          │      │
│  │  userId      INTEGER  FK → users.id               │      │
│  │  name        VARCHAR(200)  NOT NULL                │      │
│  │  subject     VARCHAR(500)                          │      │
│  │  status      ENUM('draft','active','paused','done')│      │
│  │  sentCount   INTEGER  DEFAULT 0                    │      │
│  │  openRate    DECIMAL(5,2)                          │      │
│  │  clickRate   DECIMAL(5,2)                          │      │
│  └──────────────────────────────────────────────────┘      │
│                                                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │                 clients 表                        │      │
│  ├──────────────────────────────────────────────────┤      │
│  │  id          INTEGER  PK                          │      │
│  │  email       VARCHAR(255)  UNIQUE                 │      │
│  │  fullName    VARCHAR(200)                         │      │
│  │  company     VARCHAR(200)                         │      │
│  │  accountId   VARCHAR(50)  → 归属邮箱账户分组       │      │
│  │  tags        JSONB                                │      │
│  │  isSubscribed BOOLEAN DEFAULT true                │      │
│  └──────────────────────────────────────────────────┘      │
│                                                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │              email_logs 表 (发送记录)              │      │
│  ├──────────────────────────────────────────────────┤      │
│  │  id          INTEGER  PK                          │      │
│  │  campaignId  INTEGER  FK → campaigns.id            │      │
│  │  clientId    INTEGER  FK → clients.id              │      │
│  │  status      ENUM('sent','bounced','opened')       │      │
│  │  sentAt      TIMESTAMP                            │      │
│  │  openedAt    TIMESTAMP  (nullable)                 │      │
│  └──────────────────────────────────────────────────┘      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**数据库连接信息：**
- 数据库名: `globalreach_prod`
- 用户名: `globalreach_user`
- 连接池配置: `max: 10, min: 2, acquire: 30000, idle: 10000`

---

## 三、认证与用户管理 (Q11–Q15)

### Q11: 认证流程是怎样的？JWT 是怎么工作的？

**A:** GlobalReach 采用标准的 **JWT (JSON Web Token)** 无状态认证机制。

#### 完整认证时序图

```
客户端                              API Server              PostgreSQL
  │                                    │                       │
  │  ① POST /api/v1/auth/register      │                       │
  │  { email, password, name, role }   │                       │
  │ ─────────────────────────────────► │                       │
  │                                    │  bcrypt.hash(password, │
  │                                    │  rounds=10)           │
  │                                    │ ─────────────────────►│
  │                                    │ ◄─────────────────────│
  │                                    │  写入 users 表         │
  │ ◄───────────────────────────────── │ 201 { userId, email } │
  │                                    │                       │
  │  ② POST /api/v1/auth/login         │                       │
  │  { email, password }               │                       │
  │ ─────────────────────────────────► │                       │
  │                                    │  查询 user +           │
  │                                    │  bcrypt.compare()      │
  │                                    │ ─────────────────────►│
  │                                    │ ◄─────────────────────│
  │                                    │  验证 isActive === true│
  │                                    │  jwt.sign({userId,     │
  │                                    │  role, email}, SECRET) │
  │ ◄───────────────────────────────── │ 200 { token, user }   │
  │  存储 token (localStorage)          │                       │
  │                                    │                       │
  │  ③ GET /api/v1/auth/me             │                       │
  │  Header: Bearer <jwt_token>        │                       │
  │ ─────────────────────────────────► │                       │
  │                                    │  jwt.verify(token)    │
  │                                    │  解析出 userId, role   │
  │ ◄───────────────────────────────── │ 200 { user profile }  │
  │                                    │                       │
```

#### 关键代码示例

```javascript
// 登录成功后签发 JWT
const loginHandler = async (req, res) => {
  const { email, password } = req.body;

  // 1. 查找用户
  const user = await User.findOne({ where: { email } });
  if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

  // 2. 校验密码 (bcrypt.compare ~ 10 rounds)
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

  // 3. 检查账号是否启用 (L04 修复后的逻辑)
  if (user.isActive === false) {
    return res.status(403).json({ error: 'ACCOUNT_DISABLED' });
  }

  // 4. 签发 JWT Token
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
};

// 后续请求携带 Token 的示例
// GET /api/v1/auth/me
// Headers:
//   Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**JWT 配置摘要：**

| 参数 | 值 | 说明 |
|-----|---|------|
| 签名算法 | HS256 | HMAC-SHA256 |
| 有效期 | 24h (可配置) | 通过 `JWT_EXPIRES_IN` 环境变量控制 |
| 存储位置 | 客户端 localStorage | HttpOnly Cookie 为可选增强方案 |
| 传输方式 | Header: `Authorization: Bearer <token>` | 标准 Bearer 规范 |

---

### Q12: 注册/登录为什么会超时？（关联 DEFECT-001）

**A:** 这是一个**真实发生过的严重 Bug**，编号 **DEFECT-001**，已在会话 **S084** 中修复。

#### 问题根因

`validateRequest` 中间件被设计为**工厂函数 (Factory Function)**，但在路由注册时被当作**普通中间件函数**直接使用了。导致调用 `req.map()` 时，`req` 是一个原生 Express Request 对象（没有 `.map()` 方法），但错误被静默吞没或导致事件循环阻塞，最终表现为**请求无限挂起直至超时**。

```javascript
// ❌ 错误用法 (触发 DEFECT-001)
// validateRequest 是工厂函数，需要先调用返回中间件
app.post('/register', validateRequest, registerHandler);
//                     ↑ 这里直接传了工厂函数本身！
//                     → 内部调用 req.map() → req 没有 .map() 方法
//                     → 请求永远挂住 → 客户端超时

// ✅ 正确用法 (S084 修复后)
app.post('/register', validateRequest(registerSchema), registerHandler);
//                               ↑ 先调用工厂，传入 schema，返回真正的中间件函数
```

#### DEFECT-001 时间线

| 阶段 | 说明 |
|------|------|
| **发现** | UAT 测试期间，注册接口偶尔超时 (>30s)，无响应 |
| **定位** | 排查发现 bcrypt rounds=12 导致单次哈希耗时较长，叠加中间件误用加剧问题 |
| **修复动作 1** | bcrypt rounds 从 12 降至 **10**（减少约 40% 哈希耗时） |
| **修复动作 2** | 将 `validateRequest` 从直接引用改为工厂调用模式 |
| **修复会话** | S084 |
| **验证状态** | ✅ 已修复，回归测试通过 |

#### 经验教训

- 工厂模式的中间件**必须先调用再传入路由**，不能直接传函数引用
- bcrypt 轮次的选择需要在**安全性 vs 性能**之间权衡：
  - rounds=12: 更安全但慢 (~500ms/次)
  - rounds=10: 平衡选择 (~250ms/次) ← 当前值
  - rounds=8: 快但不推荐用于生产

---

### Q13: 为什么登录返回 403 ACCOUNT_DISABLED？（关联 L04）

**A:** 这是另一个**真实 Bug**，编号 **L04**，已在会话 **S085** 中修复。

#### 问题根因

User 模型（Sequelize Model）最初**缺少 `isActive` 字段定义**。当登录逻辑执行到账号启用状态检查时：

```javascript
// ❌ L04 修复前的代码
if (user.isActive === false) {   // user.isActive 是 undefined!
  return res.status(403).json({ error: 'ACCOUNT_DISABLED' });
}

// JavaScript 类型转换陷阱:
// undefined === false  → false   (所以正常用户能通过 ✓)
// 但某些场景下 undefined 被隐式转换为 falsy，
// 导致所有用户都收到 403 ACCOUNT_DISABLED ✗
```

由于 `undefined === false` 在 JS 中严格等于 `false`，理论上不应该拦截。但在 Sequelize 查询结果的某些边界情况下（如 `SELECT` 不包含该列、或字段映射异常），会导致非预期的 falsy 判断，使**合法用户也被拒绝登录**。

#### 修复方案 (S085)

```sql
-- Step 1: 给 users 表增加 isActive 列
ALTER TABLE users ADD COLUMN "isActive" BOOLEAN DEFAULT true;

-- Step 2: 确保 Sequelize Model 同步
-- 在代码中使用 sync({ alter: true }) 让 ORM 自动同步表结构
```

```javascript
// ✅ S085 修复后的 User 模型
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING(255), unique: true, allowNull: false },
  password: { type: DataTypes.STRING(255), allowNull: false },
  name: { type: DataTypes.STRING(100) },
  role: { type: DataTypes.ENUM('admin', 'user', 'viewer'), defaultValue: 'user' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },  // ★ 新增字段
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// 首次部署或迁移时执行同步
await User.sync({ alter: true });  // 自动将模型变更同步到数据库
```

#### L04 时间线

| 阶段 | 说明 |
|------|------|
| **现象** | 部分用户登录始终返回 `403 {"error": "ACCOUNT_DISABLED"}` |
| **根因** | User 模型缺少 `isActive` 字段定义，DB 也没有对应列 |
| **影响范围** | 所有经过登录态检查的接口 |
| **修复会话** | S085 |
| **修复内容** | Model 新增 `isActive` 字段 + `sync({ alter: true })` 同步 |
| **验证状态** | ✅ 已修复 |

---

### Q14: 如果丢失了管理员访问权限，如何重新创建 admin 用户？

**A:** 有两种恢复方式：

#### 方式一：通过 API 注册新管理员（推荐）

```bash
# 直接调用注册接口，指定 role 为 admin
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "new-admin@company.com",
    "password": "NewAdminPass456!",
    "name": "Recovery Admin",
    "role": "admin"
  }'
```

> ⚠️ 如果注册接口也需要认证才能调用（取决于你的版本），请使用方式二。

#### 方式二：直接操作 PostgreSQL 数据库

```bash
# 1. 进入 postgres 容器
docker exec -it globalreach-postgres psql -U globalreach_user -d globalreach_prod

# 2. 插入新的管理员记录（密码需要 bcrypt 哈希）
-- 先在 API 容器中生成密码哈希:
docker exec -it globalreach-api-prod node -e "
  const bcrypt = require('bcrypt');
  bcrypt.hash('YourNewAdminPassword123!', 10).then(h => console.log(h));
"

# 3. 将输出的哈希值填入下面的 SQL:
INSERT INTO users (email, password, name, role, "isActive", "createdAt", "updatedAt")
VALUES (
  'recovery-admin@company.com',
  '$2b$10$<上面生成的bcrypt哈希值>',
  'Recovery Admin',
  'admin',
  true,
  NOW(),
  NOW()
);

# 4. 验证插入结果
SELECT id, email, role, "isActive" FROM users WHERE role = 'admin';

# 5. 退出
\q
```

然后用新账户登录获取 JWT：

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "recovery-admin@company.com", "password": "YourNewAdminPassword123!"}'
```

---

### Q15: 密码规则是如何工作的？有什么要求？

**A:** GlobalReach 的密码策略在 API 层实现：

| 规则 | 要求 | 示例 |
|------|------|------|
| 最小长度 | ≥ 8 个字符 | `Passw0rd!` |
| 最大长度 | ≤ 128 个字符 | — |
| 复杂度 | 必须包含大小写字母 + 数字 | `MySecur3Pwd` |
| 特殊字符 | 推荐 but 非强制 | `P@ssw0rd!` |
| 哈希算法 | bcrypt (salt rounds = 10) | 不可逆，每次生成不同 salt |
| 存储 | 仅存哈希值，**绝不存明文** | `$2b$10$N9qo8uLOick...` |

```javascript
// 密码校验中间件示例
const validatePassword = (password) => {
  const errors = [];
  if (password.length < 8) errors.push('密码至少8个字符');
  if (password.length > 128) errors.push('密码最多128个字符');
  if (!/[A-Z]/.test(password)) errors.push('必须包含大写字母');
  if (!/[a-z]/.test(password)) errors.push('必须包含小写字母');
  if (!/[0-9]/.test(password)) errors.push('必须包含数字');
  return errors;
};

// 注册时的密码处理
const hashedPassword = await bcrypt.hash(password, 10); // rounds=10
// 存入数据库的是 hashedPassword，不是明文
```

---

## 四、运维与维护 (Q16–Q20)

### Q16: 如何检查所有服务是否正常运行？

**A:** 使用以下命令组合进行全方位检查：

```bash
# ════════════════════════════════════════
# 1. 查看所有容器状态（最常用）
# ════════════════════════════════════════
docker compose -f docker-compose.prod.yml ps
# 期望输出: 全部 Up (healthy)

# ════════════════════════════════════════
# 2. 查看 API 健康检查详情
# ════════════════════════════════════════
curl -s http://localhost:3000/api/v1/health | python3 -m json.tool

# 返回结构:
{
  "status": "healthy",        // overall: healthy / degraded / unhealthy
  "uptime": 86400.5,          // 运行时长（秒）
  "healthScore": 100,         // 健康评分 0-100
  "timestamp": "2026-06-05T...",
  "subsystems": {
    "database": "healthy",    // PostgreSQL 连接状态
    "redis": "healthy",       // Redis 连接状态
    "memory": "healthy"       // V8 堆内存使用情况
  }
}

# ════════════════════════════════════════
# 3. 检查 Docker 网络连通性
# ════════════════════════════════════════
# 从 API 容器内部测试数据库连通性
docker exec globalreach-api-prod curl -s http://postgres:5432 || echo "PG unreachable"
docker exec globalreach-api-prod redis-cli -h redis ping
# 期望输出: PONG

# ════════════════════════════════════════
# 4. 一键全量健康检查脚本
# ════════════════════════════════════════
for svc in api postgres redis nginx prometheus grafana; do
  echo -n "$svc: "
  docker inspect --format='{{.State.Health.Status}}' "globalreach-${svc}-prod" 2>/dev/null || echo "no healthcheck"
done
```

**各状态的含义：**

| 状态 | 含义 | 应对措施 |
|------|------|---------|
| `healthy` | 健康检查连续通过 | ✅ 正常 |
| `unhealthy` | 健康检查连续失败 | 🔴 查看日志排查 |
| `starting` | 容器正在启动中 | ⏳ 等待 start_period 结束 |
| `(none)` | 未配置 healthcheck | ℹ️ 该服务无需健康检查 (如 node-exporter) |

---

### Q17: 如何查看特定服务的日志？

**A:** 日志查看命令速查：

```bash
# ════════════════════════════════════════
# 基础用法 — 查看某个服务的实时日志
# ════════════════════════════════════════

# API 服务日志（最常用）
docker logs -f globalreach-api-prod --tail 100

# Nginx 访问/错误日志
docker logs -f globalreach-nginx-prod --tail 50

# PostgreSQL 日志
docker logs -f globalreach-postgres --tail 50

# Redis 日志
docker logs -f globalreach-redis --tail 30

# Prometheus 日志
docker logs -f globalreach-prometheus --tail 30

# Grafana 日志
docker logs -f globalreach-grafana --tail 30

# ════════════════════════════════════════
# 高级用法 — 过滤和时间范围
# ════════════════════════════════════════

# 只看最近 10 分钟的 API 错误日志
docker logs --since 10m globalreach-api-prod 2>&1 | grep -i "error\|fail\|exception"

# 查看特定时间段的日志（从某时刻到现在）
docker logs --since "2026-06-05T09:00:00" globalreach-api-prod

# 导出最近 1000 行日志到文件
docker logs --tail 1000 globalreach-api-prod > /tmp/api-debug.log

# ════════════════════════════════════════
# Compose 方式 — 同时查看多个服务
# ════════════════════════════════════════
docker compose -f docker-compose.prod.yml logs -f --tail=50 api postgres redis
```

**日志配置说明（来自 docker-compose.prod.yml）：**

| 服务 | 驱动 | 单文件上限 | 最大文件数 | 总占用上限 |
|------|------|-----------|-----------|-----------|
| api | json-file | 10 MB | 3 | **30 MB** |
| nginx | json-file | 5 MB | 2 | **10 MB** |
| 其他 | 默认 | — | — | — |

> 当单个日志文件达到上限时，Docker 会自动轮转（rotate）。

---

### Q18: 如何执行数据备份？

**A:** GlobalReach 提供了备份脚本 `scripts/s079-backup.ps1`（PowerShell 格式）。

#### 手动备份命令

```bash
# ════════════════════════════════════════
# 方法一：使用 pg_dump 备份 PostgreSQL
# ════════════════════════════════════════

# 创建带时间戳的备份文件
BACKUP_FILE="globalreach_backup_$(date +%Y%m%d_%H%M%S).sql"

docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod > "./backups/$BACKUP_FILE"

echo "✅ 备份完成: $BACKUP_FILE"
echo "📦 文件大小: $(du -h ./backups/$BACKUP_FILE | cut -f1)"

# ════════════════════════════════════════
# 方法二：同时备份 Redis（可选）
# ════════════════════════════════════════

docker exec globalreach-redis redis-cli BGSAVE
# RDB 文件存储在 redis_data volume 中
docker cp globalreach-redis:/data/dump.rdb ./backups/redis_$(date +%Y%m%d).rdb

# ════════════════════════════════════════
# 方法三：运行官方备份脚本
# ════════════════════════════════════════
pwsh -File scripts/s079-backup.ps1
```

#### 恢复备份

```bash
# 恢复 PostgreSQL（⚠️ 会覆盖现有数据）
docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod < ./backups/globalreach_backup_YYYYMMDD.sql

# 或者进入容器内恢复
docker exec -it globalreach-postgres psql -U globalreach_user -d globalreach_prod
# 在 psql 提示符下:
# \i /path/to/backup.sql
```

#### 备份策略建议

| 备份类型 | 频率 | 保留周期 | 存储位置 |
|---------|------|---------|---------|
| 全量备份 | 每日一次 | 30 天 | 本地 `./backups/` + 异地云存储 |
| 增量 WAL | 持续归档 | 7 天 | 对象存储 (S3/OSS) |
| Redis 快照 | 每日 | 3 天 | 本地 + 远程 |

---

### Q19: 系统需要多少内存和磁盘空间？

**A:** 经过优化的资源使用情况：

#### 内存使用（优化后）

| 服务 | 限制 (limit) | 正常运行占用 | 占比 |
|------|-------------|-------------|------|
| **API (Node.js)** | 512 MB | ~70 MB (**~14%**) | 已从 87-94% 大幅优化 |
| PostgreSQL | 默认 (~256MB) | ~80 MB | — |
| Redis | 默认 (~64MB) | ~10 MB | — |
| Nginx | 128 MB | ~5 MB | — |
| Prometheus | 默认 (~512MB) | ~200 MB | — |
| Grafana | 默认 (~512MB) | ~150 MB | — |
| Node Exporter | 128 MB | ~15 MB | — |
| PG Exporter | 128 MB | ~15 MB | — |
| **总计** | **~2.5 GB** | **~545 MB** | — |

> **关键里程碑**: API 容器内存占用已从初始的 **87-94%（约 450-480MB of 512MB）** 优化至 **~14%（约 70MB）**，主要优化手段包括：
> - 降低 bcrypt rounds: 12 → 10
> - 设置 V8 堆上限: `--max-old-space-size=384`
> - 定期 GC: 每 60 秒触发一次
> - 优化 DB 连接池: max 10, min 2
> - 修复 DEFECT-001 中间件挂起问题

#### 磁盘空间预估

| 内容 | 初始占用 | 月增长量 | 备注 |
|------|---------|---------|------|
| Docker 镜像 | ~2 GB | — | 取决于更新频率 |
| PostgreSQL 数据 | ~50 MB | ~200-500 MB | 取决于活动和客户数据量 |
| Redis 数据 | ~5 MB | ~10 MB | 缓存数据，可清空重建 |
| 日志文件 | ~40 MB | ~40 MB/月 | 已配置轮转 (10m×3 + 5m×2) |
| Prometheus TSDB | ~100 MB | ~500 MB-1 GB | 保留天数决定 |
| Grafana 数据 | ~20 MB | ~5 MB | Dashboard 配置 |
| **合计（首月）** | **~400 MB** | — | — |

**最低磁盘建议**: 10 GB 可用空间（不含操作系统）；**推荐**: 30 GB+ 以应对数据增长。

---

### Q20: 如何将系统升级到最新版本？

**A:** 升级流程分为**自动（CI/CD）**和**手动**两种方式。

#### 方式一：通过 CI/CD 自动部署（推荐）

当代码推送到 `main` 分支时，GitHub Actions 流水线自动执行：

```
push to main
  │
  ├── Job 1: Quality Gate (ESLint + TypeCheck + Audit)
  │       │
  │       ▼
  ├── Job 2: Unit Tests (PG + Redis service containers)
  │       │
  │       ▼
  ├── Job 3: Docker Build & Push to GHCR (+ Trivy 安全扫描)
  │       │
  │       ▼
  ├── Job 4: Deploy via SSH (拉取镜像 → 重启容器 → 健康检查)
  │       │
  │       ▼
  └── Job 5: Notify (Slack/Summary)
```

#### 方式二：手动升级

```bash
# 1. 拉取最新代码
cd /opt/globalreach-project   # 或你的项目目录
git pull origin main

# 2. 确认当前运行的 commit
git log --oneline -3
# 推荐使用已知良好 commit: 3301b47 或最新 main

# 3. 重新构建并启动
docker compose -f docker-compose.prod.yml build --no-cache api
docker compose -f docker-compose.prod.yml up -d

# 4. 等待健康检查通过
for i in $(seq 1 10); do
  STATUS=$(curl -sf http://localhost:3000/api/v1/health | grep -o '"status":"[^"]*"')
  echo "[$i] $STATUS"
  [ "$STATUS" = '"status":"healthy"' ] && break
  sleep 3
done

# 5. 清理旧镜像（释放磁盘空间）
docker image prune -f
```

#### 回滚操作

如果升级后出现问题：

```bash
# 回滚到上一个已知良好的版本
git log --oneline -10   # 找到之前的 commit hash
git checkout <previous-good-commit>

# 重新部署旧版本
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml up -d

# 详细回滚流程参见 docs/ROLLBACK_PROCEDURE.md
```

---

## 五、监控与排障 (Q21–Q25)

### Q21: 在哪里可以查看系统指标和仪表盘？

**A:** GlobalReach 配备完整的 **Prometheus + Grafana** 可观测性栈。

#### 访问地址

| 系统 | 地址 | 用途 |
|------|------|------|
| **Prometheus** | http://localhost:9090 | 原始指标查询、目标状态、告警规则 |
| **Grafana** | http://localhost:3002 | 可视化仪表盘、图表、告警通知 |

**Grafana 默认凭据**:

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | `admin` | `admin` |

> ⚠️ **首次登录请立即修改密码！** 可通过环境变量 `GF_SECURITY_ADMIN_PASSWORD` 设置。

#### 预置仪表盘

Grafana 通过 `./grafana/provisioning/dashboards/` 目录自动加载预置仪表盘，通常包括：

| 仪表盘 | 展示内容 |
|--------|---------|
| **Node Overview** | 服务器 CPU、内存、磁盘、网络 (来自 node-exporter) |
| **PostgreSQL Overview** | 连接数、事务速率、缓存命中率、锁等待 (来自 pg-exporter) |
| **API Performance** | 请求延迟 P50/P95/P99、错误率、吞吐量 QPS |
| **Docker Containers** | 各容器资源使用趋势 |

#### Prometheus 关键查询示例

```promql
# API 请求错误率
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100

# API 请求延迟 P95
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# PostgreSQL 活跃连接数
pg_stat_activity_count{state="active"}

# V8 堆内存使用 (Node.js)
process_heap_used_bytes / 1024 / 1024  # 单位: MB
```

---

### Q22: 各种健康检查状态分别代表什么意思？

**A:** API 的 `/api/v1/health` 端点返回综合健康状态：

#### 整体状态 (status 字段)

| status 值 | 含义 | healthScore | 建议 |
|-----------|------|-------------|------|
| `"healthy"` | 所有子系统正常 | 90–100 | ✅ 无需操作 |
| `"degraded"` | 部分子系统有警告 | 60–89 | ⚠️ 关注告警，可能需要介入 |
| `"unhealthy"` | 关键子系统故障 | 0–59 | 🔴 立即排查 |

#### 子系统状态 (subsystems 字段)

```json
{
  "subsystems": {
    "database": "healthy",    // PostgreSQL: 连接池可用，查询响应正常
    "redis": "healthy",       // Redis: PING 通，延迟 < 10ms
    "memory": "healthy"       // V8 Heap: 使用率 < 80%
  }
}
```

| 子系统 | healthy | degraded | unhealthy |
|--------|---------|----------|-----------|
| **database** | 连接池充足，查询 < 100ms | 连接池 > 70%，查询 100-500ms | 无法连接 or 查询 > 500ms |
| **redis** | PING < 5ms | PING 5-20ms | PING 超时 or 连接失败 |
| **memory** | Heap < 70% (384MB 中 < 269MB) | Heap 70-85% | Heap > 85% or GC 频繁失败 |

#### Docker Health Check 与 API Health 的关系

```
Docker HEALTHCHECK (每30s)
  │
  └──→ curl -f http://localhost:3000/api/v1/health
       │
       ├── HTTP 200 + status="healthy"  → Docker: healthy ✅
       ├── HTTP 200 + status="degraded" → Docker: healthy ⚠️ (仍算通过)
       ├── HTTP 200 + status="unhealthy"→ Docker: unhealthy 🔴
       ├── HTTP 5xx                    → Docker: unhealthy 🔴
       └── Connection refused/timeout   → Docker: unhealthy 🔴 (连续3次失败标记)
```

---

### Q23: 当 Prometheus 显示 Target 为 DOWN 时该怎么办？

**A:** Prometheus Targets 页面显示 DOWN 意味着 Prometheus 无法抓取该目标的指标。

#### 排查步骤

```bash
# ════════════════════════════════════════
# Step 1: 确认哪个 target 是 DOWN
# ════════════════════════════════════════
# 打开 http://localhost:9090/targets
# 查看哪些目标的 State 为 "DOWN"

# 常见的 DOWN 目标及原因:

# ┌─────────────────┬──────────────────────────────────────┐
# │ Target           │ 常见原因                              │
# ├─────────────────┼──────────────────────────────────────┤
# │ api:3000/metrics│ API 容器未启动或 /metrics 端点不存在    │
# │ node-exporter   │ node-exporter 容器崩溃或网络不通         │
# │ postgres-exporter│ PG exporter 无法连接 PostgreSQL        │
# │ pushgateway     │ (如有) PushGateway 未运行               │
# └─────────────────┴──────────────────────────────────────┘

# ════════════════════════════════════════
# Step 2: 检查目标容器是否在运行
# ════════════════════════════════════════
docker ps -a | grep -E "exporter|api|node"

# ════════════════════════════════════════
# Step 3: 检查网络连通性
# ════════════════════════════════════════
# 从 Prometheus 容器内部测试能否访问目标
docker exec globalreach-prometheus wget -qO- --spider http://api:3000/metrics && echo "OK" || echo "FAIL"
docker exec globalreach-prometheus wget -qO- --spider http://node-exporter:9100/metrics && echo "OK" || echo "FAIL"
docker exec globalreach-prometheus wget -qO- --spider http://postgres-exporter:9187/metrics && echo "OK" || echo "FAIL"

# ════════════════════════════════════════
# Step 4: 检查 Prometheus 配置
# ════════════════════════════════════════
cat ./prometheus/prometheus.yml
# 确认 targets 中的 hostnames 与实际容器名一致
# 注意: Docker Compose 中服务名即为 DNS hostname

# ════════════════════════════════════════
# Step 5: 重启故障组件
# ════════════════════════════════════════
docker restart globalreach-node-exporter
docker restart globalreach-pg-exporter
# 等待 30s 后刷新 Prometheus Targets 页面确认恢复
```

#### 常见 DOWN 原因速查

| 现象 | 原因 | 解决方案 |
|------|------|---------|
| 全部 target DOWN | Prometheus 自身网络问题 | `docker restart globalreach-prometheus` |
| api:3000 DOWN | API 未暴露 /metrics 端点 | 确认 API 服务集成 prom-client |
| node-exporter DOWN | 容器未运行 | `docker restart globalreach-node-exporter` |
| pg-exporter DOWN | DATA_SOURCE_NAME 配置错误 | 检查 `.env` 中的 `DB_PASSWORD` 是否一致 |
| 间歇性 DOWN | 抓取间隔太短或目标响应慢 | 调整 `scrape_interval` (默认 15s) |

---

### Q24: 为什么 API 服务的内存使用较高？V8 GC 相关信息

**A:** Node.js 的内存管理与 **V8 引擎的垃圾回收 (GC)** 机制密切相关。

#### V8 内存模型概览

```
V8 Heap (当前限制: 384 MB)
├── New Space (Young Generation)  ~4-8 MB
│   ├── Nursery (对象新生代)
│   └── Semi-Space (Scavenge GC)
│
├── Old Space (Old Generation)    ~376 MB
│   ├── Used: 活跃对象 (~70 MB 优化后)
│   └── Free: 可用空间
│
└── Other (Code/Large Object/Map)
```

#### GlobalReach 的 GC 策略

```javascript
// API 服务启动时的内存优化配置

// 1. V8 堆内存硬上限
// 通过 NODE_OPTIONS 环境变量设置 (docker-compose.prod.yml)
NODE_OPTIONS=--max-old-space-size=384   // 384MB 上限

// 2. 定期手动触发 Full GC (每 60 秒)
// 在 server.js 入口处:
if (global.gc) {
  setInterval(() => {
    global.gc();  // 手动触发 Full GC (Mark-Sweep-Compact)
    console.log('[GC] Manual GC triggered', new Date().toISOString());
  }, 60_000);     // 60 秒间隔
} else {
  console.warn('[GC] global.gc not available. Start with --expose-gc for manual GC.');
}

// 3. Sequelize 连接池控制 (减少长时间存活的大对象)
const sequelize = new Sequelize(DATABASE_URL, {
  pool: {
    max: 10,     // 最大连接数
    min: 2,      // 最小空闲连接
    acquire: 30000, // 获取连接超时 30s
    idle: 10000    // 空闲连接回收 10s
  }
});
```

#### 内存优化前后对比

| 指标 | 优化前 (有 DEFECT-001) | 优化后 (S084+S085) |
|------|----------------------|-------------------|
| **Heap Used** | ~450-480 MB | **~65-75 MB** |
| **占容器比例** | **87-94%** | **~14-19%** |
| **GC 频率** | 不规律（受请求挂起影响） | 每 60s 定时触发 |
| **内存泄漏风险** | 🔴 高（请求挂起累积） | 🟢 低 |
| **OOM Kill 风险** | 🔴 频繁 | 🟢 极低 |

#### 如果发现内存持续增长

```bash
# 1. 查看实时内存使用
docker stats globalreach-api-prod --no-stream

# 2. 进入容器生成 heap snapshot (需要 --expose-gc 启动)
docker exec -it globalreach-api-prod node -e "
  const v8 = require('v8');
  const heap = v8.getHeapStatistics();
  console.log('=== V8 Heap Statistics ===');
  console.log('heap_size_limit:', (heap.heap_size_limit / 1024 / 1024).toFixed(1), 'MB');
  console.log('total_heap_size:', (heap.total_heap_size / 1024 / 1024).toFixed(1), 'MB');
  console.log('used_heap_size:', (heap.used_heap_size / 1024 / 1024).toFixed(1), 'MB');
  console.log('malloced_memory:', (heap.malloced_memory / 1024 / 1024).toFixed(1), 'MB');
  console.log('peak_malloced_memory:', (heap.peak_malloced_memory / 1024 / 1024).toFixed(1), 'MB');
  console.log('does_zap_garbage:', heap.does_zap_garbage);
  console.log('number_of_native_contexts:', heap.number_of_native_contexts);
  console.log('number_of_detached_contexts:', heap.number_of_detached_contexts);
"

# 3. 检查是否有 detached contexts (常见内存泄漏信号)
# number_of_detached_contexts 持续增长 = 可能存在闭包泄漏
```

---

### Q25: 在哪里可以找到详细的排障步骤？

**A:** 项目提供了多份排障文档，按场景查阅：

| 文档 | 路径 | 适用场景 |
|------|------|---------|
| **通用排障指南** | `docs/TROUBLESHOOTING_GUIDE.md` | 首选！覆盖大部分常见问题 |
| **部署手册** | `docs/DEPLOYMENT_PLAYBOOK.md` | 部署相关问题的完整 checklist |
| **回滚程序** | `docs/ROLLBACK_PROCEDURE.md` | 版本升级失败后的回滚步骤 |
| **安全笔记** | `docs/SECURITY_NOTES_G04.md` | 安全相关问题和加固建议 |
| **运维手册** | `docs/OPERATIONS_MANUAL.md` | 日常运维 SOP |
| **部署清单** | `DEPLOYMENT_CHECKLIST.md` | 部署前逐项核对清单 |
| **Docker 部署指南** | `DOCKER_DEPLOYMENT_GUIDE.md` | Docker 环境专项指南 |

#### 快速排障决策树

```
系统有问题？
  │
  ├─→ 能否访问 http://localhost:3000/api/v1/health ?
  │     │
  │     ├─ NO → 容器没起来?
  │     │         docker ps -a → 查看状态
  │     │         docker logs api → 查看报错
  │     │
  │     └─ YES → 状态是 healthy?
  │               ├─ degraded → 查看 subsystems 哪个子系统异常
  │               └─ unhealthy → 🔴 按 TROUBLESHOOTING_GUIDE 排查
  │
  ├─→ 登录/认证有问题?
  │     ├─ 401 → Token 过期或缺失 → 重新登录
  │     ├─ 403 ACCOUNT_DISABLED → 见 Q13 (L04 bug)
  │     └─ Timeout → 见 Q12 (DEFECT-001 bug)
  │
  ├─→ 监控数据异常?
  │     └─→ 打开 localhost:9090 (Prometheus) 和 localhost:3002 (Grafana)
  │
  └─→ 需要部署/升级?
        └─→ 参考 DEPLOYMENT_PLAYBOOK.md + ci-cd.yml
```

---

## 六、部署与 CI/CD (Q26–Q28)

### Q26: CI/CD 流水线是怎么工作的？

**A:** GlobalReach 使用 **GitHub Actions** 实现 5 阶段 CI/CD 流水线，配置文件位于 `.github/workflows/ci-cd.yml`。

#### 流水线架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Pipeline                        │
│                                                                    │
│  trigger: push to main / PR to main / manual dispatch             │
│                                                                    │
│  ┌─────────────┐                                                 │
│  │ Job 1        │  Quality Gate                                     │
│  │              │  ├── ESLint (代码规范检查)                         │
│  │              │  ├── TypeScript 类型检查                          │
│  │              │  └── npm audit (安全漏洞扫描)                      │
│  └──────┬───────┘                                                 │
│         │ needs: — (并行起点)                                      │
│  ┌──────▼───────┐                                                 │
│  │ Job 2        │  Unit Tests                                       │
│  │              │  ├── 启动 PG 15 + Redis 7 service containers     │
│  │              │  ├── 执行 DB migration (sync)                     │
│  │              │  ├── npm test (--coverage)                        │
│  │              │  └── Upload coverage artifact                     │
│  └──────┬───────┘                                                 │
│         │ needs: quality-gate                                      │
│  ┌──────▼───────┐                                                 │
│  │ Job 3        │  Docker Build & Push                              │
│  │              │  ├── Docker Buildx (多平台构建)                    │
│  │              │  ├── Login GHCR (GitHub Container Registry)        │
│  │              │  ├── Build & Push Image (with tags)               │
│  │              │  └── Trivy Scan (容器镜像安全扫描)                  │
│  └──────┬───────┘                                                 │
│         │ needs: quality-gate + push to main only                   │
│  ┌──────▼───────┐                                                 │
│  │ Job 4        │  Deploy (SSH)                                     │
│  │              │  ├── SSH 连接生产服务器                            │
│  │              │  ├── Pull latest image from GHCR                  │
│  │              │  ├── docker compose up -d (滚动更新)              │
│  │              │  ├── Health check 等待 (最多 30 次 × 3s)          │
│  │              │  └── HTTPS endpoint verification                  │
│  └──────┬───────┘                                                 │
│         │ needs: docker-build + main branch only                    │
│  ┌──────▼───────┐                                                 │
│  │ Job 5        │  Notify (always runs)                             │
│  │              │  ├── Determine pipeline status emoji              │
│  │              │  ├── Slack notification (可选)                    │
│  │              │  └── GitHub Step Summary table                    │
│  └─────────────┘                                                 │
│                                                                    │
│  concurrency: 同一分支只保留最新的运行，自动取消旧的                  │
└──────────────────────────────────────────────────────────────────┘
```

#### 关键配置细节

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 触发条件 | `push: main`, `PR: main`, `workflow_dispatch` | 支持手动触发并跳过测试 |
| Node.js 版本 | `20.x` | TODO: 计划升级到 22.x (见 S082/G04) |
| 容器 Registry | `ghcr.io` | GitHub 自带的容器镜像仓库 |
| 镜像命名 | `{owner}/{repo}/api` | 如 `ghcr.io/org/globalreach/api` |
| 镜像标签策略 | SHA + branch + latest + semver | 元数据由 `docker/metadata-action` 生成 |
| 安全扫描 | Trivy (CRITICAL + HIGH) | `ignore-unfixed: true` |
| 并发控制 | `workflow + ref` 分组 | 同分支新运行自动取消旧运行 |

---

### Q27: 为什么 Deploy 任务总是被跳过 (skipped)？

**A:** 这是最常见的 CI/CD 问题之一。Deploy job 被跳过是因为**前置条件未满足**或** Secrets 未配置**。

#### 原因分析

Deploy job (`ci-cd.yml` 第 238-320 行) 有以下**必须全部满足**的前置条件：

```yaml
deploy:
  needs: docker-build                          # 条件①: docker-build 必须成功
  if: github.ref == 'refs/heads/main'          # 条件②: 必须是 main 分支
  # 且 docker-build 自身还有条件:
  #   if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  #     → 只有 push 到 main 才会构建镜像
```

**但最常见的原因是缺少必要的 GitHub Secrets：**

```yaml
# Deploy job 使用的三个 Secrets (第 254-256 行):
host: ${{ secrets.PROD_HOST }}        # ❓ 生产服务器 IP 或域名
username: ${{ secrets.PROD_USER }}     # ❓ SSH 登录用户名
key: ${{ secrets.PROD_SSH_KEY }}       # ❓ SSH 私钥内容
```

> **这三个 Secret 都没有配置时，SSH Action 无法建立连接，job 会显示 skipped 或 failed。**

#### 解决方案

**Step 1: 配置 GitHub Secrets**

```
GitHub 仓库页面
  → Settings
  → Secrets and variables
  → Actions
  → New repository secret
```

需要创建以下 3 个 Secret：

| Secret 名称 | 示例值 | 说明 |
|------------|--------|------|
| `PROD_HOST` | `192.168.1.100` 或 `deploy.yourdomain.com` | 生产服务器的 IP 或域名 |
| `PROD_USER` | `ubuntu` 或 `deploy` | SSH 登录用户名 |
| `PROD_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | SSH 私钥完整内容（含换行） |

**Step 2: 生成 SSH 密钥对（如果没有的话）**

```bash
# 在你的本地机器上生成
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/globalreach-deploy
# 不要设置 passphrase（否则 Actions 无法使用）

# 将公钥复制到生产服务器
ssh-copy-id -i ~/.ssh/globalreach-deploy.pub user@<PROD_HOST>

# 将私钥内容设置为 PROD_SECRET secret
cat ~/.ssh/globalreach-deploy
# 复制全部输出，粘贴到 GitHub Secret 中
```

**Step 3: 验证配置**

```bash
# 手动触发流水线测试
GitHub 仓库 → Actions → GlobalReach CI/CD Pipeline → Run workflow
# 勾选 "Skip tests and go straight to build/deploy" 可加速测试
```

#### 其他可能导致 skipped 的情况

| 场景 | 原因 | 解决方法 |
|------|------|---------|
| PR 到 main | `if: github.ref == 'refs/heads/main'` 不满足 | PR 合并后再触发 |
| 仅修改了 md/docs 文件 | `paths-ignore` 排除了这些文件 | 修改源代码文件以触发 |
| 手动触发时 skip_tests=true | unit-tests 被跳过，但 deploy 仍需 docker-build | 不影响 deploy（deploy 只依赖 docker-build） |
| docker-build 失败 | needs 条件不满足 | 修复构建问题 |

---

### Q28: 如何设置远程部署？

**A:** 远程部署的核心是让 GitHub Actions 能够通过 SSH 连接到你的生产服务器并执行 Docker 命令。

#### 完整设置步骤

##### Step 1: 准备生产服务器

```bash
# 在生产服务器上执行:

# 1. 安装 Docker (如果没有)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. 安装 Docker Compose Plugin
sudo apt-get update
sudo apt-get install docker-compose-plugin

# 3. 创建项目目录
sudo mkdir -p /opt/globalreach-project
sudo chown $USER:$USER /opt/globalreach-project

# 4. 克隆代码
cd /opt/globalreach-project
git clone <your-repo-url> .
git checkout main

# 5. 创建 .env 生产环境变量
cp .env.example .env
nano .env   # 编辑填写真实的密码和密钥！

# 6. 创建 Docker 外部网络（compose 文件依赖此网络）
docker network create globalreach-project_globalreach-network

# 7. 首次手动启动验证
docker compose -f docker-compose.prod.yml up -d
```

##### Step 2: 配置 SSH 密钥认证

```bash
# 在本地机器上（或有安全环境的任意机器上）:

# 1. 生成专用部署密钥
ssh-keygen -t ed25519 -C "gh-actions-globalreach" -f ~/.ssh/gh_globalreach_deploy
# → 输入文件路径: /home/you/.ssh/gh_globalreach_deploy
# → Passphrase: 直接回车（留空）

# 2. 将公钥安装到生产服务器
ssh-copy-id -i ~/.ssh/gh_globalreach_deploy.pub <PROD_USER>@<PROD_HOST>

# 3. 测试 SSH 连接
ssh -i ~/.ssh/gh_globalreach_deploy <PROD_USER>@<PROD_HOST> "docker --version && compose version"
```

##### Step 3: 配置 GitHub Secrets

在 GitHub 仓库 → Settings → Secrets → Actions 中添加：

```
PROD_HOST     = your-server-ip-or-domain
PROD_USER     = your-ssh-username
PROD_SSH_KEY  = (粘贴 ~/.ssh/gh_globalreach_deploy 的完整私钥内容)
```

> `PROD_SSH_KEY` 的值应包含完整的私钥，包括 `-----BEGIN` 和 `-----END` 行。

##### Step 4: （可选）配置 Slack 通知

```
SLACK_WEBHOOK_URL = https://hooks.slack.com/services/T.../B.../xxx...
SLACK_BOT_TOKEN   = xoxb-xxxx-xxxx-xxxx
```

##### Step 5: 端到端验证

```bash
# 1. 在本地做一个小的代码改动
echo "// test" >> api/README.md

# 2. 提交并推送到 main
git add api/README.md
git commit -m "test: verify CI/CD pipeline"
git push origin main

# 3. 观察 GitHub Actions 运行
#    打开: https://github.com/<org>/<repo>/actions
#
#    预期流程:
#    ✅ Quality Gate  → passed
#    ✅ Unit Tests    → passed (or skipped)
#    ✅ Docker Build  → passed (image pushed to GHCR)
#    ✅ Deploy        → passed (不再 skipped!)
#    ✅ Notify        → success
```

##### 部署验证清单

部署完成后，逐一验证以下端点：

```bash
# API 健康检查
curl http://<PROD_HOST>:3000/api/v1/health

# HTTPS 前端页面
curl -sk -o /dev/null -w "%{http_code}" https://<your-domain>/

# HTTPS API
curl -sk -o /dev/null -w "%{http_code}" https://api.<your-domain>/api/v1/health

# Grafana
curl -sk -o /dev/null -w "%{http_code}" https://grafana.<your-domain>/
```

---

## 附录

### A. 快速命令速查卡

```bash
# 启动
docker compose -f docker-compose.prod.yml up -d

# 停止
docker compose -f docker-compose.prod.yml down

# 重启单个服务
docker restart globalreach-api-prod

# 查看状态
docker compose -f docker-compose.prod.yml ps

# 查看日志
docker logs -f globalreach-api-prod --tail 100

# 进入容器
docker exec -it globalreach-api-prod sh

# 数据库备份
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod > backup_$(date +%Y%m%d).sql

# 清理未使用的资源
docker system prune -f
```

### B. 重要文件索引

| 文件 | 用途 |
|------|------|
| `docker-compose.yml` | 开发环境 Compose (API + Nginx) |
| `docker-compose.prod.yml` | **生产环境 Compose (全部 8 个服务)** |
| `Dockerfile` | API 服务容器构建文件 |
| `.env.example` | 环境变量模板 |
| `.github/workflows/ci-cd.yml` | CI/CD 流水线定义 |
| `nginx/nginx.conf` | Nginx 主配置 |
| `nginx/conf.d/` | Nginx 站点配置 |
| `prometheus/prometheus.yml` | Prometheus 抓取配置 |
| `grafana/provisioning/` | Grafana 数据源和仪表盘预置 |
| `scripts/s079-backup.ps1` | 数据库备份脚本 |

### C. 已知问题与修复记录

| 编号 | 描述 | 影响 | 修复会话 | 状态 |
|------|------|------|---------|------|
| **DEFECT-001** | `validateRequest` 中间件工厂函数误用，导致 `req.map()` 无限挂起 | 注册/登录超时 | S084 | ✅ 已修复 |
| **L04** | User 模型缺少 `isActive` 字段，导致登录返回 403 | 所有用户无法登录 | S085 | ✅ 已修复 |

### D. Git 参考信息

| 项 | 值 |
|----|---|
| **已知良好 commit** | `3301b47` (或 `main` 分支最新) |
| **主分支** | `main` |
| **CI/CD 触发** | push to main / PR to main / workflow_dispatch |
| **并发策略** | 同分支只保留最新运行 |

---

> **文档维护说明**: 本 FAQ 随项目演进持续更新。如发现问题或有改进建议，请在项目中提交 Issue。
>
> **最后审查日期**: 2026-06-05 | **适用版本**: GlobalReach V2.0 (commit 3301b47+)
