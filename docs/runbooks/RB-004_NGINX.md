# RB-004 Nginx 运行手册

> **文档版本**: v1.0
> **所属项目**: GlobalReach V2.0 企业级邮件营销平台
> **组件**: nginx-prod (globalreach-nginx-prod)
> **最后更新**: 2026-06-09

---

## 1. 组件身份卡

| 属性 | 值 |
|------|-----|
| 容器名称 | globalreach-nginx-prod |
| 镜像 | nginx:1.31.1-alpine (固定版本) |
| Nginx 版本 | 1.31.x (Stable) |
| 监听端口 | 80 (HTTP) / 443 (HTTPS) |
| Worker 进程 | auto (自动匹配 CPU 核数) |
| Worker 连接数 | 1024 |
| 事件模型 | epoll (Linux 高性能) |
| 健康检查 | `kill -0 $(cat /var/run/nginx.pid)` (30s间隔, 10s超时, 3次重试) |
| 重启策略 | unless-stopped |
| 日志卷 | nginx_logs → /var/log/nginx |

### SSL/TLS 配置

| 属性 | 值 |
|------|-----|
| TLS 协议 | TLSv1.2 + TLSv1.3 |
| 证书类型 | 自签名 (globalreach.crt) / Let's Encrypt (fullchain.pem) |
| 证书路径 | `/etc/nginx/ssl/globalreach/` 或 `/etc/nginx/ssl/le/live/` |
| Session 超时 | 1 天 |
| Session Cache | 50MB shared:SSL |
| Session Tickets | off (防 Forward Secrecy 攻击) |
| HSTS | max-age=15768000 (6个月, includeSubDomains, preload) |
| OCSP Stapling | Let's Encrypt 模式启用 |
| DH Parameters | 2048-bit (LE 模式) |

### 路由域名

| 域名 | 用途 | 端口 | 认证 |
|------|------|------|------|
| api.globalreach.com | API Gateway | 443 | 无 (Bearer Token) |
| app.globalreach.com | 前端 SPA (React) | 443 | 无 |
| monitor.globalreach.com | Grafana + Prometheus | 443 | Basic Auth (.htpasswd) |
| grafana.globalreach.com | Grafana (monitor 别名) | 443 | Basic Auth |
| localhost | HTTP→HTTPS 重定向 + ACME | 80 | 无 |

---

## 2. 快速命令参考

| 操作 | 命令 |
|------|------|
| 查看状态 | `docker compose -f docker-compose.prod.yml ps nginx` |
| 查看日志 | `docker compose -f docker-compose.prod.yml logs -f --tail=50 nginx` |
| 测试配置 | `docker exec globalreach-nginx-prod nginx -t` |
| 重载配置 | `docker exec globalreach-nginx-prod nginx -s reload` |
| 重启服务 | `docker compose -f docker-compose.prod.yml restart nginx` |
| 停止服务 | `docker compose -f docker-compose.prod.yml stop nginx` |
| 查看当前配置 | `docker exec globalreach-nginx-prod cat /etc/nginx/nginx.conf` |
| 查看包含的 conf.d | `docker exec globalreach-nginx-prod ls /etc/nginx/conf.d/` |
| 健康检查 | `curl -sf http://localhost/nginx-health` |
| 查看 access log | `docker exec globalreach-nginx-prod cat /var/log/nginx/access.log \| tail -20` |
| 查看 error log | `docker exec globalreach-nginx-prod cat /var/log/nginx/error.log \| tail -20` |
| 查看 IP 限流状态 | `docker exec globalreach-nginx-prod cat /var/run/ngx_http_req_limit_zone_api_limit.rate` |
| 查看连接限制状态 | `docker exec globalreach-nginx-prod cat /var/run/ngx_http_conn_limit_conn_limit.rate` |

---

## 3. 配置文件结构说明

