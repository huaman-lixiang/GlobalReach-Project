# RB-006 Docker Compose 运行手册

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **编排工具**: Docker Compose (docker-compose.prod.yml)
> **最后更新**: 2026-06-09

---

## 1. 组件身份卡

| 属性 | 值 |
|------|-----|
| 编排文件 | docker-compose.prod.yml |
| 服务总数 | 14 个 (含 certbot profile) |
| 网络 | globalreach-network (external) |
| Compose 版本 | 兼容 Docker Compose V2 |
| 启动命令 | `docker compose -f docker-compose.prod.yml up -d` |
| 停止命令 | `docker compose -f docker-compose.prod.yml down` |
| 健康检查 | 各服务独立 healthcheck 定义 |

---

## 2. 服务依赖关系图

```
                    ┌──────────────┐
                    │    nginx     │ ← 反向代理入口
                    │  (80, 443)   │
                    └──────┬───────┘
                           │ proxy_pass
                           ▼
                    ┌──────────────┐
                    │     api      │ ← 核心业务服务
                    │   (:3000)    │
                    └──┬───────┬───┘
                       │       │
            ┌──────────┘       └──────────┐
            ▼                              ▼
    ┌──────────────┐              ┌──────────────┐
    │   postgres   │              │    redis     │
    │   (:5432)    │              │   (:6379)    │
    └──────┬───────┘              └──────────────┘
           │
           ▼
    ┌──────────────┐
    │ pg-exporter  │ ← 依赖 postgres started
    └──────────────┘

监控栈 (无强依赖, 但有逻辑关联):
    ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
    │  prometheus  │  │   grafana   │  │ alertmanager │
    │   (:9090)    │←─│  (:3002)    │  │   (:9093)    │
    └──────┬──────┘  └─────┬───────┘  └──────────────┘
           │               │
           ▼               ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ node-exporter │  │     loki     │  │    tempo     │
    └──────────────┘  └──────┬───────┘  └──────────────┘
                            │
                      ┌─────┴───────┐
                      │  promtail   │ ← 依赖 loki started
                      └─────────────┘

辅助服务:
    ┌──────────────┐
    │   mailpit    │ ← SMTP 测试 (:1025) + Web UI (:8025)
    └──────────────┘
    ┌──────────────┐
    │   certbot    │ ← SSL 证书管理 (profile: ssl, 按需启动)
    └──────────────┘
```

### 依赖关系详解 (depends_on)

| 服务 | 依赖 | 条件 |
|------|------|------|
| api | postgres | service_started |
| api | redis | service_started |
| nginx | api | service_started |
| grafana | prometheus | service_started |
| postgres-exporter | postgres | service_started |
| promtail | loki | service_started |

**注意**: `service_started` 表示仅等待容器启动（不等待 healthy），实际业务逻辑需自行处理重连。

---

## 3. 快速命令速查表

### 生命周期管理

| 操作 | 命令 |
|------|------|
| 启动全部服务 | `docker compose -f docker-compose.prod.yml up -d` |
| 停止全部服务 | `docker compose -f docker-compose.prod.yml down` |
| 停止并删除卷 | `docker compose -f docker-compose.prod.yml down -v` |
| 重启单个服务 | `docker compose -f docker-compose.prod.yml restart <service>` |
| 重启全部服务 | `docker compose -f docker-compose.prod.yml restart` |
| 平滑重启 (零停机) | `docker compose -f docker-compose.prod.yml up -d --no-deps --build <service>` |
| 强制重建 | `docker compose -f docker-compose.prod.yml up -d --force-recreate <service>` |
| 缩放 (如需多实例) | `docker compose -f docker-compose.prod.yml up -d --scale api=3` |

### 状态查看

| 操作 | 命令 |
|------|------|
| 全部服务状态 | `docker compose -f docker-compose.prod.yml ps` |
| 带资源使用 | `docker compose -f docker-compose.prod.yml ps -q \| xargs docker stats --no-stream` |
| 单个服务日志 | `docker compose -f docker-compose.prod.yml logs -f --tail=100 <service>` |
| 全部服务日志 | `docker compose -f docker-compose.prod.yml logs -f --tail=30` |
| 跨服务日志过滤 | `docker compose -f docker-compose.prod.yml logs -f 2>&1 \| grep -i error` |
| 服务详情 | `docker compose -f docker-compose.prod.yml ps <service>` |
| 端口映射 | `docker compose -f docker-compose.prod.yml ps --format "{{.Ports}}"` |

