# GlobalReach V2.0 — 密钥轮换策略文档

> **文档编号**: M-C02 | **协议版本**: v6.0-STEADY-STATE-EVOLUTION  
> **适用范围**: 生产环境全栈部署 (Docker Compose)  
> **最后更新**: 2026-06-08

---

## 目录

1. [概述](#1-概述)
2. [当前密钥资产清单](#2-当前密钥资产清单)
3. [JWT Secret 轮换策略](#3-jwt-secret-轮换策略)
4. [数据库密码轮换](#4-数据库密码轮换)
5. [API 密钥管理（GitHub Secrets）](#5-api-密钥管理github-secrets)
6. [SSL 证书续期](#6-ssl-证书续期)
7. [SMTP 密码更新流程](#7-smtp-密码更新流程)
8. [轮换频率总表](#8-轮换频率总表)
9. [紧急泄露响应 SOP](#9-紧急泄露响应-sop)

---

## 1. 概述

本文档定义 GlobalReach V2.0 生产环境中所有密钥、密码、证书的轮换策略与操作流程。**所有密钥均应视为敏感资产，遵循最小权限原则和定期轮换原则。**

### 核心原则

| 原则 | 说明 |
|------|------|
| 定期轮换 | 每种密钥按设定周期强制更换 |
| 零停机过渡 | 轮换期间新旧密钥共存，避免服务中断 |
| 自动化优先 | 能自动化的步骤尽量自动化，减少人为失误 |
| 审计追踪 | 每次轮换操作需记录时间、操作人、变更内容 |
| 泄露即废 | 一旦确认泄露，立即作废并更换，不等待周期 |

---

## 2. 当前密钥资产清单

基于 `docker-compose.prod.yml` 和 `.env.production.template` 的实际配置：

### 2.1 应用层密钥

| 密钥名称 | 环境变量 | 当前默认值/配置位置 | 风险等级 |
|----------|----------|---------------------|----------|
| JWT 签名密钥 | `JWT_SECRET` | `${JWT_SECRET:-change-this-secret-in-production-min-32-chars}` | 🔴 **高** |
| CSRF 保护密钥 | `CSRF_SECRET` | `${CSRF_SECRET:-change-this-csrf-secret}` | 🟠 **中** |

### 2.2 数据库凭据

| 密钥名称 | 环境变量 | 当前默认值 | 使用方 | 风险等级 |
|----------|----------|-------------|--------|----------|
| PostgreSQL 密码 | `DB_PASSWORD` | `${DB_PASSWORD:-changeme}` | api, postgres-exporter | 🔴 **高** |
| Redis 密码 | `REDIS_PASSWORD` | `${REDIS_PASSWORD:-<空>}` | api 服务 | 🟡 **低**（当前未启用认证） |

### 2.3 监控与告警凭据

| 密钥名称 | 环境变量 | 当前默认值 | 风险等级 |
|----------|----------|-------------|----------|
| Grafana 管理员密码 | `GF_SECURITY_ADMIN_PASSWORD` / `GRAFANA_ADMIN_PASSWORD` | `${GRAFANA_ADMIN_PASSWORD:-admin123}` | 🔴 **高** |
| QQ Mail SMTP 密码（Grafana） | `GF_SMTP_PASSWORD` | `zhrtbpzlgfoehjgj`（⚠️ 硬编码） | 🔴 **高** |
| AlertManager SMTP 密码 | `ALERTMANAGER_SMTP_PASS` | `${ALERTMANAGER_SMTP_PASS:-}` | 🟠 **中** |

### 2.4 基础设施密钥

| 密钥名称 | 类型 | 配置位置 | 风险等级 |
|----------|------|----------|----------|
| SSL/TLS 证书 | Let's Encrypt | `./nginx/ssl/letsencrypt/` | 🟠 **中** |
| SSH 部署密钥 | GitHub Secret (`PROD_SSH_KEY`) | CI/CD Pipeline | 🔴 **高** |
| 服务器登录凭据 | GitHub Secrets (`PROD_HOST`, `PROD_USER`) | CI/CD Pipeline | 🔴 **高** |

---

## 3. JWT Secret 轮换策略

### 3.1 轮换流程概览

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  生成新密钥  │ ──▶ │  新旧密钥共存 │ ──▶ │  移除旧密钥  │
│  (Phase 1)  │     │  (Phase 2)   │     │  (Phase 3)  │
└─────────────┘     └──────────────┘     └─────────────┘
       ↓                   ↓                     ↓
   即时生效          共存期: 24h × JWT过期时间    强制登出
                                          所有旧Token失效
```

### 3.2 详细操作步骤

#### Phase 1：生成新密钥（⚙️ 可自动化）

```bash
# 生成新的 JWT_SECRET（32字节 base64）
NEW_JWT_SECRET=$(openssl rand -base64 32)
echo "新 JWT_SECRET: $NEW_JWT_SECRET"
```

#### Phase 2：部署新密钥 — 新旧共存期（🔧 手动 + ⚙️ 半自动）

| 步骤 | 操作 | 自动化程度 | 说明 |
|------|------|-----------|------|
| 2.1 | 更新 `.env.production` 中的 `JWT_SECRET` 为新值 | 🔧 手动 | 保留旧值备份 |
| 2.2 | 更新 API 服务环境变量 | ⚙️ 半自动 | `docker compose -f docker-compose.prod.yml up -d api` |
| 2.3 | **等待共存期结束** | — | 建议 ≥ `JWT_EXPIRES_IN × 2`（当前为 48h） |
| 2.4 | 验证新 Token 正常签发与验证 | 🔧 手动 | 用新 secret 签发的 token 可正常使用 |

**共存期机制说明：**

- 新 secret 生效后，API 同时接受用**新旧两个 secret** 签名的 JWT
- 已登录用户持有的旧 Token 在其自然过期前仍可正常使用
- 新登录请求统一使用新 secret 签发 Token
- 共存期结束后进入 Phase 3

#### Phase 3：移除旧密钥 — 强制重新登录（⚙️ 可自动化）

| 步骤 | 操作 | 自动化程度 | 说明 |
|------|------|-----------|------|
| 3.1 | 确认共存期已过（≥48h） | 🔧 手动 | 检查日志无旧 secret 验证请求 |
| 3.2 | 清除 Redis 中所有活跃会话 | ⚙️ 半自动 | `redis-cli FLUSHDB` 或按 key pattern 删除 |
| 3.3 | 通知用户需重新登录 | 🔧 手动 | 通过邮件/系统公告通知 |
| 3.4 | 销毁旧 secret 的所有备份副本 | 🔧 手动 | 确保不可恢复 |

### 3.3 用户强制重新登录时机

| 场景 | 触发条件 | 用户体验影响 |
|------|----------|-------------|
| 计划内轮换 | Phase 3 执行后 | 下次请求时返回 401，需重新登录 |
| 紧急泄露 | 立即执行 Phase 3（跳过共存期） | 所有在线用户立即掉线 |
| 版本升级 | 伴随部署一起执行 | 与功能发布同步通知 |

---

## 4. 数据库密码轮换

### 4.1 PostgreSQL 密码轮换

**当前配置引用**: `POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}` （第20行）

#### 轮换步骤

| # | 步骤 | 操作命令 | 自动化程度 | 说明 |
|---|------|----------|-----------|------|
| 1 | 备份数据库 | `pg_dumpall -U globalreach_user > backup_$(date +%Y%m%d).sql` | ⚙️ 半自动 | **必须先备份** |
| 2 | 生成新密码 | `openssl rand -base64 16` | ⚙️ 全自动 | 最少16字符 |
| 3 | 进入容器修改密码 | `docker exec -it globalreach-postgres psql -U globalreach_user -c "ALTER USER globalreach_user WITH PASSWORD '<new_password>';"` | 🔧 手动 | 不重启即可生效 |
| 4 | 更新 `.env.production` | 将 `DB_PASSWORD` 替换为新值 | 🔧 手动 | 同时更新 `DATABASE_URL` 中的密码 |
| 5 | 重启依赖服务 | `docker compose -f docker-compose.prod.yml up -d api postgres-exporter` | ⚙️ 半自动 | API 和 exporter 都使用了 DB_PASSWORD |
| 6 | 验证连接 | 检查 api 日志无 DB 连接错误 | 🔧 手动 | `docker logs globalreach-api-prod --tail 50` |
| 7 | 更新 CI/CD Secrets | 同步更新 GitHub Secrets 中的 `DB_PASSWORD` | 🔧 手动 | 防止下次部署回滚 |

**⚠️ 注意事项：**
- PostgreSQL 密码变更**不需要重启** postgres 容器（`ALTER USER` 即时生效）
- 但需要重启所有**消费端**容器（api、postgres-exporter）
- 确保 `DATABASE_URL` 中的密码也同步更新（第59行）

### 4.2 Redis 密码轮换

**当前状态**: Redis 未设置密码（`REDIS_PASSWORD` 默认为空）

#### 启用并轮换 Redis 密码

| # | 步骤 | 操作 | 自动化程度 |
|---|------|------|-----------|
| 1 | 生成强密码 | `openssl rand -hex 16` | ⚙️ 全自动 |
| 2 | 创建 Redis 配置文件 | 添加 `requirepass <password>` | 🔧 手动 |
| 3 | 更新 docker-compose.prod.yml | redis service 添加 `command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]` | 🔧 手动 |
| 4 | 更新 `.env.production` | 设置 `REDIS_PASSWORD=<new_password>` | 🔧 手动 |
| 5 | 重启 Redis | `docker compose -f docker-compose.prod.yml up -d redis` | ⚙️ 半自动 |
| 6 | 重启 API 服务 | API 需要新密码连接 Redis | ⚙️ 半自动 |
| 7 | 验证 | `redis-cli -a <password> ping` → `PONG` | 🔧 手动 |

**后续轮换（已启用密码后）：**
- 流程同上，跳过步骤 2-3（配置已就位）
- 建议轮换周期：180天

---

## 5. API 密钥管理（GitHub Secrets）

### 5.1 当前 GitHub Secrets 清单

基于 CI/CD 配置推断，以下 Secrets 应存储在 GitHub Repository Settings → Secrets：

| Secret 名称 | 用途 | 示例值格式 | 轮换方式 |
|-------------|------|-----------|---------|
| `PROD_HOST` | 生产服务器地址 | `user@192.168.1.100` 或域名 | 服务器迁移时更换 |
| `PROD_USER` | 部署用户名 | `deploy` 或 `ubuntu` | 用户变更时更换 |
| `PROD_SSH_KEY` | SSH 私钥（用于部署） | `-----BEGIN OPENSSH PRIVATE KEY-----...` | 🔴 **定期轮换** |
| `GRAFANA_ADMIN_PASSWORD` | Grafana 管理员密码 | 强密码 | 与 Grafana 密码同步轮换 |
| `DB_PASSWORD` | 数据库密码 | 强密码 | 与 PostgreSQL 密码同步轮换 |
| `JWT_SECRET` | JWT 签名密钥 | 32+ 字符随机串 | 与应用 JWT_SECRET 同步轮换 |
| `LETSENCRYPT_EMAIL` | Let's Encrypt 通知邮箱 | `admin@globalreach.com` | 邮箱变更时更换 |

### 5.2 轮换检查清单

#### GitHub Secrets 轮换 SOP

- [ ] **准备阶段**
  - [ ] 确认当前 Secret 使用情况（哪些 workflow 引用了该 Secret）
  - [ ] 生成新值（使用安全随机源）
  - [ ] 记录当前值到安全临时位置（轮换完成后销毁）

- [ ] **执行阶段**
  - [ ] 在目标系统中先更新为新值（如服务器先改密码）
  - [ ] 前往 GitHub → Settings → Secrets and variables → Actions
  - [ ] 点击对应 Secret → Update
  - [ ] 粘贴新值 → Update secret
  - [ ] **立即删除本地/临时存储的明文副本**

- [ ] **验证阶段**
  - [ ] 触发一次 CI/CD 测试运行，确认部署成功
  - [ ] 检查生产服务日志，确认无认证失败
  - [ ] 更新密钥轮换登记表（见附录）

### 5.3 PROD_SSH_KEY 轮换特别说明

SSH 密钥是最高权限凭据之一，轮换流程如下：

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 在生产服务器上生成新密钥对 | `ssh-keygen -t ed25519 -f new_deploy_key -C "globalreach-deploy"` |
| 2 | 将新公钥追加到 `authorized_keys` | `cat new_deploy_key.pub >> ~/.ssh/authorized_keys` |
| 3 | 更新 GitHub Secret `PROD_SSH_KEY` | 上传新私钥内容 |
| 4 | 验证部署连通性 | 手动触发一次 deploy workflow |
| 5 | 从 `authorized_keys` 移除旧公钥 | 确认新 key 工作后再移除 |
| 6 | 安全删除本地旧私钥 | `shred -u old_deploy_key` |

---

## 6. SSL 证书续期

### 6.1 当前方案

项目已集成 **certbot**（Let's Encrypt），配置位于 `docker-compose.prod.yml` 第335-360行：

```yaml
certbot:
  image: certbot/certbot:latest
  profiles: ["ssl"]
  volumes:
    - ./nginx/ssl/letsencrypt:/etc/letsencrypt
    - ./nginx/acme-challenge:/var/www/acme-challenge
    - /var/run/docker.sock:/var/run/docker.sock
  command: |
    certonly --webroot \
      -w /var/www/acme-challenge \
      -d api.globalreach.com \
      -d app.globalreach.com \
      -d monitor.globalreach.com \
      -d grafana.globalreach.com \
      ...
      --deploy-hook "docker exec globalreach-nginx nginx -s reload" || true
```

### 6.2 续期方案对比

| 方案 | 自动化程度 | 推荐度 | 说明 |
|------|-----------|--------|------|
| **A: certbot renew + cron（推荐）** | ⚙️ 全自动 | ✅ **推荐** | 设置 cron 定时任务 + dry-run 预检 |
| B: certbot timer（systemd） | ⚙️ 全自动 | ✅ 推荐 | Linux 原生定时器，自带随机延迟 |
| C: 手动续期 | 🔧 手动 | ❌ 不推荐 | 仅用于故障排查 |

### 6.3 推荐方案：cron 自动续期（⚙️ 可完全自动化）

在**生产服务器**上创建 crontab：

```bash
# 编辑 crontab
crontab -e

# 添加以下内容（每天凌晨 3 点检查续期，带随机延迟防止拥塞）
0 3 * * * sleep $((RANDOM % 3600)); cd /path/to/GlobalReach-Project && \
  docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew \
  --quiet --deploy-hook "docker exec globalreach-nginx nginx -s reload" \
  >> /var/log/certbot-renewal.log 2>&1

# 每月1号进行 dry-run 测试
0 4 1 * * cd /path/to/GlobalReach-Project && \
  docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew \
  --dry-run --quiet >> /var/log/certbot-dryrun.log 2>&1
```

### 6.4 续期操作手册

#### 首次申请证书

```bash
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot
```

#### 手动续期

```bash
# 正式续期
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew

# 干跑测试（不影响现有证书）
docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot renew --dry-run
```

#### 一键切换脚本

项目已提供：
```bash
bash scripts/ssl-switch-to-letsencrypt.sh
```

### 6.5 证书监控

| 检查项 | 命令 | 频率 |
|--------|------|------|
| 证书到期时间 | `openssl s_client -connect api.globalreach.com:443 -servername api.globalreach.com 2>/dev/null | openssl x509 -noout -dates` | 每周 |
| certbot 状态 | `docker compose -f docker-compose.prod.yml run --rm --profile ssl certbot certificates` | 每月 |
| 自动续期日志 | `tail -100 /var/log/certbot-renewal.log` | 异常时 |

---

## 7. SMTP 密码更新流程

### 7.1 当前 SMTP 配置

项目中存在 **两处** SMTP 配置需要同步更新：

| 位置 | 变量 | 当前值 | 服务 |
|------|------|--------|------|
| Grafana Service（docker-compose 第174行） | `GF_SMTP_PASSWORD` | `zhrtbpzlgfoehjgj`（⚠️ 硬编码） | Grafana 告警邮件 |
| AlertManager（docker-compose 第292行） | `ALERTMANAGER_SMTP_PASS` | `${ALERTMANAGER_SMTP_PASS:-}` | Prometheus 告警邮件 |
| 应用层（.env.production.template） | `SMTP_PASS` | `<CHANGE_ME>` | 业务邮件发送 |

### 7.2 QQ Mail SMTP 密码更新步骤

> **前置知识**: QQ Mail SMTP 密码不是 QQ 登录密码，而是「授权码」，在 QQ 邮箱 → 设置 → 账户 → POP3/SMTP 服务 中获取。

| # | 步骤 | 操作 | 自动化程度 |
|---|------|------|-----------|
| 1 | 登录 QQ 邮箱网页版 | mail.qq.com → 设置 → 账户 | 🔧 **手动**（必须在浏览器操作） |
| 2 | 找到 POP3/SMTP 服务 | 开启服务（如已开启则点击「生成授权码」） | 🔧 **手动** |
| 3 | 按提示验证身份 | 手机短信验证 | 🔧 **手动** |
| 4 | 获取新授权码 | 复制 16 位授权码 | 🔧 **手动** |
| 5 | 更新 Grafana 配置 | 修改 `docker-compose.prod.yml` 第174行 `GF_SMTP_PASSWORD` | 🔧 手动 |
| 6 | 更新 AlertManager 配置 | 更新 `.env.production` 中 `ALERTMANAGER_SMTP_PASS` 和 `SMTP_PASS` | 🔧 手动 |
| 7 | 更新 .env.production.template | 同步更新模板文件中的占位符 | 🔧 手动 |
| 8 | 重启 Grafana 和 AlertManager | `docker compose -f docker-compose.prod.yml up -d grafana alertmanager` | ⚙️ 半自动 |
| 9 | 发送测试邮件 | Grafana → Test Email；AlertManager 触发测试告警 | 🔧 手动 |
| 10 | 废弃旧授权码 | 在 QQ 邮箱中删除旧的授权码 | 🔧 **手动** |

### 7.3 ⚠️ 安全问题整改建议

**当前问题**: `GF_SMTP_PASSWORD` 在 `docker-compose.prod.yml` 第174行被**硬编码**：

```yaml
# 第174行 — 当前状态（不安全！）
GF_SMTP_PASSWORD: "zhrtbpzlgfoehjgj"
```

**整改方案**:

```yaml
# 改为环境变量引用（与 GF_SMTP_USER 保持一致风格）
GF_SMTP_PASSWORD: ${GF_SMTP_PASSWORD:-<CHANGE_ME>}
```

并在 `.env.production` 中设置:
```
GF_SMTP_PASSWORD=<your_qq_mail_auth_code>
```

---

## 8. 轮换频率总表

### 8.1 推荐轮换周期

| 密钥类型 | 具体密钥 | 推荐周期 | 最大容忍期 | 自动化潜力 | 优先级 |
|----------|----------|----------|-----------|-----------|--------|
| **JWT Secret** | `JWT_SECRET` | **90 天** | 120 天 | ⚙️ 高（脚本生成+部署） | P0 |
| **CSRF Secret** | `CSRF_SECRET` | **90 天** | 120 天 | ⚙️ 高 | P0 |
| **PostgreSQL 密码** | `DB_PASSWORD` | **180 天** | 365 天 | ⚙️ 中（需协调多服务） | P1 |
| **Redis 密码** | `REDIS_PASSWORD` | **180 天** | 365 天 | ⚙️ 中 | P1 |
| **Grafana 密码** | `GRAFANA_ADMIN_PASSWORD` | **90 天** | 180 天 | ⚙️ 中 | P1 |
| **SSH 部署密钥** | `PROD_SSH_KEY` | **180 天** | 365 天 | 🔧 低（需手动分发） | P1 |
| **SMTP 授权码** | `GF_SMTP_PASSWORD`, `SMTP_PASS` | **180 天** | 365 天 | 🔧 低（需浏览器操作） | P2 |
| **SSL/TLS 证书** | Let's Encrypt 证书 | **自动**（90天有效期） | N/A | ⚙️ **全自动**（certbot renew） | P0 |
| **API Keys** | 第三方服务密钥 | **按供应商要求** | — | 视供应商而定 | P2 |

### 8.2 轮换日历模板

```
┌─────────────────────────────────────────────────────────────┐
│              GlobalReach 密钥轮换年度计划                      │
├──────────┬──────────────────────────────────────────────────┤
│ 月份     │ 轮换项目                                           │
├──────────┼──────────────────────────────────────────────────┤
│  Q1 (1月) │ ✓ JWT Secret + CSRF Secret 轮换                   │
│          │ ✓ SSL 证书 dry-run 测试                            │
├──────────┼──────────────────────────────────────────────────┤
│  Q2 (4月) │ ✓ Grafana Admin Password 轮换                     │
│          │ ✓ SSH Deploy Key 轮换                              │
├──────────┼──────────────────────────────────────────────────┤
│  Q3 (7月) │ ✓ JWT Secret + CSRF Secret 轮换                   │
│          │ ✓ PostgreSQL 密码轮换                               │
│          │ ✓ Redis 密码轮换（如已启用）                         │
├──────────┼──────────────────────────────────────────────────┤
│  Q4 (10月)│ ✓ Grafana Admin Password 轮换                     │
│          │ ✓ SMTP 授权码轮换                                  │
│          │ ✓ SSH Deploy Key 轮换                              │
├──────────┼──────────────────────────────────────────────────┤
│ 每月     │ ✓ SSL 证书自动续期检查（cron）                       │
│          │ ✓ GitHub Secrets 审计                               │
└──────────┴──────────────────────────────────────────────────┘
```

### 8.3 自动化能力矩阵

| 密钥 | 生成 | 部署 | 验证 | 通知 | 总体 |
|------|------|------|------|------|------|
| JWT Secret | ✅ 自动 | ⚙️ 半自动 | ✅ 自动 | 🔧 手动 | ⚙️ 可大部分自动化 |
| DB Password | ✅ 自动 | 🔧 手动 | 🔧 手动 | 🔧 手动 | 🔧 主要手动 |
| SSL 证书 | ✅ 自动 | ✅ 自动 | ✅ 自动 | ⚙️ 半自动 | ✅ **可全自动** |
| SSH Key | 🔧 手动 | 🔧 手动 | ⚙️ 半自动 | 🔧 手动 | 🔧 主要手动 |
| SMTP 密码 | 🔧 手动 | 🔧 手动 | 🔧 手动 | 🔧 手动 | 🔴 **纯手动** |

> 图例: ✅ = 可全自动 | ⚙️ = 可半自动/脚本辅助 | 🔧 = 需手动操作

---

## 9. 紧急泄露响应 SOP

### 9.1 泄露分级

| 等级 | 定义 | 响应时间目标 | 示例场景 |
|------|------|-------------|---------|
| **P0-CRITICAL** | 生产密钥已公开（GitHub commit、日志泄漏、入侵获取） | **≤ 15 分钟** | JWT_SECRET 出现在 public repo |
| **P1-HIGH** | 怀疑泄露但未确认（异常访问日志、内部人员离职） | **≤ 2 小时** | 离职员工曾有权访问 |
| **P2-MEDIUM** | 例行轮换中发现异常或临近过期 | **≤ 24 小时** | 密码强度不足需提前更换 |

### 9.2 P0-CRITICAL 应急处理流程

```
发现泄露
   │
   ▼
┌──────────────────┐
│ ① 立即评估影响范围 │  ← 0-5 分钟
│  - 哪些密钥泄露？  │
│  - 泄露渠道？      │
│  - 已暴露多久？    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ ② 作废泄露密钥    │  ← 5-15 分钟
│  - 数据库密码:     │  ALTER USER ... WITH PASSWORD
│  - JWT Secret:    │  立即部署新值（跳过共存期）
│  - SSH Key:       │  从 authorized_keys 移除
│  - SMTP:          │  在 QQ 邮箱废弃授权码
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ ③ 轮换所有相关密钥│  ← 15-60 分钟
│  - 按本文档各章节  │
│    流程逐一更换    │
│  - 优先级:        │
│    JWT > DB > SSH │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ ④ 清理泄露源头    │  ← 60-90 分钟
│  - 删除含密钥的   │
│    git 历史       │
│  (git filter-branch │
│   / BFG Repo Cleaner)
│  - rotate all    │
│    potentially   │
│    compromised   │
│    credentials   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ ⑤ 事后审计与加固 │  ← 24 小时内
│  - 根因分析报告   │
│  - 加强访问控制   │
│  - 更新监控规则   │
│  - 团队安全培训   │
└──────────────────┘
```

### 9.3 各密钥紧急轮换速查表

| 密钥 | 紧急作废方法 | 恢复时间 | 影响范围 |
|------|-------------|---------|---------|
| **JWT_SECRET** | 立即部署新值 + Redis FLUSHDB | ~5 min | 所有用户需重新登录 |
| **DB_PASSWORD** | `ALTER USER` + 重启 api | ~10 min | 数据库连接短暂中断 |
| **GRAFANA_ADMIN_PASSWORD** | 更新 env + `docker restart` | ~2 min | Grafana 管理员需重新登录 |
| **PROD_SSH_KEY** | 移除旧公钥 + 更新 GitHub Secret | ~10 min | CI/CD 部署受影响 |
| **SMTP_PASSWORD** | 更新授权码 + 重启 grafana/alertmanager | ~5 min | 告警邮件可能短暂失败 |
| **SSL 证书** | certbot 紧急重签 | ~5 min | HTTPS 短暂不可用 |

### 9.4 Git 历史清理（当密钥曾被提交到仓库）

```bash
# 使用 BFG Repo Cleaner 清除 git 历史中的密钥
# 1. 下载 BFG: https://rtyley.github.io/bfg-repo-cleaner/
# 2. 创建 secrets.txt 文件，每行一个要清除的密钥
echo "changeme" > secrets.txt
echo "zhrtbpzlgfoehjgj" >> secrets.txt
echo "admin123" >> secrets.txt

# 3. 运行 BFG
java -jar bfg.jar --replace-text secrets.txt your-repo.git

# 4. 清理并强制推送（⚠️ 危险操作！需通知团队）
cd your-repo
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force-with-lease origin main

# 5. 旋转所有已被暴露的密钥（BFG 只清除历史，不改变当前值）
```

### 9.5 泄露事件记录模板

每次泄露响应完成后填写：

```markdown
## 密钥泄露事件记录

| 字段 | 内容 |
|------|------|
| 事件编号 | INC-YYYYMMDD-NNN |
| 发现时间 | YYYY-MM-DD HH:MM |
| 泄露密钥类型 | ☐ JWT_SECRET ☐ DB_PASSWORD ☐ SSH_KEY ☐ SMTP ☐ 其他 |
| 泄露等级 | ☐ P0-CRITICAL ☐ P1-HIGH ☐ P2-MEDIUM |
| 泄露渠道 | ☐ Git历史 ☐ 日志 ☐ 内部人员 ☐ 入侵 ☐ 其他 |
| 影响范围 | |
| 响应完成时间 | YYYY-MM-DD HH:MM |
| 总响应时长 | XX 分钟 |
| 是否通知用户 | ☐ 是 ☐ 否 |
| 根因分析 | |
| 改进措施 | |
| 负责人 | |
```

---

## 附录

### A. 密钥生成命令参考

```bash
# JWT Secret (32字节 base64, ≈43字符)
openssl rand -base64 32

# CSRF Secret (24字节 base64)
openssl rand -base64 24

# 数据库密码 (16字符字母数字特殊字符)
openssl rand -base64 16 | tr -d '=' | head -c 16; echo

# Redis 密码 (32位十六进制)
openssl rand -hex 16

# Grafana 管理员密码 (强密码, 20字符)
openssl rand -base64 20 | tr -dc 'A-Za-z0-9!@#$%^&*()_+-=' | head -c 20; echo

# SSH Key (Ed25519, 推荐)
ssh-keygen -t ed25519 -f deploy_key -C "globalreach-deploy-$(date +%Y%m%d)" -N ""
```

### B. 相关文档索引

| 文档 | 路径 | 关联内容 |
|------|------|---------|
| 部署手册 | `docs/DEPLOYMENT_PLAYBOOK.md` | 密钥部署步骤 |
| 回滚程序 | `docs/ROLLBACK_PROCEDURE.md` | 轮换失败回滚 |
| 安全笔记 | `docs/SECURITY_NOTES_G04.md` | 安全基线 |
| 运维手册 | `docs/OPERATIONS_MANUAL.md` | 日常运维操作 |
| Docker Compose | `docker-compose.prod.yml` | 密钥配置来源 |
| 环境变量模板 | `.env.production.template` | 密钥占位符 |

### C. 变更日志

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|---------|------|
| 2026-06-08 | v1.0 | 初版创建，M-C02 任务交付 | Security Team |