```
nginx/
├── nginx.conf              # 主配置文件 (全局指令)
│   ├── worker_processes auto
│   ├── events { worker_connections 1024; use epoll; }
│   ├── http {
│   │   ├── limit_req_zone (L1 限流: 50r/s per IP)
│   │   ├── limit_conn_zone (连接数限制)
│   │   ├── log_format main (自定义日志格式)
│   │   ├── gzip 配置
│   │   └── include conf.d/*.conf
│   └── }
│
├── conf.d/
│   ├── production.conf           # 主配置 (自签名证书)
│   │   ├── :80 → ACME challenge + HTTPS redirect
│   │   ├── :443 api.globalreach.com → API proxy
│   │   ├── :443 app.globalreach.com → Frontend SPA
│   │   └── :443 monitor.globalreach.com → Grafana + Prometheus
│   │
│   └── ssl-le-production.conf    # Let's Encrypt 配置 (替代 production.conf)
│       └── 同上结构，但使用 LE 证书 + OCSP Stapling
│
├── ssl/
│   ├── globalreach/              # 自签名证书目录
│   │   ├── globalreach.crt
│   │   └── globalreach.key
│   └── letsencrypt/              # LE 证书目录 (certbot 自动管理)
│       └── live/globalreach.com/
│           ├── fullchain.pem
│           ├── chain.pem
│           └── privkey.pem
│
└── acme-challenge/               # Let's Encrypt 验证目录
```

### Volume 挂载映射

| 宿主机路径 | 容器路径 | 用途 |
|-----------|---------|------|
| ./nginx/nginx.conf | /etc/nginx/nginx.conf:ro | 主配置 (只读) |
| ./nginx/conf.d | /etc/nginx/conf.d:ro | 站点配置 (只读) |
| ./nginx/ssl/globalreach | /etc/nginx/ssl/globalreach:ro | 自签名证书 (只读) |
| ./nginx/ssl/letsencrypt | /etc/nginx/ssl/le:ro | LE 证书 (只读) |
| ./frontend/dist | /var/www/frontend/dist:ro | 前端静态文件 (只读) |
| ./docs | /usr/share/nginx/html/docs:ro | 文档站点 (只读) |
| ./nginx/acme-challenge | /var/www/acme-challenge:ro | ACME 验证 (只读) |
| nginx_logs | /var/log/nginx | 日志 (读写) |

---

## 4. SSL/TLS 配置详解

### 密码套件 (Cipher Suites)

```
优先级顺序 (现代浏览器自动选择最优):
1. ECDHE-ECDSA-AES128-GCM-SHA256     (TLS 1.2/1.3, 最高优先级)
2. ECDHE-RSA-AES128-GCM-SHA256
3. ECDHE-ECDSA-AES256-GCM-SHA384
4. ECDHE-RSA-AES256-GCM-SHA384
5. ECDHE-ECDSA-CHACHA20-POLY1305     (AES-NI 不可用时回退)
6. ECDHE-RSA-CHACHA20-POLY1305
7. DHE-RSA-AES128-GCM-SHA256         (向后兼容)
8. DHE-RSA-AES256-GCM-SHA384

ssl_prefer_server_ciphers: off (让客户端选择)
```

### 安全头汇总

| 头 | 值 | 目的 |
|----|-----|------|
| Strict-Transport-Security | max-age=15768000; includeSubDomains; preload | 强制 HTTPS 6个月 |
| X-Frame-Options | SAMEORIGIN | 防点击劫持 |
| X-Content-Type-Options | nosniff | 防 MIME 嗅探 |
| X-XSS-Protection | 1; mode=block | XSS 过滤器 |
| Referrer-Policy | strict-origin-when-cross-origin | 引用策略 |
| Content-Security-Policy | (按子站定制) | 防注入攻击 |
| Permissions-Policy | camera=(), microphone=(), geolocation=() | 权限策略 |

---

## 5. 反向代理规则

### API Proxy (api.globalreach.com)

