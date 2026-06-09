# GlobalReach V2.0 — 配置验证防护网（Configuration Validation Safety Net）

> **S132 Session 文档** | 建立全面的配置文件验证机制，防止子代理产出的不兼容配置导致容器崩溃
>
> **状态**: ✅ 已实施 | **脚本**: `scripts/validate-configs.sh` | **CI**: `.github/workflows/config-validation.yml`

---

## 目录

- [第一章：事故回顾（S131 Incident Report）](#第一章事故回顾s131-incident-report)
- [第二章：防护网架构设计](#第二章防护网架构设计)
- [第三章：各组件配置规范速查表](#第三章各组件配置规范速查表)
- [第四章：版本兼容性问题数据库](#第四章版本兼容性问题数据库)
- [第五章：扩展指南](#第五章扩展指南)

---

## 第一章：事故回顾（S131 Incident Report）

### 1.1 时间线

| 时间点 | 事件 | 影响 |
|--------|------|------|
| **T0** (S130 Session) | 子代理（sub-agent）产出 AlertManager/Prometheus/Promtail/Nginx 配置文件 | 配置文件写入仓库 |
| **T+2h** | CI/CD Pipeline 通过（当时无配置验证步骤） | 错误配置被部署到生产环境 |
| **T+4h** | 运维团队发现 4 个容器进入崩溃循环（CrashLoopBackOff） | 服务降级 |
| **T+6h** | 根因定位：配置字段与运行时镜像版本不兼容 | 开始修复 |
| **T+8h** | 所有 4 个容器恢复正常运行 | 恢复完成 |

### 1.2 受影响组件清单

| # | 组件 | 镜像版本 | 问题配置文件 | 问题类型 | 崩溃原因 |
|---|------|----------|-------------|---------|---------|
| 1 | AlertManager | `prom/alertmanager:v0.32.2` | `alertmanager.yml` | 非法字段 `max_alerts_per_message` | 启动时 YAML 解析失败 → 无限重启 |
| 2 | Prometheus | `prom/prometheus:v3.12.0` | `rules/performance-alerts.yml` | 非法字段 `eval_interval` + PromQL `offset` 语法错误 | 规则加载失败 → 告警系统不可用 |
| 3 | Promtail | `grafana/promtail:3.6.8` | `promtail-config.yml` | 非法字段 `line_drop_pattern` + 不支持的 `filter` stage | 管道启动失败 → 日志收集中断 |
| 4 | Nginx | `nginx:1.31.1-alpine` | `cdn-optimizations.conf` | `location` 指令在错误上下文 + upstream 引用不存在的容器 | nginx -t 失败 → 反向代理不可用 |

### 1.3 影响评估

```
影响范围:
├── 直接影响
│   ├── 4 个容器 CrashLoopBackOff × ~8 小时
│   ├── 告警系统完全不可用（AlertManager + Prometheus Rules 双重故障）
│   └── 日志收集中断（Promtail 故障）
├── 间接影响
│   ├── 监控面板 Grafana 数据空白
│   ├── 无法接收任何告警通知（邮件/Webhook）
│   └── 运维团队手动巡检替代自动化告警
└── 潜在风险
    ├── 安全事件无法及时感知
    └── 性能退化无法自动检测
```

### 1.4 根因分析（5 Whys）

```
Why 1: 为什么 4 个容器崩溃循环？
  → 因为配置文件包含与当前运行时版本不兼容的字段和语法

Why 2: 为什么不兼容的配置会被部署？
  → 因为 CI/CD Pipeline 中没有配置验证步骤，代码合并后直接构建部署

Why 3: 为什么没有配置验证步骤？
  → 因为之前依赖人工审查，S130 引入了 AI 子代理但未建立自动化验证

Why 4: 为什么 AI 子代理会产生不兼容配置？
  → 因为子代理的训练数据可能包含旧版本文档或不同版本的示例配置

Why 5: 如何从根本上防止？
  → 建立多层配置验证防护网：开发时 + CI/CD + 部署前
```

### 1.5 经验教训

| 编号 | 教训 | 改进措施 |
|------|------|---------|
| L1 | **AI 生成的配置不能盲目信任** | 必须经过自动化验证 |
| L2 | **版本锁定必须与配置同步** | 升级组件时必须验证所有相关配置 |
| L3 | **CI 应该是最后一道防线** | 不能只依赖开发时的审查 |
| L4 | **崩溃循环的影响时间过长** | 需要更快的检测和回滚机制 |
| L5 | **配置变更应该有独立的审批流程** | 配置文件的 PR 需要专门的 reviewer |

---

## 第二章：防护网架构设计

### 2.1 三层防御模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    GlobalReach 配置验证防护网                      │
├─────────────┬───────────────────┬───────────────────────────────┤
│   L1 开发时  │    L2 CI/CD       │      L3 部署前                 │
│  IDE/Hook   │   Pipeline Gate   │  Pre-deploy Check              │
├─────────────┼───────────────────┼───────────────────────────────┤
│             │                   │                               │
│  pre-commit │   GitHub Actions  │  docker compose config         │
│  hook 触发  │   config-val job │  --dry-run / validate          │
│             │   (PR gate)       │                               │
│  本地全量    │   全量+增量检查   │  最终一致性校验                  │
│  快速反馈    │   阻断式门禁      │  生产环境模拟                    │
│             │                   │                               │
│  ~30秒      │   ~2分钟          │  ~1分钟                        │
│             │                   │                               │
└─────────────┴───────────────────┴───────────────────────────────┘
```

#### L1: 开发时验证层（Development-Time）

**目标**: 在开发者提交前就捕获问题，提供最快的反馈循环。

**实现方式**:
- Git pre-commit hook 调用 `validate-configs.sh`
- IDE 插件集成（VS Code Task / lint-staged）
- 本地 `npm run validate-configs` 或 `make check-configs`

**触发条件**:
- 每次 `git commit` 自动触发
- 保存配置文件时触发（IDE watch mode）

**检查内容**:
- 全部 A-F 类检查项（见下方矩阵）
- 不依赖 Docker daemon（纯静态分析）
- 支持 `--fix` 自动修复模式

**优势**:
- 反馈最快（< 30 秒）
- 开发者无需等待 CI
- 减少无效 PR 提交

**限制**:
- 可被绕过（`--no-verify`）
- 依赖本地环境（Python for YAML 解析）

#### L2: CI/CD 验证层（Pipeline Gate）

**目标**: 作为 PR 合并的强制门禁，确保合入 main 的配置全部合法。

**实现方式**:
- `.github/workflows/config-validation.yml`
- 在现有 `ci-cd.yml` 的 quality-gate 之后运行
- 作为 required check 保护 main 分支

**触发条件**:
- Push 到 main 分支且路径匹配配置文件
- Pull Request 且路径匹配配置文件
- 手动 `workflow_dispatch`

**检查内容**:
- 全量 A-F 类检查项
- 额外：`nginx -t` 容器内实际测试
- JSON 格式输出用于后续处理

**优势**:
- 不可绕过（required status check）
- 环境标准化（ubuntu-latest）
- 结果可追溯（GitHub Actions log）

**限制**:
- 反馈较慢（~2 分钟）
- 无法覆盖本地特殊环境

#### L3: 部署前验证层（Pre-Deploy）

**目标**: 在实际部署前的最后一步确认，防止 CI 环境与生产环境的差异导致的问题。

**实现方式**:
- 在 deploy job 中添加前置步骤
- 使用 `docker compose config` 验证最终组合后的配置
- 可选：staging 环境预部署验证

**触发条件**:
- 每次 `docker compose up -d` 前
- CI deploy job 的第一步

**检查内容**:
- Docker Compose 最终配置解析
- Volume 路径存在性（生产服务器上）
- 端口占用检查
- 依赖服务健康状态

**优势**:
- 最接近真实运行环境
- 能发现环境特定问题

**限制**:
- 需要 Docker daemon
- 需要生产环境访问权限

### 2.2 各层检查内容矩阵

| 检查项 | L1 开发时 | L2 CI/CD | L3 部署前 | 方法 |
|--------|:---------:|:--------:|:---------:|------|
| **A. Docker Compose 配置** | | | | |
| compose config 语法 | ✅ | ✅ | ✅ | `docker compose config` |
| 服务名引用完整性 | ✅ | ✅ | ✅ | 静态分析 + grep |
| Volume 路径存在性 | ⚠️ | ✅ | ✅ | `test -d` |
| 端口冲突检测 | ✅ | ✅ | ✅ | 排序 + uniq |
| **B. Nginx 配置** | | | | |
| location 上下文合法性 | ✅ | ✅ | ✅ | 花括号深度追踪 |
| upstream 引用可解析 | ✅ | ✅ | ✅ | 交叉引用检查 |
| SSL 证书路径 | ⚠️ | ⚠️ | ✅ | `test -f` |
| 已弃用指令警告 | ✅ | ✅ | ✅ | 正则黑名单 |
| nginx -t 实际测试 | ❌ | ✅ | ✅ | 容器内执行 |
| **C. AlertManager 配置** | | | | |
| YAML 语法 | ✅ | ✅ | ✅ | Python PyYAML |
| 非法字段黑名单 | ✅ | ✅ | ✅ | 版本化黑名单 |
| bearer_token 格式 | ✅ | ✅ | ✅ | 正则验证 |
| Route Tree 完整性 | ✅ | ✅ | ✅ | Python 结构遍历 |
| **D. Prometheus 规则** | | | | |
| YAML 语法 | ✅ | ✅ | ✅ | Python PyYAML |
| eval_interval 非法字段 | ✅ | ✅ | ✅ | 正则检测 |
| PromQL 向量选择器 | ✅ | ✅ | ✅ | 正则 + Python |
| offset 位置正确性 | ✅ | ✅ | ✅ | 正则检测 |
| 括号匹配 | ✅ | ✅ | ✅ | 栈算法 |
| for: duration 格式 | ✅ | ✅ | ✅ | 正则验证 |
| labels/annotations 完整 | ✅ | ✅ | ✅ | Python 结构检查 |
| **E. Promtail/Loki 配置** | | | | |
| YAML 语法 | ✅ | ✅ | ✅ | Python PyYAML |
| pipeline stages 白名单 | ✅ | ✅ | ✅ | 类型名比对 |
| filter stage 检测 | ✅ | ✅ | ✅ | 关键字搜索 |
| line_drop_pattern 检测 | ✅ | ✅ | ✅ | 关键字搜索 |
| Docker SD filters 语法 | ✅ | ✅ | ✅ | AWK 结构分析 |
| **F. PostgreSQL/Redis** | | | | |
| 自定义 conf 语法 | ✅ | ✅ | ✅ | 基本 INI/GUC 格式 |

图例: ✅ = 执行 | ⚠️ = 部分执行（仅警告） | ❌ = 不执行

### 2.3 误报 / 漏报权衡策略

#### 误报控制（False Positive Reduction）

误报会导致"狼来了"效应，开发者逐渐忽略验证结果。控制策略：

1. **分级严重性**: 区分 ERROR / WARN / INFO，只有 ERROR 阻断合并
2. **上下文感知**: SSL 证书路径不存在是 WARN 不是 FAIL（可能还未签发）
3. **白名单机制**: 特殊配置可以通过注释标记跳过检查：
   ```yaml
   # @validate-skip: eval_interval intentionally added for future compatibility
   eval_interval: 30s
   ```
4. **渐进式严格**: 新项目初期宽松，随着稳定度提高逐步收紧

#### 漏报控制（False Negative Prevention）

漏报是真正的危险——问题逃逸到生产。预防策略：

1. **版本化数据库**: 维护已知问题数据库（第四章），持续更新
2. **社区跟踪**: 订阅上游 release notes 和 breaking changes
3. **模糊测试**: 对配置文件进行随机变异测试（未来增强）
4. **生产反馈闭环**: 从生产事故反哺验证规则

#### 权衡决策树

```
新规则是否添加？
│
├─ 是否能防止已知的生产事故？
│  └─ 是 → 添加为 ERROR 级别
│
├─ 是否来自官方 breaking change 文档？
│  └─ 是 → 添加为 ERROR 级别
│
├─ 是否是最佳实践建议？
│  └─ 是 → 添加为 WARN 级别
│
└─ 是否是风格偏好？
   └─ 是 → 不添加（或作为 INFO）
```

---

## 第三章：各组件配置规范速查表

### 3.1 AlertManager v0.32.x 合法字段白名单

> 基于 [AlertManager v0.32.x 官方文档](https://prometheus.io/docs/alerting/latest/configuration/)

#### 全局配置 (`global:`)

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `resolve_timeout` | duration | ✅ | 告警自动 resolved 的等待时间 |
| `smtp_smarthost` | string | ❌ | SMTP 服务器地址 |
| `smtp_from` | string | ❌ | 发件人地址 |
| `smtp_hello` | string | ❌ | SMTP HELO 主机名 |
| `smtp_auth_username` | string | ❌ | SMTP 认证用户名 |
| `smtp_auth_password` | string | ❌ | SMTP 认证密码 |
| `smtp_require_tls` | bool | ❌ | 是否要求 TLS |

#### 抑制规则 (`inhibit_rules:`)

每个条目：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `source_match` | map[string]string | ❌ | 源告警标签匹配 |
| `source_match_re` | map[string]string | ❌ | 源告警标签正则匹配 |
| `target_match` | map[string]string | ❌ | 目标告警标签匹配 |
| `target_match_re` | map[string]string | ❌ | 目标告警标签正则匹配 |
| `equal` | []string | ❌ | 必须相等的标签列表 |

#### 接收器 (`receivers:`)

##### email_configs

| 字段 | 类型 | 说明 |
|------|------|------|
| `to` | string | 收件人 |
| `from` | string | 发件人 |
| `smarthost` | string | SMTP 服务器 |
| `auth_username` | string | 认证用户名 |
| `auth_password` | string | 认证密码 |
| `require_tls` | bool | TLS 要求 |
| `send_resolved` | bool | 是否发送 resolved 通知 |
| `html` | string | HTML 模板 |

##### webhook_configs

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | Webhook URL |
| `send_resolved` | bool | 是否发送 resolved |
| `http_config` | object | HTTP 配置 |
| `http_config.bearer_token` | string | Bearer Token（支持 `${VAR}` 引用） |

#### 路由树 (`route:`)

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `receiver` | string | ✅ | 默认接收器名称 |
| `group_by` | []string | ❌ | 分组标签 |
| `group_wait` | duration | ❌ | 初始等待时间 |
| `group_interval` | duration | ❌ | 组内发送间隔 |
| `repeat_interval` | duration | ❌ | 重复发送间隔 |
| `routes` | []Route | ❌ | 子路由列表 |
| `matchers` | []string | ❌ | 匹配器（v0.26+ 语法） |
| `continue` | bool | ❌ | 匹配后是否继续 |
| `mute_time_intervals` | []string | ❌ | 静默时间段 |
| `active_time_intervals` | []string | ❌ | 活跃时间段 |

#### ⚠️ 非法字段黑名单（v0.32.x）

以下字段在 v0.32.x 中**不存在**，如果出现说明配置来源错误：

| 非法字段 | 可能来源 | 正确做法 |
|----------|---------|---------|
| `max_alerts_per_message` | 旧版文档/幻觉 | 移除此字段 |
| `max_alerts` | 旧版文档 | 移除此字段 |
| `resolve_message_max_size` | 未来版本? | 移除此字段 |
| `slack_api_url` (在 slack_configs 外) | 上下文错误 | 放入 `slack_configs` 内 |

### 3.2 Prometheus Rule Group 合法字段

> 基于 [Prometheus v2.x/v3.x 官方文档](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)

#### Rule Group 结构

```yaml
groups:
  - name: <string>           # ✅ 必填：分组名称
    interval: <duration>     # ✅ 推荐：规则评估间隔（如 60s）
    # ❌ 以下字段非法：
    # eval_interval: <duration>   ← 不存在于 rulefmt.RuleGroup
    # limit: <int>               ← 仅适用于某些旧版/ forks
    rules:
      - alert: <string>       # 告警规则名称（与 record 二选一）
        expr: <string>        # ✅ 必填：PromQL 表达式
        for: <duration>       # 持续时间阈值
        labels:               # ✅ 推荐：附加标签
          severity: <string>
          team: <string>
        annotations:          # ✅ 推荐：注解信息
          summary: <string>
          description: <string>

      - record: <string>      # 记录规则名称（与 alert 二选一）
        expr: <string>        # ✅ 必填：PromQL 表达式
        labels:               # 附加标签
```

#### PromQL 表达式语法要点

**向量选择器格式**:

```promql
# ✅ 正确：rate() 必须带 [duration]
rate(http_requests_total[5m])
increase(cpu_usage[1h])
irate(errors[5m])

# ❌ 错误：缺少 [duration]
rate(http_requests_total)
increase(cpu_usage)

# ✅ 正确：offset 在 [duration] 之后
rate(http_requests_total[5m] offset 1h)

# ❌ 错误：offset 位置不对
rate(http_requests_total[offset 1h][5m])  # 语法错误
rate(http_requests_total[5m] offset 1h     # 缺少闭合 ]
```

**`for:` duration 合法格式**:

```
✅ 15m, 1h, 30s, 6h, 24h, 7d, 4w
❌ 15, 1hour, 30sec, "15m", 15 m
```

### 3.3 Promtail Pipeline Stages 完整列表

> 基于 [Grafana Promtail 官方文档](https://grafana.com/docs/loki/latest/send-data/promtail/pipelines/)

#### Stage 类型白名单（按适用版本）

| Stage 类型 | Promtail 2.9.x | Promtail 3.x | 用途 |
|-----------|:--------------:|:------------:|------|
| **multiline** | ✅ | ✅ | 多行日志合并（Node.js stack traces） |
| **json** | ✅ | ✅ | JSON 日志解析 |
| **timestamp** | ✅ | ✅ | 时间戳提取与设置 |
| **labels** | ✅ | ✅ | 动态标签提取 |
| **metrics** | ✅ | ✅ | 指标提取（Counter/Gauge/Histogram） |
| **drop** | ✅ | ✅ | 条件丢弃日志行 |
| **output** | ✅ | ✅ | 输出阶段（修改最终输出） |
| **regex** | ✅ | ✅ | 正则表达式提取 |
| **match** | ✅ | ✅ | 条件匹配分支 |
| **template** | ✅ | ✅ | Go 模板转换 |
| **limit** | ✅ | ✅ | 速率限制 |
| **replace** | ✅ | ✅ | 内容替换 |
| **tenant** | ✅ | ✅ | 多租户 ID 设置 |
| **pack** | ✅ | ✅ | 日志打包 |
| **unpack** | ✅ | ✅ | 日志解包 |
| **❌ filter** | ❌ | ❌ | **不支持！请使用 drop 替代** |

#### ⚠️ Promtail 配置非法字段

| 非法字段 | 所在位置 | 问题 | 修复方案 |
|----------|---------|------|---------|
| `line_drop_pattern` | `limits_config` | 3.x 中不存在 | 移除 |
| `filter` | `pipeline_stages` | 不支持此 stage | 替换为 `drop` stage |
| `target` | `clients` | URL 格式变化 | 使用 `url` 字段 |

#### Docker SD Config Filters 语法

```yaml
docker_sd_configs:
  - host: unix:///var/run/docker.sock
    refresh_interval: 15s
    filters:
      - name: name          # ✅ 过滤器属性名
        values:             # ✅ 属性值列表
          - globalreach-*   # ✅ Glob 模式
```

**合法过滤器属性名**:
- `name` — 容器名称
- `label:<key>` — 容器标签
- `status` — 容器状态 (running, exited, etc.)

### 3.4 Nginx 指令上下文规则

> 基于 [NGINX 官方文档](https://nginx.org/en/docs/)

#### 指令上下文映射表

| 指令 | 合法上下文 | 说明 |
|------|-----------|------|
| `location` | `server`, `http`, `location` | ❌ 不能裸露在顶级 |
| `upstream` | `http` | ❌ 不能在 `server` 内 |
| `server` | `http` | ❌ 不能嵌套 |
| `listen` | `server` | 定义监听端口 |
| `server_name` | `server` | 定义虚拟主机 |
| `proxy_pass` | `location`, `if in location`, `limit_except` | 反向代理目标 |
| `root` | `http`, `server`, `location`, `if in location` | 文档根目录 |
| `ssl_certificate` | `server` | SSL 证书路径 |
| `add_header` | `http`, `server`, `location`, `if in location` | 响应头 |

#### 已弃用指令升级指南

| 弃用写法 | 版本 | 推荐写法 | 说明 |
|---------|------|---------|------|
| `listen 443 ssl http2;` | NGINX 1.25+ | `listen 443 ssl;` | HTTP/2 自动协议协商 |
| `listen 80 http2;` | NGINX 1.25+ | `listen 80;` | 明文连接不需要 http2 |
| `if ($request_uri)` | 所有版本 | 使用 `map` 或精确 `location` | if is evil |
| `proxy_set_header Connection "";` | — | 保持不变 | WebSocket 支持需要 |

#### Location 指令嵌套规则

```
http {                          ← Level 0
    server {                     ← Level 1
        location / {            ← Level 2 ✅
            location /api {     ← Level 3 ✅ (嵌套 location)
            }
        }
    }
    # location / { ... }        ← Level 1 ❌ 错误! 不在 server 内
}
```

### 3.5 Docker Compose 服务依赖规则

#### 服务间通信方式

| 场景 | 推荐方式 | 示例 |
|------|---------|------|
| 同 Compose 文件内 | 服务名作为主机名 | `postgres:5432` |
| 跨 Compose 文件 | external network + container_name | `globalreach-postgres:5432` |
| 外部服务 | DNS 名称或 IP | `smtp.qq.com:465` |

#### depends_on 最佳实践

```yaml
# ✅ 推荐：使用 condition: service_started
depends_on:
  postgres:
    condition: service_started     # 只等进程启动

# ✅ 推荐：健康检查依赖
depends_on:
  postgres:
    condition: service_healthy     # 等健康检查通过（需定义 healthcheck）

# ⚠️ 短格式（legacy）
depends_on:
  - postgres                       # 仅等容器创建，不等于服务可用
```

#### Volume Mount 路径规范

```yaml
# ✅ 相对路径（相对于 compose 文件）
- ./nginx/conf.d:/etc/nginx/conf.d:ro

# ✅ 命名卷
- postgres_data:/var/lib/postgresql/data

# ✅ bind mount（绝对路径）
- /var/run/docker.sock:/var/run/docker.sock:ro

# ⚠️ 注意：宿主机路径必须在部署服务器上存在
```

---

## 第四章：版本兼容性问题数据库

> 本数据库记录所有已发现的配置与运行时版本不兼容问题。
> 每个条目包含完整的诊断信息和修复方案。

### 4.1 数据库 Schema

| 字段 | 类型 | 说明 |
|------|------|------|
| ID | string | 唯一标识符 (COMPAT-XXX) |
| Component | string | 受影响组件 |
| Version | string | 发现问题的运行时版本 |
| Invalid Field/Syntax | string | 非法的字段或语法 |
| Correct Form | string | 正确的写法 |
| Discovery Session | string | 发现该问题的 Session 编号 |
| Status | string | open / fixed / wonfix / deprecated |
| Severity | string | critical / high / medium / low |
| Reference | string | 官方文档链接 |

### 4.2 已知问题条目

#### COMPAT-001: AlertManager max_alerts_per_message

| 字段 | 值 |
|------|-----|
| **ID** | COMPAT-001 |
| **Component** | AlertManager |
| **Version** | v0.32.2 |
| **Invalid Field/Syntax** | `max_alerts_per_message: 0` 出现在全局配置中 |
| **Correct Form** | 移除此字段；AlertManager v0.32.x 不支持此字段。如需限制消息数量，使用 `route.group_by` 控制聚合粒度 |
| **Discovery Session** | S131 |
| **Status** | ✅ fixed (S131) |
| **Severity** | 🔴 critical |
| **Reference** | https://prometheus.io/docs/alerting/latest/configuration/#configuration-file |

**详情**:
此字段可能是从某个旧版本文档或 AI 训练数据中引入的错误配置。在 AlertManager v0.27+ 中，该字段已被移除。当 AlertManager 启动时遇到未知字段会直接拒绝整个配置文件，导致 CrashLoopBackOff。

**检测方法**:
```bash
# validate-configs.sh 中的检测逻辑
grep -n 'max_alerts_per_message' alertmanager/alertmanager.yml
```

**根因分类**: AI 幻觉 / 旧文档污染

---

#### COMPAT-002: Prometheus eval_interval 非法字段

| 字段 | 值 |
|------|-----|
| **ID** | COMPAT-002 |
| **Component** | Prometheus |
| **Version** | v3.12.0 |
| **Invalid Field/Syntax** | `eval_interval: 30s` 出现在 rule group 级别 |
| **Correct Form** | 移除 `eval_interval`，仅保留 `interval` 字段。Rule Group 只有一个评估间隔字段 |
| **Discovery Session** | S131 |
| **Status** | ✅ fixed (S131) |
| **Severity** | 🔴 critical |
| **Reference** | https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/#rule-group |

**详情**:
Prometheus 的 rulefmt.RuleGroup 结构体中只有 `interval` 字段，没有 `eval_interval`。这可能是与其他监控系统（如 Victoria Metrics 或 Thanos ruler）的配置混淆所致。

**影响范围**: 包含此字段的 rule group 将完全无法加载，导致该 group 下所有告警/记录规则失效。

---

#### COMPAT-003: PromQL offset 语法错误

| 字段 | 值 |
|------|-----|
| **ID** | COMPAT-003 |
| **Component** | Prometheus |
| **Version** | v3.12.0 |
| **Invalid Field/Syntax** | `offset X][Y]` — offset 出现在 `[duration]` 之前或之间 |
| **Correct Form** | `selector[duration] offset X` — offset 必须紧跟在 `[duration]` 之后 |
| **Discovery Session** | S131 |
| **Status** | ✅ fixed (S131) |
| **Severity** | 🟠 high |
| **Reference** | https://prometheus.io/docs/prometheus/latest/querying/operators/#offset-modifier |

**正确的 PromQL offset 语法**:
```promql
# ✅ 正确
rate(http_requests_total[5m] offset 1h)

# ❌ 错误的各种形式
rate(http_requests_total[offset 1h][5m])   # offset 在 [ ] 之前
rate(http_requests_total[5m offset 1h])    # offset 在 [ ] 内部
rate(http_requests_total[5m]) offset 1h    # offset 在 ] 之后缺少空格
```

---

#### COMPAT-004: Promtail line_drop_pattern 非法字段

| 字段 | 值 |
|------|-----|
| **ID** | COMPAT-004 |
| **Component** | Promtail |
| **Version** | 3.6.8 |
| **Invalid Field/Syntax** | `line_drop_pattern: '.*debug.*'` 出现在 `limits_config` 中 |
| **Correct Form** | 移除此字段。如需丢弃日志行，使用 pipeline_stages 中的 `drop` stage |
| **Discovery Session** | S131 |
| **Status** | ✅ fixed (S131) |
| **Severity** | 🔴 critical |
| **Reference** | https://grafana.com/docs/loki/latest/send-data/promtail/stages/drop/ |

**替换方案**:
```yaml
# ❌ 旧写法（不兼容）
limits_config:
  line_drop_pattern: '.*debug.*'

# ✅ 新写法（兼容 Promtail 3.x）
pipeline_stages:
  - drop:
      source: output
      expr: '.level == "debug"'
      drop_counter_reason: "debug_filter"
```

---

#### COMPAT-005: Promtail filter stage 不支持

| 字段 | 值 |
|------|-----|
| **ID** | COMPAT-005 |
| **Component** | Promtail |
| **Version** | 3.6.8 |
| **Invalid Field/Syntax** | `- filter: { ... }` 出现在 pipeline_stages 中 |
| **Correct Form** | 使用 `drop` stage 替代 `filter` stage。Promtail 从未支持名为 `filter` 的 stage 类型 |
| **Discovery Session** | S131 |
| **Status** | ✅ fixed (S131) |
| **Severity** | 🔴 critical |
| **Reference** | https://grafana.com/docs/loki/latest/send-data/promtail/pipelines/ |

**注意**: `filter` 这个名字容易让人误解。在 Promtail 中，过滤/丢弃日志行的功能通过 `drop` stage 实现，而不是 `filter` stage。

---

#### COMPAT-006: Nginx location 指令上下文错误

| 字段 | 值 |
|------|-----|
| **ID** | COMPAT-006 |
| **Component** | Nginx |
| **Version** | 1.31.1-alpine |
| **Invalid Field/Syntax** | `cdn-optimizations.conf` 中包含多个 `location` 指令但没有外层 `server {}` 块包裹 |
| **Correct Form** | 方案A: 重命名为 `.snippet` 并在 server 块中 `include`；方案B: 添加 `server {}` 包装 |
| **Discovery Session** | S131 |
| **Status** | ✅ fixed (S131, renamed to .snippet) |
| **Severity** | 🟠 high |
| **Reference** | https://nginx.org/en/docs/http/ngx_http_core_module.html#location |

**Nginx 指令上下文规则**:
- `location` 指令只能出现在 `server {}`、`http {}` 或另一个 `location {}` 内部
- 如果一个 .conf 文件只包含 `location` 片段而没有 `server {}` 包裹，它应该是 `.snippet` 文件
- Nginx 加载 `conf.d/*.conf` 时，每个文件必须是完整的有效配置块

**自动修复策略** (`--fix` 模式):
```bash
# 检测到裸露的 location 指令且无 server 块 → 重命名为 .snippet
mv cdn-optimizations.conf cdn-optimizations.conf.snippet
```

---

#### COMPAT-007: Nginx HA upstream 引用不存在的容器

| 字段 | 值 |
|------|-----|
| **ID** | COMPAT-007 |
| **Component** | Nginx |
| **Version** | 1.31.1-alpine |
| **Invalid Field/Syntax** | `upstream-ha.conf.snippet` 中 `api_backend` 引用 `api-prod-01:3000` 和 `api-prod-02:3000`，但这些容器名不在 docker-compose.prod.yml 中 |
| **Correct Form** | 更新为实际存在的容器名 `globalreach-api-prod:3000`，或改为单实例模式移除 upstream |
| **Discovery Session** | S131 |
| **Status** | ⚠️ open (HA 架构尚未实施) |
| **Severity** | 🟡 medium |
| **Reference** | docs/HIGH_AVAILABILITY_ARCHITECTURE.md |

**说明**: 此文件是 HA 架构设计的预留配置（snippet），当前不会生效因为它是 `.snippet` 文件不会被 Nginx 直接加载。但在实施 HA 时需要修正。

---

### 4.3 问题统计概览

```
GlobalReach 版本兼容性问题统计
═══════════════════════════════════════════════
总问题数:     7
已修复:        6 (85.7%)
待处理:        1 (14.3%)  ← COMPAT-007 (HA 预留)

按严重程度:
  🔴 Critical: 4  (COMPAT-001, 002, 004, 005)
  🟠 High:     2  (COMPAT-003, 006)
  🟡 Medium:   1  (COMPAT-007)

按组件分布:
  AlertManager: 1
  Prometheus:   2
  Promtail:     2
  Nginx:        2

发现 Session:
  S131: 7 (100%)
═══════════════════════════════════════════════
```

---

## 第五章：扩展指南

### 5.1 为新组件添加验证规则

当 GlobalReach 项目引入新的基础设施组件时，需要按照以下步骤为其添加验证规则：

#### Step 1: 创建验证函数

在 `scripts/validate-configs.sh` 中添加新的函数：

```bash
# 示例：为新组件 "tempo" 添加验证
check_tempo() {
    if [ -n "$TARGET_SERVICE" ] && [ "$TARGET_SERVICE" != "tempo" ]; then
        return 0
    fi

    local category="[Tempo]"
    local tempo_config="$PROJECT_ROOT/tempo/tempo-config.yml"
    local errors=0 warnings=0

    echo ""
    echo -e "${BOLD}${category}${NC}"

    if [ ! -f "$tempo_config" ]; then
        log_warn "tempo-config.yml 不存在"
        add_result "Tempo" "warn" "config not found"
        return 0
    fi

    # T1. YAML 语法检查
    local yaml_result
    yaml_result=$(check_yaml_syntax "$tempo_config")
    # ... 处理逻辑 ...

    # T2. Tempo 特定字段验证
    # ... 具体的版本兼容性检查 ...
}
```

#### Step 2: 注册到主流程

在 `main()` 函数中调用新函数：

```bash
main() {
    # ... 现有调用 ...
    check_tempo  # ← 添加这一行
}
```

#### Step 3: 更新命令行参数

如果需要支持 `--service tempo`，确保 TARGET_SERVICE 的判断逻辑覆盖新组件名。

#### Step 4: 添加测试用例

为新组件准备一组「好配置」和「坏配置」用于测试验证脚本的检测能力：

```
tests/fixtures/
├── tempo/
│   ├── good-config.yml      # 应该 PASS
│   └── bad-config.yml       # 应该 FAIL
```

### 5.2 更新版本兼容性数据库

当发现新的兼容性问题时，按以下流程更新数据库：

#### 流程图

```
发现问题
  │
  ├─ 1. 确认问题（复现 + 定位根因）
  │     ├─ 记录受影响的组件和版本
  │     ├─ 记录具体的非法字段/语法
  │     └─ 查阅官方文档确认正确写法
  │
  ├─ 2. 分配 ID (COMPAT-NNN)
  │     ├─ 查看第四章数据库获取下一个可用编号
  │     └─ 格式: COMPAT-三位数字
  │
  ├─ 3. 更新 validate-configs.sh
  │     ├─ 添加检测逻辑（黑名单/正则/Python 检查）
  │     ├─ 添加 auto-fix 逻辑（如果可行）
  │     └─ 测试：确保能检测到问题
  │
  ├─ 4. 更新本章数据库条目
  │     ├─ 填写完整表格
  │     ├─ 包含详情和参考链接
  │     └─ 更新统计概览
  │
  ├─ 5. 提交代码
  │     └─ Commit message: fix(config-validator): Add detection for COMPAT-NNN
  │
  └─ 6. （可选）发布公告
        └─ 通知团队成员此问题已被防护网覆盖
```

#### 检测逻辑模板

对于每种类型的兼容性问题，推荐使用以下检测策略：

| 问题类型 | 推荐检测方法 | 代码位置 |
|---------|-------------|---------|
| 非法字段 | `grep -n 'field_name' config_file` | 各 check_* 函数 |
| 非法值 | `grep -P 'field:\s*bad_value'` | 同上 |
| 语法错误 | Python AST/正则解析 | Python inline script |
| 结构缺失 | Python YAML 遍历 | Python inline script |
| 上下文错误 | 花括号深度追踪算法 | 纯 Bash |
| 引用缺失 | 交叉引用检查 | 纯 Bash + grep |

### 5.3 与 `docker compose config` 的关系说明

`docker compose config` 是 Docker Compose 提供的原生验证工具，我们的脚本与其关系如下：

#### 互补关系

```
┌─────────────────────────────────────────────────────┐
│              配置验证能力对比                         │
├──────────────────────┬──────────────────────────────┤
│  docker compose config │  validate-configs.sh        │
├──────────────────────┼──────────────────────────────┤
│ ✓ Compose 文件语法    │ ✓ Compose 文件语法（委托）   │
│ ✓ 变量展开            │ ✗ 变量展开（原始文件检查）    │
│ ✓ 服务依赖图          │ ✓ 服务依赖图 + 引用完整性     │
│ ✗ Nginx 配置          │ ✓ Nginx 配置深度验证         │
│ ✗ AlertManager        │ ✓ AlertManager 字段验证      │
│ ✗ Prometheus 规则      │ ✓ PromQL 语法检查           │
│ ✗ Promtail/Loki       │ ✓ Pipeline stages 验证      │
│ ✗ 版本兼容性          │ ✓ 版本兼容性数据库           │
│ ✗ 自动修复            │ ✓ --fix 自动修复            │
│ ✗ CI JSON 输出        │ ✓ --ci JSON 输出            │
└──────────────────────┴──────────────────────────────┘
```

#### 使用建议

1. **日常开发**: 使用 `validate-configs.sh`（更快、更全面）
2. **部署前**: 先运行 `validate-configs.sh`，再运行 `docker compose config` 作为双重确认
3. **CI 环境**: 两者都运行（config-validation.yml 中已包含）

#### 已知局限

`docker compose config` 的局限性：
- 只验证 Compose 文件本身，不验证挂载的配置文件内容
- 需要 Docker daemon 运行
- 变量展开后可能掩盖原始文件中的错误
- 不提供版本兼容性检查

我们的脚本弥补了这些不足。

### 5.4 性能优化建议

当前脚本在全量检查模式下约需 10-30 秒（取决于文件数量）。优化方向：

1. **并行化**: 各组件检查相互独立，可使用 `&` 后台并行执行
2. **缓存**: 对未变更的文件跳过检查（基于 git diff）
3. **增量模式**: 只检查 git staged 的文件
4. **编译型语言**: 如性能成为瓶颈，可考虑用 Go 重写核心逻辑

```bash
# 并行化示例（未来优化方向）
check_all_parallel() {
    check_docker_compose &
    check_nginx &
    check_alertmanager &
    check_prometheus &
    check_promtail_loki &
    check_postgres_redis &
    wait
}
```

### 5.5 故障排查指南

#### 常见问题

| 现象 | 原因 | 解决方案 |
|------|------|---------|
| YAML 检查 SKIP | 未安装 Python | `apt install python3-yaml` 或 `pip install pyyaml` |
| Docker 检查 SKIP | Docker 未安装/未运行 | 跳过正常，CI 环境会有 Docker |
| 误报过多 | 规则过于严格 | 检查是否需要调整为 WARN 级别 |
| 检测不到已知问题 | 黑名单未更新 | 参考 5.2 节更新数据库 |
| Windows 换行符问题 | CRLF vs LF | `git config core.autocrlf input` |

#### Debug 模式

```bash
# 启用详细输出
DEBUG=1 ./scripts/validate-configs.sh --service prometheus

# 只看某类错误
./scripts/validate-configs.sh --ci 2>&1 | grep "FAIL"
```

---

## 附录

### A. 快速参考卡片

```bash
# 全量验证
./scripts/validate-configs.sh

# 只检查 Nginx
./scripts/validate-configs.sh --service nginx

# 自动修复 + CI 输出
./scripts/validate-configs.sh --fix --ci

# Pre-commit hook 安装
ln -s ../../scripts/validate-configs.sh .git/hooks/pre-commit
```

### B. 退出码速查

| Code | 含义 | CI 行为 |
|:----:|------|---------|
| 0 | 全部通过 | ✅ PR 可以合并 |
| 1 | 有失败项 | 🔴 阻断合并，需要修复 |
| 2 | 内部错误 | 🟡 检查环境和依赖 |

### C. 文件清单

| 文件 | 用途 | 行数（约） |
|------|------|-----------|
| `scripts/validate-configs.sh` | 核心验证脚本 | ~650 |
| `.github/workflows/config-validation.yml` | CI/CD 工作流 | ~170 |
| `docs/CONFIG_VALIDATION_SAFETY_NET.md` | 本文档 | ~900 |

### D. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-06-09 (S132) | 初始版本，覆盖 6 大类检查项，收录 7 个已知兼容性问题 |

---

*本文档由 S132 Session 生成，作为 GlobalReach V2.0 配置验证防护网的权威参考。*