### 进入容器

| 操作 | 命令 |
|------|------|
| 进入 API 容器 | `docker exec -it globalreach-api-prod sh` |
| 进入 PG 容器 | `docker exec -it globalreach-postgres sh` |
| 进入 Redis 容器 | `docker exec -it globalreach-redis sh` |
| 进入 Nginx 容器 | `docker exec -it globalreach-nginx-prod sh` |
| Root 进入 | `docker exec -it -u root <container_name> sh` |

### 构建与镜像

| 操作 | 命令 |
|------|------|
| 构建 API 镜像 | `docker compose -f docker-compose.prod.yml build api` |
| 查看镜像列表 | `docker images \| grep globalreach` |
| 清理悬空镜像 | `docker image prune -f` |
| 查看构建历史 | `docker history globalreach-project-api:latest` |

### 网络与卷

| 操作 | 命令 |
|------|------|
| 查看网络 | `docker network ls \| grep globalreach` |
| 查看网络详情 | `docker network inspect globalreach-project_globalreach-network` |
| 查看所有卷 | `docker volume ls \| grep globalreach` |
| 查看卷大小 | `docker system df -v` |
| 清理未使用卷 | `docker volume prune -f` |

### Certbot (SSL 管理)

| 操作 | 命令 |
|------|------|
| 初次签发 | `docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot` |
| 续期 | `docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew` |
| 干跑测试 | `docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --dry-run` |
| 一键切换 LE | `bash scripts/ssl-switch-to-letsencrypt.sh` |

---

## 4. Volume 挂载映射

| Volume 名 | 宿主机路径 | 容器路径 | 用途 | 所属服务 |
|-----------|----------|---------|------|---------|
| postgres_data | (Docker managed) | /var/lib/postgresql/data | PG 数据文件 | postgres |
| redis_data | (Docker managed) | /data | Redis RDB/AOF | redis |
| nginx_logs | (Docker managed) | /var/log/nginx | Nginx 访问/错误日志 | nginx |
| prometheus_data | (Docker managed) | /prometheus | Prometheus TSDB | prometheus |
| grafana_data | (Docker managed) | /var/lib/grafana | Grafana 数据源/仪表盘/用户 | grafana |
| loki_data | (Docker managed) | /loki | Loki TSDB chunks | loki |
| promtail_positions | (Docker managed) | /tmp | Promtail 读位置 | promtail |
| tempo_data | (Docker managed) | /var/lib/tempo | Tempo trace 数据 | tempo |
| alertmanager_data | (Docker managed) | /alertmanager | AlertManager 静默/通知数据 | alertmanager |

### Bind Mounts (非 volume，直接映射)

| 宿主机路径 | 容器路径 | 权限 | 用途 |
|-----------|---------|------|------|
| ./nginx/nginx.conf | /etc/nginx/nginx.conf | ro | Nginx 主配置 |
| ./nginx/conf.d | /etc/nginx/conf.d | ro | 站点配置 |
| ./nginx/ssl/globalreach | /etc/nginx/ssl/globalreach | ro | 自签名证书 |
| ./nginx/ssl/letsencrypt | /etc/nginx/ssl/le | ro | LE 证书 |
| ./frontend/dist | /var/www/frontend/dist | ro | 前端静态文件 |
| ./docs | /usr/share/nginx/html/docs | ro | 文档站点 |
| ./nginx/acme-challenge | /var/www/acme-challenge | ro | ACME 验证 |
| ./prometheus/prometheus.yml | /etc/prometheus/prometheus.yml | ro | Prometheus 配置 |
| ./prometheus/rules | /etc/prometheus/rules | ro | 告警规则 |
| ./alertmanager/alertmanager.yml | /etc/alertmanager/alertmanager.yml | ro | AM 配置 |
| ./grafana/grafana.ini | /etc/grafana/grafana.ini | ro | Grafana 配置 |
| ./grafana/provisioning | /etc/grafana/provisioning | ro | 自动配置 |
| ./grafana/provisioning/dashboards | /var/lib/grafana/dashboards | ro | 仪表盘 JSON |
| ./grafana/provisioning/alerting | /etc/grafana/provisioning/alerting | ro | 告警规则 |
| ./loki/loki-config.yml | /etc/loki/loki-config.yml | ro | Loki 配置 |
| ./loki/promtail-config.yml | /etc/promtail/promtail-config.yml | ro | Promtail 配置 |
| ./tempo/tempo-config.yml | /etc/tempo/tempo-config.yml | ro | Tempo 配置 |
| /var/lib/docker/containers | /var/lib/docker/containers | ro | Docker 日志源 (Promtail) |
| /var/run/docker.sock | /var/run/docker.sock | ro | Docker API (Promtail, 只读) |