```
请求路径: /
Upstream: http://globalreach-api-prod:3000
协议: HTTP/1.1 (保持)
特性:
  - WebSocket 支持 (Upgrade/Connection header)
  - 完整转发真实 IP (X-Real-IP, X-Forwarded-For/Proto/Host/Port)
  - 超时: connect=10s, send=60s, read=60s
  - Buffering: on (buffer_size=4k, buffers=8×4k)
  - 限流: zone=api_limit burst=100 nodelay
  - Body 大小: 50MB
例外: /api/v1/health 和 /api/v1/docs 不受限流约束
```

### Frontend Proxy (app.globalreach.com)

```
请求路径: /
Root: /var/www/frontend/dist (React SPA)
特性:
  - SPA fallback: try_files $uri $uri/ /index.html
  - 静态资源长期缓存 (expires 365d, immutable)
  - Service Worker 不缓存 (no-cache)
  - Gzip 压缩 (comp_level=6)
  - API 请求代理到 api.globalreach.com:3000 (/api/ 路径)
```

### Monitoring Proxy (monitor.globalreach.com)

```
请求路径: /          → Grafana (globalreach-grafana:3002)
请求路径: /prometheus/ → Prometheus (globalreach-prometheus:9090/)
特性:
  - Basic Auth 保护 (.htpasswd)
  - WebSocket 支持 (Grafana live dashboard)
  - 超时: read/send = 90s (Grafana 查询可能较慢)
  - Cookie SameSite 修正
```

---

## 6. 限流配置

### 三层限流架构

```
客户端请求
    │
    ▼
[L1] Nginx 限流 (nginx.conf)
    │  limit_req_zone: 50 requests/s per IP
    │  limit_conn_zone: 连接数限制
    │  burst=100, nodelay (突发立即处理)
    │  返回: 503 (Service Temporarily Unavailable)
    ▼
[L2] Express 全局限流 (api/middleware/rateLimiter.js)
    │  RATE_LIMIT_MAX: 30000 / 15min ≈ 33 rps
    │  返回: 429 Too Many Requests
    ▼
[L3] Express 端点粒度限流 (autoEndpointLimiter)
    │  每个端点独立限制
    │  返回: 429 Too Many Requests
    ▼
API Route Handler
```

### L1 限流参数详解

| 参数 | 值 | 说明 |
|------|-----|------|
| zone 名称 | api_limit | 基于 $binary_remote_addr |
| zone 大小 | 10M | 约 16 万个 IP 状态 |
| 速率 | 50r/s | 平均每 IP 每秒 50 请求 |
| burst | 100 | 允许突发 100 个请求 |
| nodelay | 是 | 突发请求立即处理（不排队） |
| 超限响应 | 503 | 默认 Nginx 错误页 |

---

## 7. 日志格式与解析

### Access Log 格式 (main)

```
$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for"
```

**示例**:
```
203.0.113.42 - [09/Jun/2026:10:15:30 +0000] "POST /api/v1/campaigns HTTP/1.1" 201 1547 "https://app.globalreach.com/" "Mozilla/5.0..." "203.0.113.42"
```

### Error Log 级别

- **warn**: 配置问题、限流触发、上游临时不可达
- **error**: 上游连接失败、SSL 握手失败、权限错误
- **crit**: 配置无法加载、端口绑定失败

### 日志分析命令

```bash
# === Top 10 请求 IP ===
docker exec globalreach-nginx-prod awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# === Top 10 请求路径 ===
docker exec globalreach-nginx-prod awk '{print $7}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# === HTTP 状态码分布 ===
docker exec globalreach-nginx-prod awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -rn

# === 5xx 错误请求 ===
docker exec globalreach-nginx-prod awk '$9 ~ /^5/' /var/log/nginx/access.log | tail -20

# === 限流触发统计 (429/503) ===
docker exec globalreach-nginx-prod awk '$9 == 429 || $9 == 503' /var/log/nginx/access.log | wc -l

# === 近 1 小时 QPS 趋势 ===
docker exec globalreach-nginx-prod awk -F'[\\[:]]' '{print $4":"$5":00"}' /var/log/nginx/access.log | uniq -c | tail -60
```

