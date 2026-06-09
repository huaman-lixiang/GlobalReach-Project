# GlobalReach V2.0 Loki LogQL 查询手册

> **版本**: 2.0 (M-B03 增强)
> **更新日期**: 2026-06-09
> **适用环境**: GlobalReach 生产/预发布环境
> **Loki 端口**: 3100
> **数据源**: Promtail + Docker 服务发现

---

## 📋 目录

1. [快速入门](#-快速入门)
2. [错误排查](#-错误排查)
3. [性能分析](#-性能分析)
4. [安全审计](#-安全审计)
5. [业务监控](#-业务监控)
6. [高级查询技巧](#-高级查询技巧)
7. [常用聚合函数](#-常用聚合函数)
8. [Dashboard 面板查询参考](#-dashboard-面板查询参考)

---

## 🚀 快速入门

### 基础查询语法

```logql
# 查询所有日志
{job="globalreach-containers"}

# 按容器过滤
{container_name="globalreach-api-prod"}

# 文本搜索
{container_name=~"globalreach-.*"} |= "error"

# JSON 字段过滤（Promtail 已解析）
{container_name="globalreach-api-prod"} | json | level="error"

# 组合条件
{job=~".*"} |= "login" |= "failed" | json | status=401
```

### 时间范围修饰符

```logql
# 过去1小时
{...} [1h]

# 过去24小时
{...} [24h]

# 自定义时间范围
{...} [2024-01-01T00:00:00Z : 2024-01-02T00:00:00Z]
```

---

## 🔍 错误排查

### 查看最近错误日志

```logql
# 所有 ERROR 级别日志（最近1小时）
{job="globalreach-containers"} |= "error" | json | level="ERROR"

# 包含异常堆栈的错误
{container_name=~"globalreach-.*"} |= "Error:" or |= "exception" or |= "stack"

# 按时间倒序显示最新50条错误
{container_name="globalreach-api-prod"} | json | level="error" | line_format "{{.timestamp}} {{.level}}: {{.message}}"
```

### 查看特定服务的错误

```logql
# API 服务错误（HTTP 5xx）
{container_name="globalreach-api-prod"} | json | status >= 500

# 特定端点错误
{container_name="globalreach-api-prod"} | json | url =~ "/api/users.*" and status >= 400

# 按请求ID追踪完整日志流
{container_name=~"globalreach-.*"} | json | requestId="abc-123-def"
```

### 统计错误数量和趋势

```logql
# 按级别统计错误数（过去1小时）
sum by (level) (count_over_time({job=~"globalreach.*"} [1h]))

# 错误率百分比
(
  sum(rate({job=~"globalreach.*"} |= "error" or |= "warn" [5m]))
  /
  sum(rate({job=~"globalreach.*"}}[5m]))
) * 100

# Top10 最频繁的错误消息
topk(10, sum by (msg) (count_over_time({...} |= "error" | json [24h])))

# 5xx 错误趋势（按状态码分组）
sum by (status) (rate({container_name="globalreach-api-prod"} |= `5[0-9][0-9]` | json [5m]))
```

---

## ⚡ 性能分析

### 慢请求检测 (>1秒)

```logql
# 耗时超过1秒的API请求
{container_name="globalreach-api-prod"} | json | duration > 1000

# 慢请求详情（包含URL和方法）
{container_name="globalreach-api-prod"} | json | duration > 1000 | line_format "方法={{.method}} URL={{.url}} 耗时={{.duration}}ms 状态={{.status}}"

# Top10 最慢请求
topk(10, {container_name="globalreach-api-prod"} | json | duration > 500 | unwrap duration)

# P95/P99 延迟分布
histogram_quantile(0.95, sum(rate(log_lines_total_bucket{container_name="globalreach-api-prod"}[5m])))
```

### API 吞吐量和延迟

```logql
# 每分钟请求数（按方法分组）
sum by (method) (rate(api_requests_total[5m])) * 60

# HTTP 状态码分布
sum by (status) (count_over_time({container_name="globalreach-api-prod"} | json [15m]))

# 错误率按端点分组
sum by (url) (
  rate({container_name="globalreach-api-prod"} | json | status >= 400 [5m])
)

# 日志量趋势（按容器分组）
sum by (container_name) (rate({job=~"globalreach.*"} [2m]))
```

---

## 🔒 安全审计

### 登录失败监控

```logql
# 所有登录失败尝试
{job="globalreach-containers"} |= "login" |= "failed"

# 认证失败详情（包含IP和用户）
{container_name="globalreach-api-prod"} |= "login" |= "failed" or |= "401" | json | line_format "IP={{.ip}} 用户={{.user}} 时间={{.timestamp}} 原因={{.message}}"

# 按IP统计失败次数（检测暴力破解）
sum by (ip) (count_over_time({...} |= "401" or |= "failed login" [1h]))

# 使用 Promtail 提取的认证失败计数器
sum(rate(auth_failures_total[5m])) * 60
```

### 权限和访问控制

```logql
# 403 Forbidden 错误
{job="~.+"} |= "403" or |= "forbidden"

# 未授权访问尝试
{container_name=~"globalreach-.*"} |= "unauthorized" or |= "401"

# 敏感操作审计（删除、修改权限等）
{container_name="globalreach-api-prod"} | json | method="DELETE"
{container_name="globalreach-api-prod"} | json | method in ("PUT", "PATCH") and url =~ "/api/(users|roles|permissions).*"
```

### 异常行为检测

```logql
# 单IP高频请求（可能DDoS或爬虫）
topk(20, sum by (ip) (count_over_time({container_name="globalreach-api-prod"} | json [5m])))

# 非工作时间访问（需根据实际日志格式调整）
{container_name="globalreach-api-prod"} | json | timestamp >= "22:00:00" or timestamp <= "06:00:00"
```

---

## 💼 业务监控

### 邮件发送状态

```logql
# 所有邮件相关日志
{job="globalreach-containers"} |= "email"

# 发送成功 vs 失败统计
sum by (status) (count_over_time({...} |= "email" |= "sent" or |= "failed" [1h]))

# 邮件发送失败详情
{container_name=~"globalreach-.*"} |= "email" |= "failed" | json | line_format "收件人={{.to}} 错误={{.error}} 时间={{.timestamp}}"

# 邮件发送延迟
{container_name=~"globalreach-.*"} |= "email" | json | duration > 3000
```

### 用户活动监控

```logql
# 用户注册
{job="globalreach-containers"} |= "register" or |= "signup"

# 用户登录成功
{job="globalreach-containers"} |= "login" |= "success"

# 密码重置
{job="globalreach-containers"} |= "password" |= "reset"

# 活跃用户数（基于唯一用户ID）
count({container_name="globalreach-api-prod"} | json | user != "" [1h])
```

### 数据操作审计

```logql
# 数据导出
{job="globalreach-containers"} |= "export" or |= "download"

# 批量操作
{job="globalreach-containers"} |= "batch"

# 关键配置变更
{job="globalreach-containers"} |= "config" |= "update" or |= "change"
```

---

## 🎯 高级查询技巧

### 正则表达式匹配

```logql
# 匹配特定格式的ID
{...} | logfmt | requestId =~ "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"

# 匹配IP地址
{...} | logfmt | ip =~ "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}"

# 匹配HTTP方法
{...} | json | method in ("GET", "POST", "PUT", "DELETE")
```

### 日志行格式化输出

```logql
# 自定义输出格式
{...} | json | line_format "🕐 {{.timestamp}} | 🔷 {{.level}} | 👤 {{.user}} | 📍 {{.method}} {{.url}} | ⏱️ {{.duration}}ms | 📊 {{.status}}"

# 提取关键信息
{...} | json | line_format "TraceID: {{.requestId}} | Error: {{.message}} | Stack: {{.stack}}"
```

### 标签过滤和替换

```logql
# 排除特定标签值
{container_name=~"globalreach-.*"} != "healthcheck" != "/metrics"

# 标签重命名（在查询中）
label_replace({...}, "service_short", "$1", "container_name", "globalreach-(.*)")

# 解包指标进行数学运算
sum by (container_name) (rate(log_lines_total[5m]))
```

### 多条件组合

```logql
# AND 条件：同时满足多个过滤器
{...} |= "error" |= "database" | json | status >= 500

# OR 条件：满足任一即可
{...} |= "timeout" or |= "connection refused" or |= "ECONNREFUSED"

# NOT 条件：排除特定内容
{...} != "debug" != "healthcheck" | json | level != "DEBUG"
```

---

## 📊 常用聚合函数

### 时间序列聚合

```logql
# 计数（单位时间内日志条数）
count_over_time({job=~".+"} [5m])

# 速率（每秒日志条数）
rate({job=~".+"} [5m])

# 总和（累加计数器）
sum(rate(...))

# 分组聚合
sum by (level, container_name) (rate({...} [5m]))
```

### 统计函数

```logql
# Top K 最频繁项
topk(10, sum by (message) (count_over_time({...} [1h])))

# Bottom K 最不频繁项
bottomk(10, ...)

# 百分位数（需要 histogram 类型的指标）
histogram_quantile(0.95, rate(..._bucket[5m]))
```

### 数学运算

```logql
# 计算比率
(sum(rate(A[5m]))) / (sum(rate(B[5m]))) * 100

# 差异比较
sum(rate(current[5m])) - sum(rate(historical[5m] offset 1h))

# 阈值判断
{...} | json | duration > 1000 and status >= 400
```

---

## 📈 Dashboard 面板查询参考

以下查询对应 `grafana/provisioning/dashboards/globalreach-logs.json` 中的面板：

| 面板名称 | LogQL 查询 | 用途 |
|---------|-----------|------|
| **总日志量/分** | `sum(rate({job=~"globalreach.*"}[5m])) * 60` | 实时吞吐量监控 |
| **错误率 %** | `(sum(rate({...}\|= "error" or \|= "warn"[5m])) / sum(rate({...}[5m]))) * 100` | 错误占比趋势 |
| **5xx错误/分** | `sum(count_over_time({container_name="globalreach-api-prod"} \|= \`5[0-9][0-9]\` \| json [5m]))` | 服务端错误频率 |
| **异常数/分** | `sum(count_over_time({...} \|= \`exception\` or \|= \`Error:\` [5m]))` | 应用异常检测 |
| **日志量趋势** | `sum by (level)(rate({container_name=~"globalreach-.*"}[2m])) * 60` | 按级别分类趋势 |
| **错误实时流** | `{...} \|= "error" or \|= "warn" \| json` | 实时错误监控(15s刷新) |
| **Top10错误** | `topk(10, sum by (msg)(count_over_time({...} \|= "error" \| json [24h])))` | 高频错误排名 |
| **慢API请求** | `{...} \| json \| duration > 1000` | 性能瓶颈识别 |
| **认证失败** | `{...} \|= "login" \|= "failed" or \|= "401" \| json` | 安全事件追踪 |
| **邮件发送** | `sum by (status)(count_over_time({...} \|= "email" \|= "sent" or \|= "failed" [1h]))` | 业务流程监控 |
| **容器分布** | `sum by (container_name)(count_over_time({job=~"globalreach.*"}[1h]))` | 资源使用占比 |

---

## 🔧 故障排查工作流

### 场景1：用户报告系统缓慢

```logql
# Step 1: 检查是否有大量错误
sum(rate({job=~"globalreach.*"} |= "error" [5m]))

# Step 2: 查找慢请求
{container_name="globalreach-api-prod"} | json | duration > 2000 | line_format "{{.method}} {{.url}} - {{.duration}}ms"

# Step 3: 检查数据库连接问题
{container_name=~"globalreach-.*"} |= "database" |= "timeout" or |= "connection"

# Step 4: 检查资源竞争
{container_name=~"globalreach-.*"} |= "memory" or |= "heap" or |= "OOM"
```

### 场景2：收到安全告警

```logql
# Step 1: 定位可疑IP的活动
{...} | json | ip="192.168.1.100"

# Step 2: 统计该IP的请求模式
sum by (url, method) (count_over_time({...} | json | ip="192.168.1.100" [1h]))

# Step 3: 检查认证失败记录
{...} | json | ip="192.168.1.100" and status in (401, 403)

# Step 4: 追踪该用户的完整会话
{...} | json | ip="192.168.1.100" | line_format "{{.timestamp}} {{.requestId}} {{.method}} {{.url}}"
```

### 场景3：部署后验证

```logql
# Step 1: 检查启动日志是否正常
{container_name="globalreach-api-prod"} |= "started" or |= "listening" or |= "ready"

# Step 2: 监控初始错误率
sum(rate({...} |= "error" [5m])) / sum(rate({...} [5m]))

# Step 3: 验证健康检查端点
{container_name="globalreach-api-prod"} | json | url="/health" and status=200

# Step 4: 对比部署前后性能
sum(rate(api_requests_total[5m])) offset 30m vs now
```

---

## 📚 相关资源

- **Loki 官方文档**: https://grafana.com/docs/loki/latest/
- **LogQL 参考**: https://grafana.com/docs/loki/latest/logql/
- **Promtail 配置**: https://grafana.com/docs/loki/latest/clients/promtail/configuration/
- **Grafana Dashboard JSON**: `grafana/provisioning/dashboards/globalreach-logs.json`
- **Promtail 配置文件**: `loki/promtail-config.yml`
- **Loki 主配置**: `loki/loki-config.yml`

---

## 📝 更新日志

### v2.0 (M-B03 增强) - 2026-06-09
- ✅ 新增多行日志合并查询示例
- ✅ 新增 requestId 全链路追踪查询
- ✅ 新增性能分析和慢请求检测章节
- ✅ 新增安全审计和暴力破解检测
- ✅ 新增业务监控（邮件、用户活动）
- ✅ 新增 Dashboard 面板查询速查表
- ✅ 新增故障排查工作流模板
- ✅ 新增高级正则表达式技巧
- ✅ 基于 M-B03 Promtail 优化后的字段支持（requestId, duration, ip, user）

### v1.0 (初始版)
- 基础 LogQL 语法说明
- 错误查询示例
- 基础聚合函数

---

**维护者**: GlobalReach DevOps Team
**最后审查**: 2026-06-09