---

## 5. 网络隔离说明

### 网络: globalreach-network

| 属性 | 值 |
|------|-----|
| 类型 | bridge (外部创建) |
| 名称 | globalreach-project_globalreach-network |
| 隔离级别 | 容器间互通，但不暴露到宿主机（除显式 port 映射） |

### 端口暴露矩阵

| 端口 | 服务 | 对外访问 | 安全建议 |
|------|------|---------|---------|
| 80 | Nginx | ✅ 公开 | HTTP→HTTPS 重定向 |
| 443 | Nginx | ✅ 公开 | TLS 终端 |
| 3000 | API | ⚠️ 仅开发环境 | 生产通过 Nginx 访问 |
| 3002 | Grafana | ⚠️ 内网 | 生产通过 Nginx+BasicAuth 访问 |
| 3100 | Loki | ❌ 不暴露 | 仅容器内部 |
| 3200 | Tempo | ⚠️ 内网调试 | 可选关闭 |
| 4317/4318 | Tempo OTLP | ⚠️ 内网 | 接收 trace 数据 |
| 8025 | Mailpit | ⚠️ 开发/测试 | SMTP 测试用 |
| 1025 | Mailpit SMTP | ⚠️ 开发/测试 | SMTP 接收 |
| 9090 | Prometheus | ⚠️ 内网 | 通过 Nginx /prometheus/ 代理 |
| 9093 | AlertManager | ⚠️ 内网 | 管理接口 |

### 安全备注
- 核心数据服务 (PostgreSQL:5432, Redis:6379) **仅监听容器内部网络**
- Promtail 的 Docker socket 挂载为**只读** (ro)，缓解 CVE-2026-34040 等逃逸风险
- API 端口 3000 在生产环境中通过 Nginx 反向代理访问，不直接暴露

---

## 6. 资源限制配置

| 服务 | 内存限制 | 内存预留 | CPU 限制 | 备注 |
|------|---------|---------|---------|------|
| api | 512MB | 256MB | 1.0 core | V8 heap=384MB |
| postgres | 未设置 (系统默认) | — | — | 建议 1-2GB |
| redis | 未设置 (系统默认) | — | — | 建议 256-512MB |
| nginx | 未设置 (系统默认) | — | — | 通常很低 |
| prometheus | 未设置 (系统默认) | — | — | 取决于指标数量 |
| grafana | 未设置 (系统默认) | — | — | 通常较低 |
| node-exporter | 128MB | — | — | 轻量级 |
| pg-exporter | 128MB | — | — | 轻量级 |
| loki | 未设置 (系统默认) | — | — | 取决于日志量 |
| promtail | 未设置 (系统默认) | — | — | 轻量级 |
| tempo | 未设置 (系统默认) | — | — | 取决于 trace 量 |
| alertmanager | 未设置 (系统默认) | — | — | 轻量级 |
| mailpit | 未设置 (系统默认) | — | — | 测试用途 |

**建议**: 生产环境应为所有服务设置明确的 memory limit，防止单个容器 OOM 影响宿主机稳定性。

---

## 7. 日志查看方法

### 统一日志查看

```bash
# 所有服务的最新 30 行日志
docker compose -f docker-compose.prod.yml logs --tail=30

# 实时跟踪所有日志
docker compose -f docker-compose.prod.yml logs -f

# 仅错误日志
docker compose -f docker-compose.prod.yml logs -f 2>&1 | grep -iE "(error|fatal|panic)"

# 特定时间段
docker compose -f docker-compose.prod.yml logs --since=1h --until=10m

# 多服务组合
docker compose -f docker-compose.prod.yml logs -f api postgres redis
```

### 单服务日志