---

## 8. 性能调优参数

### 当前配置 vs 推荐调优

| 参数 | 当前值 | 推荐值 (高流量) | 说明 |
|------|-------|----------------|------|
| worker_processes | auto | auto | 保持 |
| worker_connections | 1024 | 4096 | 高并发时调大 |
| keepalive_timeout | 65s | 30s | 减少连接占用 |
| keepalive_requests | 100 | 1000 | 长连接复用 |
| client_max_body_size | 50M | 50M | 匹配 API 限制 |
| proxy_buffer_size | 4k | 16k | 大响应时优化 |
| proxy_buffers | 8×4k | 8×16k | 同上 |
| gzip_min_length | 1024 | 256 | 更积极压缩 |
| open_file_cache | 未配置 | max=2000 inactive=20s | 静态文件缓存 |
| limit_req_rate | 50r/s | 按需调整 | 根据 IP 分布 |

### Gzip 配置

```
gzip on;                          // 已启用
gzip_vary on;                     // Vary: Accept-Encoding 头
gzip_min_length 1024;             // 最小 1KB 才压缩
gzip_comp_level 6;                // 压缩级别 (frontend), main config 未指定 (默认 1)
gzip_types: text/plain, css, xml, js, json, rss, atom+xml, svg
```

---

## 9. 健康检查清单

- [ ] **容器状态**: `docker ps \| grep globalreach-nginx-prod` — Up
- [ ] **内置健康检查**: `curl -sf http://localhost/nginx-health` → OK
- [ ] **HTTPS 可访问**: `curl -sfI https://api.globalreach.com/api/v1/health` → 200
- [ ] **HTTP→HTTPS 重定向**: `curl -sfI http://api.globalreach.com/` → 301
- [ ] **配置语法正确**: `docker exec globalreach-nginx-prod nginx -t` → syntax ok
- [ ] **SSL 证书有效**: `openssl s_client -connect api.globalreach.com:443 \| openssl x509 -noout -dates`
- [ ] **前端可访问**: `curl -sfI https://app.globalreach.com/` → 200
- [ ] **监控面板可访问**: `curl -sfI -u user:pass https://monitor.globalreach.com/` → 200
- [ ] **文档站点可访问**: `curl -sfI http://localhost/docs/` → 200
- [ ] **无大量 5xx 错误**: error_log 中 5xx 占比 < 1%

---

## 10. 故障排查场景

### 场景 1: 502 Bad Gateway

**症状**: Nginx 返回 502，上游 API 不可达

**可能原因**:
1. API 容器未启动或崩溃
2. API 容器的端口 3000 未监听
3. Docker DNS 解析失败 (globalreach-api-prod 无法解析)
4. upstream 名称拼写错误

**诊断步骤**:
```bash
# 1. 检查 API 容器状态
docker ps | grep globalreach-api-prod

# 2. 从 Nginx 容器内测试上游连通性
docker exec globalreach-nginx-prod wget -qO- http://globalreach-api-prod:3000/api/v1/health

# 3. 检查 Nginx error log 中的上游错误
docker exec globalreach-nginx-prod tail -20 /var/log/nginx/api_error.log | grep -i "(upstream|connect|refused)"

# 4. 验证 DNS 解析
docker exec globalreach-nginx-prod nslookup globalreach-api-prod
```

**解决方案**: 先恢复 API 服务 (RB-001)。Nginx 会自动恢复代理。

---

### 场景 2: SSL/TLS 握手失败

**症状**: 浏览器报 SSL 错误 (ERR_SSL_PROTOCOL_ERROR / NET::ERR_CERT_*)

**可能原因**:
1. 证书过期或尚未生效
2. 证书与域名不匹配
3. 证书链不完整 (缺少中间证书)
4. 私钥文件权限不对
5. 客户端不支持配置的密码套件

