# GlobalReach V2.0 — 性能基准测试套件设计文档

> **文档版本**: v1.0.0
> **创建日期**: 2026-06-09
> **任务编号**: N06 — 性能基准测试套件
> **状态**: 已实现
> **维护者**: 性能工程团队

---

## 目录

- [第一章：测试框架选型](#第一章测试框架选型)
- [第二章：测试场景定义](#第二章测试场景定义)
- [第三章：k6 测试脚本集](#第三章k6-测试脚本集)
- [第四章：CI/CD 集成](#第四章cicd-集成)
- [第五章：结果收集与可视化](#第五章结果收集与可视化)
- [第六章：基线建立与回归判定](#第六章基线建立与回归判定)
- [第七章：环境差异处理](#第七章环境差异处理)
- [附录](#附录)

---

## 第一章：测试框架选型

### 1.1 工具对比矩阵

| 维度 | k6 | Artillery | Wrk | Locust | JMeter |
|------|-----|-----------|-----|--------|--------|
| **语言** | JavaScript (Goja) | JavaScript/YAML | Lua | Python | Java/GUI |
| **引擎** | Go (原生高性能) | Node.js | C (多线程) | Python (gevent) | JVM |
| **单机 VUs** | >10,000 | ~5,000 | >50,000 | ~10,000 | ~5,000 |
| **协议支持** | HTTP/gRPC/WebSocket/GRPC | HTTP/WebSocket/SockJS | HTTP (仅) | HTTP/TCP/gRPC | 全协议 |
| **Prometheus 输出** | 原生支持 (remote-write) | 插件支持 | 不支持 | 插件支持 | 后端监听器 |
| **GitHub Actions** | 原生友好 (Docker) | 原生友好 | 需编译 | 需 Python 环境 | 需 JVM |
| **分布式执行** | 商业版付费 | 支持 (云服务) | 不支持 | Master-Worker | 分布式模式 |
| **学习曲线** | 低 (JS 熟悉即可) | 中等 | 高 (Lua) | 中等 (Python) | 高 (GUI+Java) |
| **报告格式** | JSON/InfluxDB/Prometheus | JSON/HTML | 终端输出 | Web UI | HTML/XML/JTL |
| **阈值断言** | 内置 thresholds | ensure/yield | 不支持 | 自定义 | 断言组件 |
| **社区活跃度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **许可证** | AGPL-3.0 (开源核心) | MPL-2.0 | Apache-2.0 | MIT | Apache-2.0 |

### 1.2 推荐方案：k6（主选）

#### 选择理由

1. **技术栈匹配度高**
   - GlobalReach 后端使用 Express.js (Node.js)，k6 使用 JavaScript 脚本，团队无需学习新语言
   - k6 的 goja 引擎虽然不支持全部 Node.js API，但 ES6+ 语法完全兼容
   - 与现有 Prometheus + Grafana 监控栈无缝集成

2. **性能表现优异**
   - Go 编写的单二进制文件，资源占用极低（~15MB 内存 / 1000 VU）
   - 单机可支撑 10,000+ 并发用户，满足 GlobalReach 当前规模需求
   - 启动速度快（<1秒），适合 CI/CD 快速反馈循环

3. **企业级特性完备**
   - 内置 `thresholds` 阈值系统，支持自动通过/失败判定
   - 原生 Prometheus remote-write 输出，直接对接现有监控平台
   - 支持 `scenarios` 多场景编排，一次运行覆盖多种负载模式
   - 检查点 (`checks`) 和自定义指标体系完善

4. **CI/CD 友好**
   - 官方 Docker 镜像：`grafana/k6:latest`
   - 退出码语义明确：`0`=通过, `1`=阈值失败, `2`=运行时错误
   - GitHub Actions marketplace 有成熟集成方案
   - 支持缓存加速（actions/cache）

### 1.3 备选方案

#### Artillery（备选一）

**适用场景**：
- 需要 Node.js 生态深度集成时
- 团队已熟悉 Artillery YAML 配置格式
- 需要快速编写简单负载测试时

**优势**：
- 纯 Node.js 实现，与项目技术栈完全一致
- YAML 配置简洁，上手快
- 内置 HTML 报告生成

**劣势**：
- 单机并发上限较低（~5000 VU）
- Prometheus 输出需额外插件配置
- 社区活跃度低于 k6

```yaml
# Artillery 配置示例（仅供参考）
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 50
      name: "Standard Load"
scenarios:
  - name: "Health Check"
    requests:
      - url: '/api/v1/health'
```

#### Wrk（备选二）

**适用场景**：
- 极轻量级快速基准测试
- 仅需 HTTP GET 性能数据
- 本地开发环境快速验证

**优势**：
- 极致性能（C 语言编写，单线程事件驱动）
- 安装简单（单二进制）
- 输出简洁明了

**劣势**：
- 仅支持 HTTP 协议
- 使用 Lua 脚本扩展，学习成本高
- 无内置阈值/检查机制
- 不适合复杂业务场景

```bash
# Wrk 快速基准示例
wrk -t4 -c100 -d30s --latency http://localhost:3000/api/v1/health
```

### 1.4 最终决策

| 场景 | 推荐工具 | 说明 |
|------|----------|------|
| **CI/CD 自动化回归** | ✅ k6 | 阈值断言 + Prometheus + GitHub Actions |
| **本地开发快速验证** | ✅ k6 (轻量场景) 或 Wrk | Wrk 更快但功能有限 |
| **生产环境压测** | ✅ k6 (distributed) | 如需超大规模考虑商业版 |
| **一次性临时测试** | ✅ Artillery | YAML 配置最快上手 |

---

## 第二章：测试场景定义

### 2.1 场景总览

| 场景ID | 名称 | 类型 | 默认并发 | 默认持续时间 | 目标 P95 | 关键指标 | 触发时机 |
|--------|------|------|----------|-------------|----------|----------|----------|
| SMOKE | 冒烟测试 | 基准验证 | 10 VU | 30s | <50ms | 吞吐量、错误率 | 每次 PR / push |
| LOAD | 标准负载 | 负载模拟 | 50 VU | 2min | <100ms | 吞吐/P95/P99 | 每日定时 / main merge |
| STRESS | 压力测试 | 峰值探测 | 200→500 VU | 5min | <500ms | 瓶颈定位、饱和点 | 发布前 / 大版本更新 |
| SPIKE | 突发流量 | 流量冲击 | 10→1000 VU | 3min | <1000ms | 恢复能力、弹性 | 营销活动前 |
| SOAK | 浸泡测试 | 持续稳定 | 50 VU | 30min | <200ms | 内存泄漏、GC 行为 | 周末夜间 |
| ENDPOINT | 端点逐一 | 细粒度 | 20 VU | 1min/端点 | varies | 各端点延迟分布 | 新端点上線后 |
| AUTH | 认证链路 | 业务流程 | 30 VU | 1min | <200ms | 登录→token→API 全链路 | 认证模块变更后 |
| EMAIL | 邮件发送 | 核心业务 | 10 VU | 2min | <500ms | 队列吞吐、发送延迟 | 邮件管道变更后 |

### 2.2 SMOKE — 冒烟测试

**目标**：验证系统基本可用性，确保部署后核心功能正常。

**策略**：
- 10 个虚拟用户（VU），持续 30 秒
- 测试最轻量的端点：`GET /health`、`GET /api/v1/campaigns`
- 严格阈值：P95 < 50ms，错误率 = 0%
- 失败即阻断后续流程（CI gatekeeper 角色）

**请求分布**：
```
GET /api/v1/health          → 60% (健康检查，最轻量)
GET /                       → 20% (根端点，服务信息)
GET /api/v1/campaigns       → 20% (需要认证的读操作)
```

**预期基线**（基于已知性能数据）：
| 指标 | 基线值 | 阈值 | 判定标准 |
|------|--------|------|----------|
| HTTP P95 延迟 | ~17ms | <50ms | PASS if ≤50ms |
| 错误率 | 0% | <1% | PASS if <1% |
| RPS (每秒请求数) | ~200 | >100 | PASS if >100 |
| 最大延迟 (P99.9) | <100ms | <200ms | PASS if ≤200ms |

### 2.3 LOAD — 标准负载测试

**目标**：模拟正常业务流量下的系统表现。

**策略**：
- 50 个虚拟用户，持续 2 分钟
- 混合读写场景，权重按实际业务比例分配
- 包含认证请求（带 JWT token）
- 关注 P95/P99 延迟分布

**请求分布（混合场景）**：
```
读操作 (70%):
  GET /api/v1/campaigns          → 25%
  GET /api/v1/accounts           → 20%
  GET /api/v1/stats/overview     → 15%
  GET /api/v1/emails             → 10%

写操作 (20%):
  POST /api/v1/campaigns         → 10% (创建活动)
  POST /api/v1/emails/send       → 10% (发送邮件)

其他 (10%):
  GET /api/v1/health             → 5%
  GET /api/v1/analytics/overview → 5%
```

**预期基线**：
| 指标 | 基线值 | 阈值 | 判定标准 |
|------|--------|------|----------|
| HTTP P95 延迟 | ~17ms | <100ms | PASS if ≤100ms |
| HTTP P99 延迟 | ~50ms | <300ms | PASS if ≤300ms |
| 错误率 | <0.1% | <1% | PASS if <1% |
| RPS | ~400 | >200 | PASS if >200 |
| 吞吐量 (bytes/s) | varies | >50KB/s | PASS if >50KB/s |

### 2.4 STRESS — 压力测试

**目标**：找到系统的性能瓶颈和饱和点。

**策略**：
- 阶梯式加压：200 → 300 → 400 → 500 VU
- 每阶段持续 60 秒，观察指标变化趋势
- 重点监控：数据库连接池、Redis 连接、内存使用率、事件循环延迟
- 允许适度性能退化（P95 可放宽至 500ms）

**阶梯配置**：
```
阶段 1: 200 VU × 60s  → 基准压力
阶段 2: 300 VU × 60s  → 中等压力
阶段 3: 400 VU × 60s  → 高压力
阶段 4: 500 VU × 60s  → 极限压力
阶段 5: 200 VU × 60s  → 恢复验证
```

**关注指标**：
| 监控项 | 数据源 | 告警阈值 |
|--------|--------|----------|
| API P95 延迟 | k6 metrics | >500ms 持续 30s |
| DB 连接池使用率 | Prometheus | >80% |
| Redis 延迟 | k6 custom metric | >50ms |
| 堆内存使用率 | /api/v1/health | >85% |
| 错误率 | k6 metrics | >5% |

### 2.5 SPIKE — 突发流量测试

**目标**：验证系统在突发流量冲击下的弹性和恢复能力。

**策略**：
- 指数级爬坡：10 → 1000 VU（30 秒内完成）
- 峰值维持 30 秒
- 指数级骤降：1000 → 10 VU（30 秒内完成）
- 恢复期 60 秒
- 总时长 3 分钟

**流量曲线图示**：
```
VUs
1000 │        ╭──────╮
    │       ╱        ╲
 500 │      ╱          ╲
    │     ╱            ╲
  10 │____╱              ╲____
    └───┬───┬───┬───┬───┬───┬───→ 时间
       0  15s 30s 60s 90s 120s 180s
         ↑爬坡  ↑峰值  ↑骤降  ↑恢复
```

**关键观测点**：
1. **爬坡期**：限流器是否正确触发？429 响应比例？
2. **峰值期**：系统是否存活？P999 延迟？错误率？
3. **骤降期**：资源是否及时释放？连接池是否回收？
4. **恢复期**：延迟是否回到基线水平？有无残留影响？

### 2.6 SOAK — 浸泡测试

**目标**：发现长期运行下的内存泄漏、资源耗尽等问题。

**策略**：
- 50 VU 持续 30 分钟
- 稳定负载（非加压模式）
- 每 5 分钟采样一次内存指标
- 对比首尾阶段的性能数据

**采样计划**：
```
T=0min:  基线记录（内存、延迟、吞吐）
T=5min:  第一次采样
T=10min: 第二次采样
T=15min: 第三次采样
T=20min: 第四次采样
T=25min: 第五次采样
T=30min: 最终采样 + 对比分析
```

**泄漏检测标准**：
| 指标 | 正常范围 | 警告 | 异常（疑似泄漏） |
|------|----------|------|------------------|
| 堆内存增长 | <5%/30min | 5-15%/30min | >15%/30min |
| RSS 增长 | <10%/30min | 10-20%/30min | >20%/30min |
| P95 延迟漂移 | <10% | 10-25% | >25% |
| GC 频率增加 | <20% | 20-50% | >50% |

### 2.7 ENDPOINT — 端点逐一基准测试

**目标**：为每个 API 端点建立独立的性能基线。

**策略**：
- 20 VU，每个端点独立测试 1 分钟
- 按端点分组依次执行（非并行）
- 记录每个端点的 P50/P95/P99/max 延迟
- 生成端点延迟排行榜

**端点清单及预期 P95**：

| 端点 | 方法 | 认证 | 预期 P95 | 权重 |
|------|------|------|----------|------|
| `/api/v1/health` | GET | 否 | <20ms | 核心 |
| `/` | GET | 否 | <20ms | 核心 |
| `/api/v1/health/ready` | GET | 否 | <15ms | 核心 |
| `/api/v1/health/live` | GET | 否 | <10ms | 核心 |
| `/api/v1/auth/login` | POST | 否 | <200ms | 核心 |
| `/api/v1/auth/me` | GET | 是 | <50ms | 重要 |
| `/api/v1/campaigns` | GET | 是 | <50ms | 重要 |
| `/api/v1/campaigns/:id` | GET | 是 | <50ms | 重要 |
| `/api/v1/campaigns` | POST | 是 | <100ms | 写操作 |
| `/api/v1/accounts` | GET | 是 | <50ms | 重要 |
| `/api/v1/emails` | GET | 是 | <50ms | 重要 |
| `/api/v1/emails/send` | POST | 是 | <500ms | 写操作(异步) |
| `/api/v1/stats/overview` | GET | 是 | <100ms | 聚合查询 |
| `/api/v1/analytics/overview` | GET | 是 | <150ms | 分析查询 |
| `/api/v1/metrics` | GET | 否 | <30ms | 监控 |
| `/api/v1/docs` | GET | 否 | <50ms | 文档 |

### 2.8 AUTH — 认证全链路测试

**目标**：验证从登录到 API 调用的完整认证链路性能。

**策略**：
- 30 VU，持续 1 分钟
- 模拟完整用户会话生命周期：
  1. POST /api/v1/auth/login → 获取 accessToken
  2. GET /api/v1/auth/me → 使用 token 获取用户信息
  3. GET /api/v1/campaigns → 使用 token 访问业务数据
  4. POST /api/v1/auth/logout → 注销 token

**链路分解**：

```
步骤 1: LOGIN (POST /auth/login)
  ↓ 期望 <200ms (bcrypt.compare ~200ms @ 10 rounds)
步骤 2: TOKEN 解析 + ME (GET /auth/me)
  ↓ 期望 <50ms (JWT verify + DB query)
步骤 3: CAMPAIGNS LIST (GET /campaigns)
  ↓ 期望 <50ms (DB pagination query)
步骤 4: LOGOUT (POST /auth/logout)
  ↓ 期望 <50ms (token revocation)
─────────────────────────────────
总计链路延迟: <350ms (P95)
```

**自定义指标**：
- `auth_login_duration` — 登录步骤耗时
- `auth_token_refresh_cost` — token 刷新开销
- `auth_full_roundtrip` — 完整链路耗时
- `auth_error_rate` — 认证相关错误率

### 2.9 EMAIL — 邮件发送流水线测试

**目标**：验证邮件发送管道的吞吐能力和队列行为。

**策略**：
- 10 VU（受 SMTP 速率限制约束），持续 2 分钟
- 模拟邮件发送完整流程：
  1. 创建 Campaign (POST /campaigns)
  2. 执行 Campaign 发送 (POST /emails/campaign/:id/execute)
  3. 查询发送进度 (GET /progress/campaign/:id)
  4. 查询邮件统计 (GET /emails/stats)

**注意事项**：
- 受 `SEND_RATE_LIMIT` 环境变量控制（默认 3 封/秒）
- 受 `emailSendLimiter` 中间件限制
- 测试环境中应使用 Mailpit 替代真实 SMTP
- 异步队列模式下，execute 返回 202 Accepted

**队列吞吐指标**：
| 指标 | 预期值 | 说明 |
|------|--------|------|
| 入队速率 | ~30 req/min | 受 rate limiter 限制 |
| 队列深度增长率 | <10/min | SendWorker 消费速度 |
| execute 响应时间 | <500ms | 异步入队操作 |
| 进度查询响应 | <50ms | SSE/轮询 |

---

## 第三章：k6 测试脚本集

### 3.1 目录结构

```
tests/performance/
├── smoke.js              # 冒烟测试
├── load.js               # 标准负载测试
├── stress.js             # 压力测试（阶梯式加压）
├── spike.js              # 突发流量测试
├── endpoints.js          # 端点逐一基准测试
├── auth-flow.js          # 认证全链路测试
├── email-pipeline.js     # 邮件发送流水线测试
└── lib/
    ├── config.js         # 共享配置（baseURL, headers）
    ├── auth.js           # 认证辅助函数
    └── metrics.js        # 自定义指标定义
```

### 3.2 脚本通用规范

#### 3.2.1 必须包含的元素

每个 k6 脚本必须包含以下结构：

```javascript
import { check } from 'k6';
import http from 'k6/http';
import { Rate, Trend, Gauge, Counter } from 'k6/metrics';

// 1. 导出选项（options）
export const options = {
  // scenarios, thresholds, vus, duration 等
};

// 2. 自定义指标（可选但推荐）
const myMetric = new Trend('my_metric');

// 3. Setup 函数（初始化）
export function setup() {
  // 预热、获取 token 等
}

// 4. 默认函数（主要逻辑）
export default function (data) {
  // 测试逻辑
}

// 5. Teardown 函数（清理）
export function teardown(data) {
  // 清理资源
}
```

#### 3.2.2 编码规范

- **语言**：ES6 JavaScript（k6 goja 引擎兼容）
- **禁止使用的 Node.js API**：`fs`, `path`, `process`, `require()`（除 k6 内置模块）
- **允许的 k6 模块**：`k6/http`, `k6/metrics`, `k6/check`, `k6/exec`
- **注释语言**：中文注释，代码标识符英文
- **缩进**：2 空格
- **命名约定**：
  - 变量/函数：camelCase
  - 常量：UPPER_SNAKE_CASE
  - 自定义指标：kebab-case（符合 Prometheus 命名规范）

#### 3.2.3 阈值（Thresholds）命名规范

```javascript
// 格式: <metric_name>[<aggregator>] <operator> <value>
export const options = {
  thresholds: {
    'http_req_duration{endpoint:health}': ['p(95)<50'],     // health 端点 P95<50ms
    'http_req_duration{endpoint:campaigns}': ['p(95)<100'],  // campaigns 端点 P95<100ms
    'http_req_failed{scenario:smoke}': ['rate<0.01'],        // smoke 场景错误率<1%
    'http_reqs': ['count>100'],                              // 最少请求数
  },
};
```

### 3.3 smoke.js — 冒烟测试

**文件位置**：`tests/performance/smoke.js`

**功能描述**：
- 最轻量的健康检查测试
- 用于 CI/CD 快速门控（每次 PR 都运行）
- 总运行时间控制在 30 秒以内

**核心参数**：
| 参数 | 值 | 说明 |
|------|-----|------|
| VUs | 10 | 轻量并发 |
| Duration | 30s | 快速完成 |
| RPS limit | 无限制 | 冒烟不设限 |
| 阈值 | 严格 | P95<50ms, error<1% |

**测试端点**：
1. `GET /api/v1/health` — 深度健康检查（含 DB/Redis 检测）
2. `GET /` — 根端点（服务信息）
3. `GET /api/v1/health/live` — 存活探针
4. `GET /api/v1/health/ready` — 就绪探针

**详细实现**：见 `tests/performance/smoke.js`

### 3.4 load.js — 标准负载测试

**文件位置**：`tests/performance/load.js`

**功能描述**：
- 模拟日常业务流量的混合场景
- 包含读/写操作的合理比例
- 需要有效的 JWT token

**核心参数**：
| 参数 | 值 | 说明 |
|------|-----|------|
| VUs | 50 | 标准并发 |
| Duration | 2m | 足够采集统计样本 |
| Ramp-up | 10s | 渐进式启动 |
| 阈值 | 标准 | P95<100ms |

**请求比例**：
- 读操作 70%（campaigns, accounts, stats, emails）
- 写操作 20%（create campaign, send email）
- 健康/元数据 10%（health, analytics）

**详细实现**：见 `tests/performance/load.js`

### 3.5 stress.js — 压力测试

**文件位置**：`tests/performance/stress.js`

**功能描述**：
- 阶梯式递增负载，定位系统瓶颈
- 5 个阶段：200→300→400→500→恢复
- 允许较高的延迟阈值（P95<500ms）

**Scenario 配置**：
```javascript
stages: [
  { duration: '60s', target: 200 },  // 阶段1: 基准压力
  { duration: '60s', target: 300 },  // 阶段2: 中等压力
  { duration: '60s', target: 400 },  // 阶段3: 高压力
  { duration: '60s', target: 500 },  // 阶段4: 极限压力
  { duration: '60s', target: 200 },  // 阶段5: 恢复验证
],
```

**详细实现**：见 `tests/performance/stress.js`

### 3.6 spike.js — 突发流量测试

**文件位置**：`tests/performance/spike.js`

**功能描述**：
- 模拟突发流量冲击（如营销活动启动瞬间）
- 指数级爬坡 + 峰值维持 + 指数级骤降
- 验证系统弹性恢复能力

**Scenario 配置**：
```javascript
stages: [
  { duration: '15s', target: 100 },   // 爬坡开始
  { duration: '15s', target: 500 },   // 加速爬坡
  { duration: '15s', target: 1000 },  // 到达峰值
  { duration: '30s', target: 1000 },  // 峰值维持
  { duration: '15s', target: 500 },   // 开始骤降
  { duration: '15s', target: 100 },   // 快速骤降
  { duration: '45s', target: 10 },    // 恢复期
  { duration: '30s', target: 0 },     // 冷却
],
```

**详细实现**：见 `tests/performance/spike.js`

### 3.7 endpoints.js — 端点逐一基准测试

**文件位置**：`tests/performance/endpoints.js`

**功能描述**：
- 对每个 API 端点进行独立基准测试
- 生成各端点的性能排行榜
- 便于识别慢端点和优化优先级

**测试方法**：
- 使用 k6 的 `scenarios` 特性，每个端点一个 scenario
- 每个 scenario 独立设置阈值
- 汇总所有端点的性能数据

**端点列表**（按路由分组）：

| 分组 | 端点 | 方法 | 预期 P95(ms) |
|------|------|------|--------------|
| Health | /api/v1/health | GET | 20 |
| Health | /api/v1/health/ready | GET | 15 |
| Health | /api/v1/health/live | GET | 10 |
| Auth | /api/v1/auth/login | POST | 200 |
| Auth | /api/v1/auth/me | GET | 50 |
| Campaigns | /api/v1/campaigns | GET | 50 |
| Campaigns | /api/v1/campaigns/:id | GET | 50 |
| Accounts | /api/v1/accounts | GET | 50 |
| Emails | /api/v1/emails | GET | 50 |
| Stats | /api/v1/stats/overview | GET | 100 |
| Analytics | /api/v1/analytics/overview | GET | 150 |
| Metrics | /api/v1/metrics | GET | 30 |
| Root | / | GET | 20 |

**详细实现**：见 `tests/performance/endpoints.js`

### 3.8 auth-flow.js — 认证全链路测试

**文件位置**：`tests/performance/auth-flow.js`

**功能描述**：
- 模拟完整的用户认证生命周期
- 从登录到注销的全链路性能测量
- 验证 JWT token 在高并发下的表现

**测试流程**：
```
setup() → 执行一次 login 获取 token 模板
default(data):
  ├─ 步骤1: POST /auth/login (新用户登录)
  │   → 记录 login_duration
  ├─ 步骤2: GET /auth/me (携带 token)
  │   → 记录 me_fetch_duration
  ├─ 步骤3: GET /campaigns (携带 token)
  │   → 记录 api_call_duration
  └─ 步骤4: POST /auth/logout (携带 token)
      → 记录 logout_duration
teardown(data) → 清理测试数据
```

**自定义指标**：
- `gr_auth_login_ms` — 登录耗时趋势
- `gr_auth_me_fetch_ms` — 用户信息获取耗时
- `gr_auth_api_call_ms` — 认证后 API 调用耗时
- `gr_auth_logout_ms` — 注销耗时
- `gr_auth_full_roundtrip_ms` — 全链路耗时
- `gr_auth_error_rate` — 认证错误率

**详细实现**：见 `tests/performance/auth-flow.js`

### 3.9 email-pipeline.js — 邮件发送流水线测试

**文件位置**：`tests/performance/email-pipeline.js`

**功能描述**：
- 测试邮件发送管道的端到端性能
- 验证队列入队→消费→完成的完整流程
- 关注异步操作的性能特征

**测试流程**：
```
setup():
  ├─ 创建测试 Campaign
  └─ 获取 campaignId

default(data):
  ├─ 步骤1: POST /emails/campaign/:id/execute (入队)
  │   → 验证 202 Accepted
  │   → 记录 enqueue_duration
  ├─ 步骤2: GET /progress/campaign/:id (查询进度)
  │   → 记录 progress_check_duration
  └─ 步骤3: GET /emails/stats (统计查询)
      → 记录 stats_query_duration

teardown(data):
  └─ 清理测试 Campaign
```

**特殊考量**：
- SMTP 速率限制（默认 3 封/秒）— VUs 设为 10 以避免触发限流
- 异步队列 — execute 返回 202，需轮询确认完成状态
- 测试环境应配置 Mailpit（避免发送真实邮件）

**详细实现**：见 `tests/performance/email-pipeline.js`

---

## 第四章：CI/CD 集成

### 4.1 工作流设计

#### 4.1.1 文件位置

新建 `.github/workflows/performance.yml` 作为独立工作流文件。

**选择独立文件的理由**：
- 性能测试运行时间长（smoke 30s + load 2min ≈ 3min），不适合阻塞主 CI
- 可以独立触发（手动 dispatch / 定时调度）
- 主 CI/CD (`ci-cd.yml`) 保持精简专注

#### 4.1.2 触发条件

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'api/**'                    # API 代码变更时触发
      - 'tests/performance/**'      # 性能测试脚本变更时
  pull_request:
    branches: [main]
    paths:
      - 'api/**'
      - 'tests/performance/**'
  workflow_dispatch:                # 手动触发
    inputs:
      scenario:
        description: '选择测试场景'
        required: true
        default: 'all'
        type: choice
        options:
          - all                     # 运行全部场景
          - smoke                   # 仅冒烟测试
          - smoke+load              # 冒烟 + 负载
          - full                    # 完整套件（含 stress/spike）
      vus:
        description: '并发用户数 (覆盖默认值)'
        required: false
        type: string
        default: ''
      duration:
        description: '持续时间 (覆盖默认值)'
        required: false
        type: string
        default: ''
```

#### 4.1.3 Job 结构

```
performance-test (Job)
  ├─ Step 1: Checkout code
  ├─ Step 2: Set up Node.js environment
  ├─ Step 3: Cache k6 binary (actions/cache)
  ├─ Step 4: Install k6 (if not cached)
  ├─ Step 5: Start test dependencies (PostgreSQL + Redis containers)
  ├─ Step 6: Start API server (background)
  ├─ Step 7: Wait for API readiness
  ├─ Step 8: Run Smoke Test (always)
  ├─ Step 9: Run Load Test (if not smoke-only)
  ├─ Step 10: Run Stress/Spike Tests (if full mode)
  ├─ Step 11: Upload results artifacts
  └─ Step 12: Generate summary report
```

#### 4.1.4 k6 缓存策略

```yaml
- name: Cache k6 binary
  uses: actions/cache@v4
  with:
    path: ~/.local/bin/k6
    key: k6-${{ runner.os }}-${{ hashFiles('**/k6-version') }}
  id: cache-k6

- name: Install k6
  if: steps.cache-k6.outputs.cache-hit != 'true'
  run: |
    # 下载并安装最新稳定版 k6
    K6_VERSION=$(curl -s https://api.github.com/repos/grafana/k6/releases/latest | grep tag_name | cut -d'"' -f4)
    curl -L -o /tmp/k6.tar.gz "https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-v${K6_VERSION#v}-linux-amd64.tar.gz"
    tar -xzf /tmp/k6.tar.gz -C /tmp
    mv /tmp/k6-v${K6_VERSION#v}-linux-amd64/k6 ~/.local/bin/
    chmod +x ~/.local/bin/k6
    echo "${K6_VERSION}" > k6-version
```

#### 4.1.5 结果上传与 PR 评论

```yaml
- name: Upload performance results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: performance-results-${{ github.run_id }}
    path: |
      tests/performance/results/
    retention-days: 14

- name: Comment PR with results
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      let summary = '## 📊 Performance Test Results\n\n';
      summary += '| Scenario | Status | P95 (ms) | RPS | Error Rate |\n';
      summary += '|----------|--------|----------|-----|------------|\n';

      // 读取各场景结果并汇总
      const scenarios = ['smoke', 'load'];
      for (const s of scenarios) {
        try {
          const data = JSON.parse(fs.readFileSync(`tests/performance/results/${s}.json`));
          const p95 = data.metrics?.['http_req_duration']?.values?.['p(95)'] || 'N/A';
          const rps = data.metrics?.['http_reqs']?.values?.count ? 
            Math.round(data.metrics.http_reqs.values.count / parseInt(data.state.testRunDurationMs / 1000)) : 'N/A';
          summary += `| ${s} | ✅ Pass | ${p95} | ${rps} | OK |\n`;
        } catch(e) {
          summary += `| ${s} | ❌ Fail | N/A | N/A | N/A |\n`;
        }
      }

      // 发表评论
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: summary
      });
```

### 4.2 与主 CI/CD 的关系

```
Push to main:
  ci-cd.yml ──┬── quality-gate (lint/typecheck/security)
              ├── unit-tests (Jest)
              ├── docker-build (构建镜像)
              ├── deploy (部署到生产)
              └── security-scan (Trivy)

  performance.yml (并行运行):
              ├── smoke-test (30s)
              └── load-test (2min)

PR to main:
  ci-cd.yml ──┬── quality-gate
              └── unit-tests

  performance.yml (并行运行):
              ├── smoke-test (PR 门控)
              └── load-test (参考数据)
```

### 4.3 失败策略

| 场景 | 阈值失败时行为 | 是否阻断 merge |
|------|---------------|----------------|
| Smoke test (PR) | ❌ 阻断 PR merge | 是（门控角色） |
| Load test (PR) | ⚠️ 报告但不阻断 | 否（参考数据） |
| Smoke test (main push) | ⚠️ 告警通知 | 否（已合并） |
| Load test (main push) | 🔔 触发告警 | 否 |
| Stress/Spike | 📊 仅记录分析 | 否 |

---

## 第五章：结果收集与可视化

### 5.1 k6 Prometheus 远程写入配置

#### 5.1.1 配置方式

k6 原生支持 Prometheus Remote Write 协议，通过 `--out` 参数启用：

```bash
k6 run tests/performance/load.js \
  --out prometheus-remote-write=http://prometheus:9090/api/v1/write \
  --out prometheus-remote-write-prefix=globalreach_perf \
  --summary-export=results/load-summary.json
```

#### 5.1.2 输出的 Prometheus 指标

k6 会将以下指标推送到 Prometheus：

| k6 指标名 | Prometheus 指标名 | 类型 | 说明 |
|-----------|-------------------|------|------|
| `http_req_duration` | `globalreach_perf_http_req_duration` | Histogram | HTTP 请求延迟分布 |
| `http_reqs` | `globalreach_perf_http_reqs` | Counter | 总请求数 |
| `http_req_failed` | `globalreach_perf_http_req_failed` | Rate | 请求失败率 |
| `vus` | `globalreach_perf_vus` | Gauge | 当前虚拟用户数 |
| `iteration_duration` | `globalreach_perf_iteration_duration` | Trend | 单次迭代耗时 |
| `data_received` | `globalreach_perf_data_received` | Counter | 接收数据量 |
| `data_sent` | `globalreach_perf_data_sent` | Counter | 发送数据量 |
| 自定义指标 | `globalreach_perf_<name>` | varies | 测试脚本定义 |

#### 5.1.3 Prometheus scrape 配置补充

在 `prometheus/prometheus.yml` 中添加 k6 远程写入接收配置（如使用 Prometheus Agent 模式）：

```yaml
# 如需在 Prometheus 端接收 k6 remote write
remote_write:
  - url: 'http://localhost:9090/api/v1/write'
```

> **注意**：GlobalReach 当前架构中，推荐使用 k6 直接远程写入 Prometheus，而非 Prometheus 主动拉取。这避免了 k6 短生命周期导致的抓取间隔问题。

### 5.2 Grafana Dashboard JSON 模板

#### 5.2.1 Dashboard 概览

**Dashboard 名称**：`GlobalReach Performance Benchmark`
**UID**：`globalreach-perf-benchmark`
**刷新频率**：30s（实时）/ 5min（历史回顾）

#### 5.2.2 面板布局

```
┌─────────────────────────────────────────────────────────────┐
│ Row 1: 测试概览 (4 panels)                                    │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ 总请求数  │ │ 平均RPS  │ │ 错误率   │ │ P95延迟  │        │
│ │ (Stat)   │ │ (Stat)   │ │ (Stat)   │ │ (Stat)   │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────────────────────────────────┤
│ Row 2: 延迟趋势 (Time Series)                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ P50 / P95 / P99 延迟时间线 (multi-line)                  │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Row 3: 吞吐量 & 错误率                                       │
│ ┌──────────────────────────────┐ ┌────────────────────────┐ │
│ │ Requests/sec 时间线          │ │ Error Rate 时间线       │ │
│ └──────────────────────────────┘ └────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Row 4: 并发用户 & 资源                                        │
│ ┌──────────────────────────────┐ ┌────────────────────────┐ │
│ │ Active VUs 时间线            │ │ Heap Memory % 时间线    │ │
│ └──────────────────────────────┘ └────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Row 5: 端点延迟排行 (Table)                                   │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Endpoint | P50 | P95 | P99 | Max | Count | Fail%        │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Row 6: 基线对比                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Current vs Baseline P95 偏差柱状图                        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 5.2.3 关键面板 PromQL 查询

**Panel: P95 延迟趋势**
```promql
histogram_quantile(
  0.95,
  sum(rate(globalreach_perf_http_req_duration_seconds_bucket[5m]))
  by (le, method, endpoint)
)
```

**Panel: 吞吐量 (RPS)**
```promql
sum(rate(globalreach_perf_http_reqs[5m])) by (method, endpoint)
```

**Panel: 错误率**
```promql
sum(rate(globalreach_perf_http_req_failed[5m]))
/
sum(rate(globalreach_perf_http_reqs[5m]))
* 100
```

**Panel: 端点延迟排行**
```promql
topk(15,
  histogram_quantile(0.95,
    sum(rate(globalreach_perf_http_req_duration_seconds_bucket[5m]))
    by (le, endpoint)
  )
)
```

### 5.3 历史基线对比方法

#### 5.3.1 基线存储

每次性能测试完成后，将摘要结果存储为结构化文件：

```json
{
  "baseline_id": "bl-20260609-001",
  "timestamp": "2026-06-09T10:00:00Z",
  "commit_sha": "abc123def456",
  "branch": "main",
  "environment": "ci",
  "scenarios": {
    "smoke": {
      "p50_ms": 12,
      "p95_ms": 17,
      "p99_ms": 35,
      "max_ms": 120,
      "rps": 215,
      "error_rate": 0,
      "total_requests": 6450,
      "duration_s": 30
    },
    "load": {
      "p50_ms": 14,
      "p95_ms": 22,
      "p99_ms": 48,
      "max_ms": 280,
      "rps": 432,
      "error_rate": 0.002,
      "total_requests": 51840,
      "duration_s": 120
    }
  }
}
```

#### 5.3.2 基线对比算法

```
当前值 vs 基线值:

偏差百分比 = ((当前值 - 基线值) / 基线值) * 100

判定规则:
  |偏差| ≤ 15%  →  ✅ PASS (正常波动)
  15% < |偏差| ≤ 30%  →  ⚠️ WARN (需关注)
  |偏差| > 30%  →  ❌ FAIL (性能退化)

注意: 对于"越低越好"的指标（如延迟），
正向偏差表示退化（当前 > 基线 = 变慢了）
```

#### 5.3.3 基线管理策略

| 操作 | 条件 | 说明 |
|------|------|------|
| 建立初始基线 | 首次成功运行 | 作为后续对比锚点 |
| 更新基线 | 性能优化后确认改善 | 手动审批更新 |
| 回滚基线 | 发现基线记录异常 | 恢复到上一个有效基线 |
| 多基线并存 | 不同环境/版本 | 按环境标签区分 |

### 5.4 性能退化告警规则

#### 5.4.1 Prometheus Alert Rules

新增文件 `prometheus/rules/performance-alerts.yml`：

```yaml
groups:
  - name: globalreach_performance_regressions
    interval: 60s
    rules:
      # P95 延迟相比基线恶化超过 20%
      - alert: PerformanceRegressionP95
        expr: |
          (
            histogram_quantile(0.95,
              sum(rate(globalreach_api_request_duration_seconds_bucket[5m])) by (le)
            ) -
            histogram_quantile(0.95,
              sum(rate(globalreach_api_request_duration_seconds_bucket offset 24h][5m])) by (le)
          )
          /
          histogram_quantile(0.95,
            sum(rate(globalreach_api_request_duration_seconds_bucket offset 24h][5m])) by (le)
          > 0.2
        for: 15m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "API P95 延迟较昨日恶化超过 20%"
          description: "当前 P95={{ $value }}s，较 24 小时前基线恶化超过 20%，请排查最近代码变更"

      # 错误率突增超过 3 倍
      - alert: PerformanceErrorRateSpike
        expr: |
          sum(rate(globalreach_api_errors_total[5m]))
          /
          sum(rate(globalreach_api_requests_total[5m])) > 0.03
        for: 10m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "API 错误率超过 3%"
          description: "当前错误率 {{ $value | humanizePercentage }}，远高于正常水平 (<1%)"

      # 吞吐量下降超过 30%
      - alert: PerformanceThroughputDrop
        expr: |
          (
            sum(rate(globalreach_api_requests_total offset 1h][5m])) -
            sum(rate(globalreach_api_requests_total[5m]))
          )
          /
          sum(rate(globalreach_api_requests_total offset 1h][5m])) > 0.3
        for: 10m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "API 吞吐量下降超过 30%"
          description: "当前 RPS 相比 1 小时前下降 {{ $value | humanizePercentage }}"
```

---

## 第六章：基线建立与回归判定

### 6.1 初始基线记录模板

#### 6.1.1 基线记录格式

每次建立或更新基线时，填写以下模板：

```markdown
## 性能基线记录

### 基本信息
- **基线ID**: bl-{YYYYMMDD}-{NNN}
- **记录日期**: YYYY-MM-DD HH:MM UTC
- **记录人**: @username
- **Git Commit**: {full-sha}
- **分支**: {branch-name}
- **Node.js 版本**: v{version}
- **测试环境**: {local/ci/staging/prod}

### 环境配置
| 组件 | 版本/配置 |
|------|----------|
| CPU | {cores} cores |
| Memory | {MB} MB |
| PostgreSQL | 15.x (max_connections={n}) |
| Redis | 7.x (maxmemory={mb}) |
| Node.js | v{version} (--max-old-space-size={mb}) |
| Docker Compose | {container-count} containers |
| 网络 | {latency}ms latency |

### 场景基线值

#### SMOKE 冒烟测试
| 指标 | 值 | 单位 | 阈值 | 状态 |
|------|-----|------|------|------|
| P50 延迟 | {val} | ms | <30 | ✅ |
| P95 延迟 | {val} | ms | <50 | ✅ |
| P99 延迟 | {val} | ms | <100 | ✅ |
| Max 延迟 | {val} | ms | <200 | ✅ |
| RPS | {val} | req/s | >100 | ✅ |
| 错误率 | {val} | % | <1 | ✅ |
| 总请求数 | {val} | count | >3000 | ✅ |

#### LOAD 标准负载测试
| 指标 | 值 | 单位 | 阈值 | 状态 |
|------|-----|------|------|------|
| P50 延迟 | {val} | ms | <50 | ✅ |
| P95 延迟 | {val} | ms | <100 | ✅ |
| P99 延迟 | {val} | ms | <300 | ✅ |
| Max 延迟 | {val} | ms | <1000 | ✅ |
| RPS | {val} | req/s | >200 | ✅ |
| 错误率 | {val} | % | <1 | ✅ |
| 数据传输 | {val} | KB/s | >50 | ✅ |

#### ENDPOINT 端点逐一测试
| 端点 | P50 | P95 | P99 | Max | RPS | 状态 |
|------|-----|-----|-----|-----|-----|------|
| /api/v1/health | ... | ... | ... | ... | ... | ✅ |
| /api/v1/campaigns | ... | ... | ... | ... | ... | ✅ |
| ... | ... | ... | ... | ... | ... | ... |

### 备注
{任何异常情况、环境干扰因素、改进建议}
```

#### 6.1.2 GlobalReach 已知基线（来自协议文档）

根据现有性能数据，GlobalReach V2.0 的已知基线如下：

| 指标 | 基线值 | 来源 |
|------|--------|------|
| API 响应时间 P95 | ~17ms | 协议文档 |
| 数据库连接延迟 | ~2ms | 协议文档 |
| Redis 连接延迟 | ~2ms | 协议文档 |
| 堆内存使用率 | ~13% | 协议文档 |
| Health Score | 100 | 协议文档 |

> **重要**：以上值为生产环境稳态数据。首次运行基准测试套件时应以这些值为参考，建立正式的测试基线。

### 6.2 回归判定标准

#### 6.2.1 三级判定体系

```
┌─────────────────────────────────────────────────────────┐
│                  性能回归判定矩阵                         │
├──────────────┬────────────┬────────────┬───────────────┤
│   偏离幅度    │   ≤ ±15%   │  ±15%~±30%  │   > ±30%     │
├──────────────┼────────────┼────────────┼───────────────┤
│  判定结果    │   ✅ PASS  │  ⚠️ WARN   │   ❌ FAIL     │
│  CI 行为     │   继续     │   警告日志  │   阻断/通知    │
│  告警级别    │   无       │   INFO     │   WARNING/CRIT │
│  处理时效    │   无需     │   48h 内    │   立即        │
└──────────────┴────────────┴────────────┴───────────────┘
```

#### 6.2.2 按指标类型的判定细则

**延迟类指标**（越低越好）：
- 当前 P95 = 25ms, 基线 P95 = 17ms
- 偏差 = (25 - 17) / 17 = +47% → ❌ FAIL（严重退化）

**吞吐类指标**（越高越好）：
- 当前 RPS = 350, 基线 RPS = 430
- 偏差 = (350 - 430) / 430 = -18.6% → ⚠️ WARN（轻微退化）

**错误率**（越低越好）：
- 当前 = 0.5%, 基线 = 0.1%
- 偏差 = (0.5 - 0.1) / 0.1 = +400% → ❌ FAIL（严重退化）

#### 6.2.3 例外豁免条件

以下情况不触发 FAIL 判定：
1. **首次运行**：无历史基线时，仅记录不判定
2. **环境变更**：基础设施升级后的首次运行（标记为"新基线候选"）
3. **数据量变化**：数据库记录数增长 >50% 时适当放宽阈值
4. **已知事件**：维护窗口、备份任务期间的数据标记为排除

### 6.3 性能退化分析工作流

```
检测到性能退化 (WARN or FAIL)
         │
         ▼
  ┌──────────────┐
  │ 收集诊断数据  │
  │ • k6 详细报告 │
  │ • Prometheus │
  │ • 日志片段   │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 定位退化根因  │
  │ • 代码变更?  │ ← git diff 比对
  │ • 数据增长?  │ ← DB 统计
  │ • 依赖升级?  │ ← package.json diff
  │ • 资源争用?  │ ← 容器指标
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 制定修复方案  │
  │ A: 回滚代码  │
  │ B: 优化查询  │
  │ C: 扩容资源  │
  │ D: 更新基线  │ (如果是有意优化导致的变化)
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 执行 + 验证  │
  │ • 重新跑测试  │
  │ • 确认修复   │
  │ • 更新基线   │ (如需要)
  └──────────────┘
```

### 6.4 与现有 Prometheus 指标的关联映射

#### 6.4.1 k6 指标 ↔ 应用指标映射

| k6 测试指标 | Prometheus 应用指标 | 关联说明 |
|-------------|-------------------|----------|
| `http_req_duration` (by endpoint) | `globalreach_api_request_duration_seconds` | 同维度对比 |
| `http_req_failed` | `globalreach_api_errors_total` | 错误率交叉验证 |
| `http_reqs` (count) | `globalreach_api_requests_total` | 吞吐量对比 |
| `vus` (concurrent) | N/A | k6 独有，反映测试侧负载 |
| iteration_duration | N/A | k6 独有，反映脚本效率 |

#### 6.4.2 跨数据源关联分析

**示例：k6 显示 P95 退化，结合应用指标定位**

```
Step 1: k6 报告 campaigns 端点 P95 从 17ms → 45ms (+165%)
Step 2: 查 Prometheus:
  globalreach_api_request_duration_seconds{endpoint="/api/v1/campaigns"}
  → 确认生产环境同样升高
Step 3: 查 DB 指标:
  globalreach_db_query_duration_seconds
  → 发现 COUNT 查询变慢
Step 4: 分析原因:
  → campaigns 表数据量从 100 → 10000 行
  → 缺少复合索引
Step 5: 修复:
  → 添加 (userId, status, createdAt) 复合索引
Step 6: 验证:
  → 重新运行 endpoints.js → P95 恢复到 19ms
```

---

## 第七章：环境差异处理

### 7.1 环境系数矩阵

不同运行环境的性能特征存在系统性差异，需要引入环境系数进行归一化：

| 因素 | 本地开发 | CI 容器 (GitHub Actions) | Staging | 生产环境 |
|------|----------|-------------------------|---------|----------|
| **CPU** | 宿主机共享 | 2-4 core (shared) | 独立 VM | 独立/专用 |
| **Memory** | 宿主机共享 | 7GB (runner) | 8-16GB | 16-32GB |
| **网络延迟** | <1ms (loopback) | ~0ms (容器内部) | 1-5ms | varies |
| **磁盘 I/O** | SSD (本地) | SSD (ephemeral) | SSD/NVMe | NVMe/SSD |
| **DB 连接** | localhost TCP | container network | LAN | dedicated |
| **Redis 连接** | localhost TCP | container network | LAN | dedicated |
| **冷启动影响** | 无 (常驻) | 有 (fresh container) | 有 | 无 (常驻) |
| **延迟系数** | 0.8x | 1.2x | 1.0x | 1.0x (基准) |
| **吞吐系数** | 1.3x | 0.8x | 1.0x | 1.0x (基准) |

**使用说明**：
- 生产环境 = 基准（系数 1.0）
- CI 环境通常比生产慢 20%（资源共享 + 冷启动）
- 本地开发可能更快（无网络开销 + 无容器化开销）

**归一化公式**：
```
标准化延迟 = 实测延迟 / 环境延迟系数
标准化吞吐 = 实测吞吐 / 环境吞吐系数
```

### 7.2 冷启动 vs 热身策略

#### 7.2.1 冷启动影响范围

CI 环境中的冷启动效应主要体现在：

1. **Node.js V8 JIT 编译**：首次执行函数时需要编译优化（~100ms 开销）
2. **数据库连接池初始化**：首次建立连接需要 TCP 握手 + 认证（~5-20ms/连接）
3. **Redis 连接建立**：首次连接需要握手（~2-5ms）
4. **文件系统缓存**：首次读取文件无 OS page cache（后续访问更快）
5. **DNS 解析**：首次解析域名（后续由 resolver 缓存）

#### 7.2.2 热身（Ramp-up）策略

```javascript
// k6 options 中的 executor 配置
export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-vus',
      vus: 5,
      duration: '10s',
      startTime: '0s',
      exec: 'warmup',        // 热身专用函数
    },
    main_test: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '10s', target: 50 },   // 渐进式 ramp-up
        { duration: '100s', target: 50 },  // 稳定负载
      ],
      startTime: '10s',       // 热身结束后开始
      exec: 'main',
    },
  },
};
```

**热身函数示例**：
```javascript
// 热身阶段：让系统和 JIT 预热
export function warmup() {
  // 发送几个轻量请求预热连接池和缓存
  let responses = http.batch([
    ['GET', `${__ENV.BASE_URL}/api/v1/health/live`, null, { tags: { phase: 'warmup' }}],
    ['GET', `${__ENV.BASE_URL}/api/v1/health/ready`, null, { tags: { phase: 'warmup' }}],
  ]);

  check(responses[0], {
    'warmup liveness': (r) => r.status === 200,
  });
}
```

#### 7.2.3 数据丢弃策略

| 策略 | 适用场景 | 实现方式 |
|------|----------|----------|
| **丢弃前 N 秒** | 所有 CI 测试 | k6 `startTime` 偏移 |
| **仅保留稳定区** | 精确基线 | 脚本内过滤 `startTime` 之后的数据 |
| **渐进式加权** | 长时间 soak 测试 | 后半段数据权重更高 |

### 7.3 外部依赖 Mock 策略

#### 7.3.1 SMTP 服务 Mock

GlobalReach 使用邮件发送功能，在性能测试中必须避免发送真实邮件：

**方案：Mailpit 容器**

项目已集成 Mailpit（`axllent/mailpit:v1.30.1`），用于测试环境：

```yaml
# docker-compose 中的 mailpit 服务
mailpit:
  image: axllent/mailpit:v1.30.1
  ports:
    - "1025:1025"   # SMTP 端口
    - "8025:8025"   # Web UI
  environment:
    MP_SMTP_LISTEN: ":1025"
```

**k6 脚本中的处理**：
- 邮件发送测试期望返回 202 Accepted（入队成功）
- 不等待实际投递完成（异步队列模式）
- 通过 `/emails/stats` 端点验证队列状态

#### 7.3.2 外部 API Mock

GlobalReach 可能调用的外部服务：

| 外部服务 | Mock 方式 | 说明 |
|----------|----------|------|
| Gmail SMTP | Mailpit | 测试环境替换 |
| Outlook SMTP | Mailpit | 测试环境替换 |
| QQ/163 SMTP | Mailpit | 测试环境替换 |
| OpenTelemetry Collector | 本地 mock | CI 中跳过 OTel 导出 |
| Slack Webhook | 环境变量控制 | 设置 `SLACK_WEBHOOK_URL=""` 禁用 |

**环境变量控制**：
```bash
# CI 测试环境变量
SMTP_HOST=mailpit          # 使用 Mailpit 替代真实 SMTP
SMTP_PORT=1025
OTEL_EXPORTER=none         # 禁用遥测导出
SLACK_WEBHOOK_URL=         # 空 = 不发送通知
```

#### 7.3.3 认证 Token 管理

性能测试需要有效 JWT token：

**方案 A：Setup 函数动态获取（推荐）**

```javascript
export function setup() {
  // 执行登录获取 token
  const loginRes = http.post(`${__ENV.BASE_URL}/api/v1/auth/login`, JSON.stringify({
    email: __ENV.TEST_USER_EMAIL,
    password: __ENV.TEST_USER_PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  const token = loginRes.json('data.accessToken');
  return { authToken: token };
}
```

**方案 B：环境变量预置**

```bash
# .env.performance 或 GitHub Secrets
TEST_AUTH_TOKEN=eyJhbGciOiJIUzI1NiIs...
```

**安全提醒**：
- 测试 token 应使用专用测试账户
- token 有效期应足够长（或使用 refresh token）
- **绝不要将生产 token 提交到代码库**

---

## 附录

### A. 快速参考卡

```bash
# 运行冒烟测试
k6 run tests/performance/smoke.js

# 运行负载测试（带 Prometheus 输出）
k6 run tests/performance/load.js \
  --out prometheus-remote-write=http://localhost:9090/api/v1/write

# 运行指定场景（使用包装脚本）
./scripts/run-benchmark.sh --scenario=load --vus=50 --duration=2m

# 运行全套测试
./scripts/run-benchmark.sh --scenario=all

# 生成 HTML 报告
k6 run tests/performance/load.js --summary-export=results/load.json \
  && k6-tools html-report results/load.json > report.html
```

### B. 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| connection refused | API 未启动 | 先启动 `docker compose up -d` |
| 401 Unauthorized | Token 过期 | 检查 TEST_AUTH_TOKEN 环境变量 |
| 429 Too Many Requests | 触发限流 | 降低 VUs 或调整 rate limiter |
| 脚本语法错误 | 使用了 Node.js API | 检查是否使用了 require/fs/process |
| Prometheus 无数据 | remote-write URL 错误 | 确认 Prometheus 地址和端口 |
| CI 超时 | 测试时间过长 | 减少 duration 或拆分 job |

### C. 术语表

| 术语 | 定义 |
|------|------|
| VU (Virtual User) | 虚拟用户，k6 中的并发执行单元 |
| Iteration | 迭代，VU 执行一次默认函数的完整周期 |
| Threshold | 阈值，性能测试的通过/失败标准 |
| Check | 检查点，对响应值的布尔验证 |
| Scenario | 场景，一组具有独立配置的测试执行 |
| Executor | 执行器，控制 VU 起停模式的算法 |
| P95 | 第 95 百分位延迟，95% 的请求在此时间内完成 |
| Ramp-up | 渐进式启动，VU 数量逐渐增加到目标值 |
| Soak Test | 浸泡测试，长时间运行的稳定性测试 |
| Baseline | 基线，作为对比参照的性能数据集 |
| Regression | 回退/退化，性能指标相对基线的负面变化 |

### D. 文件清单

| 文件路径 | 用途 | 状态 |
|----------|------|------|
| `docs/PERFORMANCE_BENCHMARK_SUITE.md` | 设计文档（本文件） | ✅ 已创建 |
| `tests/performance/smoke.js` | 冒烟测试脚本 | ✅ 已创建 |
| `tests/performance/load.js` | 标准负载测试脚本 | ✅ 已创建 |
| `tests/performance/stress.js` | 压力测试脚本 | ✅ 已创建 |
| `tests/performance/spike.js` | 突发流量测试脚本 | ✅ 已创建 |
| `tests/performance/endpoints.js` | 端点逐一基准测试脚本 | ✅ 已创建 |
| `tests/performance/auth-flow.js` | 认证全链路测试脚本 | ✅ 已创建 |
| `tests/performance/email-pipeline.js` | 邮件发送流水线测试脚本 | ✅ 已创建 |
| `scripts/run-benchmark.sh` | 一键运行包装脚本 | ✅ 已创建 |
| `.github/workflows/performance.yml` | CI/CD 性能测试工作流 | ✅ 已创建 |
| `prometheus/rules/performance-alerts.yml` | 性能退化告警规则 | ✅ 已创建 |

### E. 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| v1.0.0 | 2026-06-09 | N06 Task | 初始版本，完整实现 7 类测试场景 + CI/CD + 基线框架 |

---

> **文档结束** — GlobalReach V2.0 性能基准测试套件 v1.0.0
>
> 相关文档：[CI/CD Pipeline](../.github/workflows/ci-cd.yml) | [Prometheus Rules](../prometheus/rules/business-alerts.yml) | [API Documentation](../api/routes/)