```bash
# API 日志 (最常用)
docker compose -f docker-compose.prod.yml logs -f --tail=200 api

# Nginx 访问日志 (结构化)
docker exec globalreach-nginx-prod tail -f /var/log/nginx/access.log

# Nginx 错误日志
docker exec globalreach-nginx-prod tail -f /var/log/nginx/error.log

# PostgreSQL 日志
docker compose -f docker-compose.prod.yml logs -f postgres

# Redis 日志
docker compose -f docker-compose.prod.yml logs -f redis
```

### 日志轮转配置

API 服务的日志驱动配置 (docker-compose.prod.yml):
```
driver: json-file
options:
  max-size: "10m"    # 单个日志文件最大 10MB
  max-file: "3"      # 最多保留 3 个文件 (总计 ≤ 30MB)
```

其他服务使用 Docker 默认日志配置。Nginx 日志写入独立 volume `nginx_logs`。

---

## 8. 健康检查清单

- [ ] **全部容器运行**: `docker compose -f docker-compose.prod.yml ps` — 无 Exit 状态
- [ ] **网络正常**: 所有容器在同一 `globalreach-network` 中
- [ ] **核心链路连通**: Nginx → API → Postgres + Redis (端到端请求成功)
- [ ] **监控可用**: Prometheus targets 全 UP, Grafana 可访问
- [ ] **告警可发**: AlertManager 通知渠道正常 (可发测试告警)
- [ ] **日志采集**: Promtail 正在向 Loki 发送数据
- [ ] **磁盘空间**: 宿主机磁盘可用 > 20%, Docker volumes 未满
- [ ] **端口正确**: 80/443 (Nginx), 3002 (Grafana) 可从外部访问
- [ ] **SSL 有效**: HTTPS 证书在有效期内
- [ ] **资源余量**: 宿主机内存/CPU 有足够余量应对流量波动

---

## 9. 故障排查场景

### 场景 1: 全部服务无法启动

**症状**: `docker compose up -d` 后多个容器处于 Created/Exited 状态

**可能原因**:
1. Docker daemon 未运行或异常
2. 磁盘空间不足
3. 端口冲突 (80/443/3000 等)
4. Docker 网络损坏
5. 镜像不存在或拉取失败
6. .env 文件缺失或格式错误

**诊断步骤**:
```bash
# 1. Docker daemon 状态
docker info | head -10

# 2. 磁盘空间
df -h

# 3. 端口占用
netstat -tlnp | grep -E ":(80|443|3000|3002|9090|9093|3100|3200) "

# 4. 网络状态
docker network ls | grep globalreach
docker network inspect globalreach-project_globalreach-network

# 5. 尝试手动启动并观察错误
docker compose -f docker-compose.prod.yml up  (不加 -d, 看前台输出)

# 6. 检查 .env
ls -la .env* 2>/dev/null || echo "No .env files found"
```

**解决方案**: 根据具体错误逐一修复。常见修复：清理空间、释放端口、重建网络。

---

### 场景 2: 单个容器持续重启 (CrashLoopBackOff)

**症状**: `docker ps` 显示 Restarting 状态

**可能原因**:
1. 应用启动失败（配置错误/依赖不可达）
2. OOMKilled (超出内存限制)
3. 健康检查始终失败导致不断重启
4. entrypoint 命令报错退出

**诊断步骤**:
```bash
# 1. 查看容器退出码和最近日志
docker logs --tail=50 <container_name>

# 2. 查看重启次数和原因
docker inspect --format='{{.RestartCount}} {{.State.ExitCode}} {{.State.OOMKilled}}' <container_name>

# 3. 如果是 OOM
docker inspect --format='{{.HostConfig.Memory}}' <container_name>
docker stats --no-stream <container_name>

# 4. 检查依赖服务是否正常
docker compose -f docker-compose.prod.yml ps postgres redis
```

**解决方案**: 见 [TT-004 容器崩溃循环决策树](../troubleshooting-trees/TT-004_CONTAINER_CRASH_LOOP.md)。

---

### 场景 3: 容器间网络不通

**症状**: A 容器无法通过服务名访问 B 容器

**可能原因**:
1. 容器不在同一网络中
2. DNS 解析失败
3. iptables/firewalld 规则阻断
4. Docker 网络驱动问题