**诊断步骤**:
```bash
# 1. 检查证书有效期
docker exec globalreach-nginx-prod openssl x509 -in /etc/nginx/ssl/globalreach/globalreach.crt -noout -dates

# 2. 验证证书与私钥匹配
docker exec globalreach-nginx-prod openssl x509 -in /etc/nginx/ssl/globalreach/globalreach.crt -noout -modulus | md5sum
docker exec globalreach-nginx-prod openssl rsa -in /etc/nginx/ssl/globalreach/globalreach.key -noout -modulus | md5sum
# 两个 MD5 应相同

# 3. 测试 SSL 握手
openssl s_client -connect api.globalreach.com:443 -servername api.globalreach.com </dev/null

# 4. 检查证书链完整性
openssl s_client -showcerts -connect api.globalreach.com:443 </dev/null | openssl verify -CAfile /dev/null

# 5. Let's Encrypt 证书检查 (如果使用 LE)
docker exec globalreach-nginx-prod openssl x509 -in /etc/nginx/ssl/le/live/globalreach.com/fullchain.pem -noout -dates
```

**解决方案**:
- 证书过期 → 续期 (LE: `certbot renew`; 自签名: 重新生成)
- 证书不匹配 → 修正证书文件
- 证书链不全 → 使用 fullchain.pem 而非单独的 cert
- LE 续期 → `docker compose run --rm --profile ssl certbot renew`

---

### 场景 3: 限流误触 (429/503)

**症状**: 合法用户收到 429 (Too Many Requests) 或 503

**可能原因**:
1. L1 Nginx 限流阈值过低 (50r/s 对某些场景不够)
2. 同一 NAT 后多个用户共享 IP
3. 爬虫/恶意扫描消耗配额
4. L2/L3 Express 限流配置不合理

**诊断步骤**:
```bash
# 1. 查看 Nginx 限流状态
docker exec globalreach-nginx-prod cat /var/run/ngx_http_req_limit_zone_api_limit.rate 2>/dev/null || echo "shared memory not accessible"

# 2. 查看 429/503 统计
docker exec globalreach-nginx-prod awk '$9 == 429 || $9 == 503' /var/log/nginx/access.log | wc -l

# 3. 找出高频 IP
docker exec globalreach-nginx-prod awk '$9 == 429 || $9 == 503 {print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# 4. 检查这些 IP 的请求特征
docker exec globalreach-nginx-prod awk '/<高频IP>/' /var/log/nginx/access.log | tail -20
```

**解决方案**:
- 阈值过低 → 调大 `limit_req_zone` 的 rate 或 burst 值
- 共享 IP → 将共享 IP 加入白名单或提高其限额
- 恶意流量 → 使用 fail2ban 或 Nginx deny 规则封禁
- L2/L3 问题 → 调整 RATE_LIMIT_MAX 和 endpointLimits 配置

---

### 场景 4: 静态资源 404

**症状**: 前端页面加载后 JS/CSS/图片返回 404

**可能原因**:
1. frontend/dist 目录未正确挂载
2. 文件路径大小写不匹配 (Linux 区分大小写)
3. 路由配置问题 (SPA fallback 未生效)
4. 构建产物未更新到 dist 目录

**诊断步骤**:
```bash
# 1. 检查挂载内容
docker exec globalreach-nginx-prod ls /var/www/frontend/dist/

# 2. 检查特定文件是否存在
docker exec globalreach-nginx-prod ls -la /var/www/frontend/dist/assets/

# 3. 模拟请求
docker exec globalreach-nginx-prod wget -qO- http://localhost/static/js/main.xxx.js

# 4. 检查 Nginx location 匹配
docker exec globalreach-nginx-prod nginx -T 2>/dev/null | grep -A5 "location.*js"
```

**解决方案**: 重新构建前端并复制到 `./frontend/dist`，然后 `nginx -s reload`

---

### 场景 5: 高 CPU/内存使用

**症状**: Nginx 进程 CPU 或内存持续偏高

**可能原因**:
1. SSL 握手密集 (大量新建连接)
2. Gzip 压缩消耗 CPU
3. 日志写入 I/O 密集
4. worker_connections 过高导致内存占用大

**诊断步骤**:
```bash
# 1. 资源使用
docker stats --no-stream globalreach-nginx-prod

# 2. 连接数统计
docker exec globalreach-nginx-prod cat /proc/net/sockstat

# 3. 当前活跃连接
docker exec globalreach-nginx-prod nginx-status 2>/dev/null || \
docker exec globalreach-nginx-prod wget -qO- http://localhost/nginx_status 2>/dev/null || \
echo "stub_status not configured"
```

**解决方案**:
- SSL 密集 → 启用 SSL session cache (已配置 50MB shared:SSL)
- Gzip CPU → 降低 gzip_comp_level 或对大文件跳过 gzip
- I/O 密集 → 减少 access_log 粒度或关闭不需要的日志

---

### 场景 6: 配置重载失败

**症状**: `nginx -s reload` 返回 error

**可能原因**:
1. 配置文件语法错误
2. 端口已被占用
3. SSL 证书文件不存在或不可读
4. include 的文件中有语法错误

**诊断步骤**:
```bash
# 1. 先测试配置（不影响运行中的服务）
docker exec globalreach-nginx-prod nginx -t

# 2. 如果出错，查看详细错误信息
# nginx -t 会输出具体的行号和错误描述

# 3. 检查所有 include 的文件
docker exec globalreach-nginx-prod ls -la /etc/nginx/conf.d/
docker exec globalreach-nginx-prod ls -la /etc/nginx/ssl/globalreach/
```

**解决方案**: 根据 `-t` 输出的错误信息修复对应配置文件，再次测试直到通过后再 reload。

---

## 11. 关键指标基线

| 指标 | 正常范围 | 警告阈值 | 严重阈值 | 说明 |
|------|---------|---------|---------|------|
| QPS | 基线 | > 2x 基线 | > 5x 基线 | 每秒请求数 |
| 5xx 错误率 | < 0.1% | > 1% | > 5% | 上游错误 |
| 4xx 错误率 | < 5% | > 15% | > 30% | 客户端错误 |
| 上游响应时间 (P95) | < 500ms | > 2s | > 5s | proxy 延迟 |
| SSL 握手时间 | < 200ms | > 500ms | > 2s | TLS 握手 |
| 限流触发率 | < 0.01% | > 1% | > 5% | 429/503 占比 |
| 活跃连接数 | < 500 | > 1000 | > 2000 | worker_connections |
| CPU 使用率 | < 20% | > 50% | > 80% | 容器级别 |

---

## 12. 相关资源

### 关联 Runbook
- [RB-001 API 服务运行手册](RB-001_API_SERVICE.md) — 上游 API 服务
- [RB-006 Docker Compose 运行手册](RB-006_DOCKER.md) — 容器编排

### 关联文档
- [CDN 集成计划](../CDN_INTEGRATION_PLAN.md) — CDN 前置方案
- [安全密钥轮换政策](../SECURITY_KEY_ROTATION_POLICY.md) — 证书轮换
- [合规政策](../COMPLIANCE_POLICY.md) — 安全头合规要求

### 配置文件
- `nginx/nginx.conf` — 主配置
- `nginx/conf.d/production.conf` — 自签名证书站点配置
- `nginx/conf.d/ssl-le-production.conf` — Let's Encrypt 站点配置
- `docker-compose.prod.yml` — nginx 服务定义 (第 116-143 行)

### Certbot 操作参考
```bash
# 初次签发
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot

# 续期
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew

# 干跑测试
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --dry-run

# 一键切换到 LE 证书
bash scripts/ssl-switch-to-letsencrypt.sh
```