**诊断步骤**:
```bash
# 1. 确认两个容器都在同一网络
docker inspect --format='{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' container_a
docker inspect --format='{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' container_b

# 2. 从 A 容器测试 B 的连通性
docker exec container_a ping -c 2 container_b_name
docker exec container_a sh -c "echo > /dev/tcp/container_b_name/port"

# 3. 检查 DNS 解析
docker exec container_a nslookup container_b_name

# 4. 检查网络驱动
docker network inspect globalreach-project_globalreach-network | grep Driver
```

**解决方案**: 确保两个服务都声明了 `networks: [globalreach-network]`，必要时重建网络。

---

### 场景 4: Volume 权限问题

**症状**: 容器启动后报 Permission denied 或无法读写挂载的文件

**可能原因**:
1. 容器内运行用户与宿主机文件属主不匹配
2. bind mount 的目录不存在
3. volume 权限被意外修改
4. SELinux/AppArmor 限制

**诊断步骤**:
```bash
# 1. 检查文件权限
ls -la ./postgres_data/ 2>/dev/null || echo "Docker managed volume"
ls -la ./nginx/
ls -la ./prometheus/

# 2. 检查容器内用户
docker exec <container_name> id

# 3. 检查是否可以写
docker exec <container_name> touch /test_write 2>&1
```

**解决方案**: 调整目录权限 (`chmod 777` 或 `chown`)，确保 bind mount 目录存在。

---

### 场景 5: 镜像拉取失败

**症状**: `docker compose up` 时出现 image pull 错误

**可能原因**:
1. 网络不通 (Docker Hub 被墙或 DNS 问题)
2. 镜像 tag 不存在
3. Docker login 过期 (私有仓库)
4. 磁盘空间不足

**诊断步骤**:
```bash
# 1. 手动拉取测试
docker pull nginx:1.31.1-alpine

# 2. 检查 Docker registry 连通性
curl -I https://registry-1.docker.io/v2/

# 3. 检查 DNS
nslookup registry-1.docker.io

# 4. 检查磁盘
df -h
```

**解决方案**: 配置镜像加速器，检查网络/DNS，清理磁盘空间。

---

### 场景 6: docker compose 命令本身异常

**症状**: `docker compose` 命令报错或行为不符合预期

**可能原因**:
1. Docker Compose 版本过低
2. docker-compose.prod.yml 语法错误
3. 环境变量未正确加载
4. Docker daemon 版本不兼容

**诊断步骤**:
```bash
# 1. 版本检查
docker compose version
docker version

# 2. 配置语法校验
docker compose -f docker-compose.prod.yml config

# 3. 检查环境变量加载
docker compose -f docker-compose.prod.yml config | grep -E "(\$\{|environment)"

# 4. 详细模式
docker compose -f docker-compose.prod.yml up --verbose
```

**解决方案**: 升级 Docker/Compose 版本，修复 YAML 语法错误。

---

## 10. 关键指标基线

| 指标 | 正常范围 | 警告阈值 | 严重阈值 |
|------|---------|---------|---------|
| 容器运行率 | 14/14 (100%) | < 93% (<13/14) | < 86% (<12/14) |
| 宿主机内存使用 | < 70% | > 85% | > 95% |
| 宿主机 CPU 使用 | < 50% | > 75% | > 95% |
| 宿主机磁盘使用 | < 70% | > 85% | > 95% |
| Docker 网络延迟 | < 1ms | > 5ms | > 20ms |
| 容器重启频率 | 0 次/h | > 3 次/h | > 10 次/h |
| Volume 使用总量 | < 20GB | > 40GB | > 80GB |

---

## 11. 相关资源

### 关联 Runbook
- [RB-001 API 服务运行手册](RB-001_API_SERVICE.md)
- [RB-002 PostgreSQL 运行手册](RB-002_POSTGRES.md)
- [RB-003 Redis 运行手册](RB-003_REDIS.md)
- [RB-004 Nginx 运行手册](RB-004_NGINX.md)
- [RB-005 监控栈运行手册](RB-005_MONITORING_STACK.md)
- [RB-007 邮件流水线运行手册](RB-007_EMAIL_PIPELINE.md)

### 配置文件
- `docker-compose.prod.yml` — 唯一编排文件 (394 行)
- `.env` / `.env.prod` — 环境变量覆盖
- `Dockerfile` — API 服务构建定义

### 决策树
- [TT-004 容器崩溃循环](../troubleshooting-trees/TT-004_CONTAINER_CRASH_LOOP.md)
