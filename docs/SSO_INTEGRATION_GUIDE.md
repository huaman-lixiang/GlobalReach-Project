# SSO 单点登录集成指南 (N02)

> **版本**: 1.0 | **日期**: 2026-06-09 | **适用**: GlobalReach V2.0 Enterprise

---

## 目录

1. [协议选型对比](#1-协议选型对比)
2. [推荐方案：Passport.js 策略体系](#2-推荐方案passportjs-策略体系)
3. [集成架构图](#3-集成架构图)
4. [身份映射规则](#4-身份映射规则)
5. [会话联合管理策略](#5-会话联合管理策略)
6. [安全考量](#6-安全考量)
7. [故障回退机制](#7-故障回退机制)
8. [配置模板](#8-配置模板)
9. [API 端点说明](#9-api-端点说明)

---

## 1. 协议选型对比

| 特性 | LDAP | OAuth2 | OIDC | SAML |
|------|------|--------|------|------|
| **协议类型** | 目录服务认证 | 授权框架 | 认证层（OAuth2 扩展） | XML 断言交换 |
| **典型场景** | 企业内网 AD/域控 | 第三方应用授权 | 统一身份认证 | 企业级联邦 |
| **Token 格式** | Bind DN 验证 | Access Token | ID Token (JWT) + Access Token | SAML Assertion |
| **用户信息** | AD 属性查询 | Provider API 调用 | ID Token 内嵌 claims | Attribute Statement |
| **实现复杂度** | ⭐⭐ 低 | ⭐⭐⭐ 中 | ⭐⭐⭐ 中 | ⭐⭐⭐⭐⭐ 高 |
| **SPA 友好度** | ❌ 需代理 | ✅ 好 | ✅ 最佳 | ⚠️ 需代理 |
| **推荐场景** | Active Directory 集成 | GitHub/企业微信/钉钉 | Keycloak/Auth0/Google | 传统企业 IdP |

### GlobalReach 选型决策

```
┌─────────────────────────────────────────────────────┐
│              GlobalReach SSO 协议矩阵                │
├──────────┬──────────┬──────────┬───────────────────┤
│  LDAP    │ OAuth2   │   OIDC   │    适用 Provider   │
├──────────┼──────────┼──────────┼───────────────────┤
│  ✅ AD   │  ✅ Google │  ✅ Keycloak │  企业内网       │
│  ✅ 域控  │  ✅ GitHub │  ✅ Auth0  │  云端 IdP      │
│          │  ✅ 企业微信│  ✅ Okta   │  标准化部署     │
│          │  ✅ 钉钉   │           │                │
└──────────┴──────────┴──────────┴───────────────────┘

统一抽象层: Passport.js Strategy 模式
```

**推荐**: 以 **OIDC** 为首选协议，**OAuth2** 为补充，**LDAP** 作为企业内网降级方案。

---

## 2. 推荐方案：Passport.js 策略体系

### 技术栈

```javascript
// 核心依赖
const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');      // OAuth2 通用
const OpenIDConnectStrategy = require('passport-openidconnect'); // OIDC
const LdapStrategy = require('passport-ldapauth');       // LDAP/AD
```

### 策略注册模式

```
Passport.js
├── google-strategy      → passport-oauth2 (Google OIDC)
├── github-strategy      → passport-oauth2 (GitHub OAuth2)
├── wecom-strategy       → passport-oauth2 (企业微信 OAuth2)
├── dingtalk-strategy    → passport-oauth2 (钉钉 OAuth2)
├── keycloak-strategy    → passport-openidconnect (Keycloak OIDC)
├── auth0-strategy       → passport-openidconnect (Auth0 OIDC)
└── ldap-strategy        → passport-ldapauth (Active Directory)
```

### 设计原则

1. **增量集成**: SSO 作为现有 JWT 认证的补充，不替换本地登录
2. **策略懒加载**: 仅在 `.env` 启用对应 Provider 时注册策略
3. **统一回调**: 所有 SSO 策略共享同一套 user provisioning 和 token issuance 逻辑
4. **可扩展性**: 新增 Provider 只需添加配置 + 可选的自定义映射器

---

## 3. 集成架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         浏览器 (React SPA)                          │
│                                                                     │
│  ┌──────────┐  ┌─────────────────────────────────────────────────┐  │
│  │ Login.tsx│  │  Settings.tsx                                   │  │
│  │          │  │  ┌─────────────┐  ┌──────────────────────────┐  │  │
│  │[本地登录] │  │  │SSO 绑定状态  │  │ Link / Unlink SSO 身份   │  │  │
│  │[Google]  │  │  └─────────────┘  └──────────────────────────┘  │  │
│  │[GitHub]  │  │                                                  │  │
│  │[企业微信] │  └─────────────────────────────────────────────────┘  │
│  │[钉钉]    │                                                      │
│  │[Keycloak]│                                                      │
│  └────┬─────┘                                                      │
│       │                                                             │
└───────┼─────────────────────────────────────────────────────────────┘
        │ 1. GET /api/v1/sso/:provider/login  (302 → IdP)
        │ 4. GET /api/v1/sso/:provider/callback (IdP 回调)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Express.js 后端                                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    api/routes/sso.js                         │  │
│  │  GET  /sso/providers          → 列出已启用 Provider            │  │
│  │  GET  /sso/:provider/login    → 发起 SSO 重定向               │  │
│  │  GET  /sso/:provider/callback → 处理 IdP 回调                 │  │
│  │  POST /sso/link              → 链接 SSO 到当前账户            │  │
│  │  POST /sso/unlink            → 解除 SSO 链接                  │  │
│  │  GET  /sso/status            → 当前用户 SSO 绑定状态           │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
│                         │                                           │
│  ┌──────────────────────▼───────────────────────────────────────┐  │
│  │                  api/services/ssoService.js                   │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────┐     │  │
│  │  │              Passport.js 初始化                       │     │  │
│  │  │  • 策略懒加载 & 动态注册                               │     │  │
│  │  │  • serializeUser / deserializeUser                    │     │  │
│  │  └──────────────────────┬──────────────────────────────┘     │  │
│  │                         │                                     │  │
│  │  ┌──────────────────────▼──────────────────────────────┐     │  │
│  │  │           User Provisioning Engine                   │     │  │
│  │  │  • findOrCreateBySSO() — 首次登录自动创建             │     │  │
│  │  │  • attributeMapper — SSO 属性 → 本地字段映射          │     │  │
│  │  │  • identityLinker — link/unlink SSO Identity         │     │  │
│  │  └──────────────────────┬──────────────────────────────┘     │  │
│  │                         │                                     │  │
│  │  ┌──────────────────────▼──────────────────────────────┐     │  │
│  │  │           Session Federation                        │     │  │
│  │  │  • SSO callback → JWT token issuance                │     │  │
│  │  │  • 复用现有 generateAccessToken / createRefreshToken  │     │  │
│  │  └─────────────────────────────────────────────────────┘     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              api/middleware/auth.js (已有)                     │  │
│  │  • verifyToken — JWT 验证中间件（不变）                        │  │
│  │  • createRefreshToken — Refresh Token 创建（复用）             │  │
│  │  • generateAccessToken — Access Token 生成（复用）             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              api/db/index.js (已有)                            │  │
│  │  • User model — SSO 用户存储在 users 表                        │  │
│  │  • metadata JSON 字段 — 存储 SSO identities 信息              │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
        │ 2. 302 Redirect → Google/GitHub/IdP 登录页
        │ 3. 用户在 IdP 完成认证 → callback URL + authorization code
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      外部 Identity Provider                        │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐   │
│  │ Google  │ │ GitHub  │ │ 企业微信  │ │  钉钉   │ │ Keycloak │   │
│  │ (OIDC)  │ │(OAuth2) │ │ (OAuth2) │ │(OAuth2) │ │  (OIDC)  │   │
│  └─────────┘ └─────────┘ └──────────┘ └─────────┘ └──────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Active Directory (LDAP)                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 身份映射规则

### SSO 属性 → 本地 User 字段映射

| 本地字段 | Google OIDC | GitHub OAuth2 | 企业微信 | 钉钉 | Keycloak OIDC | LDAP (AD) |
|----------|-------------|---------------|----------|------|---------------|-----------|
| `email` | `email` | `emails[0]?.value` (需 user:email scope) | `userid@corp` (拼接) | `unionid` 或 `mobile` | `email` | `mail` / `userPrincipalName` |
| `name` | `name` | `name` 或 `login` | `name` | `nickname` | `name` / `preferred_username` | `displayName` / `cn` |
| `avatar` | `picture` | `avatar_url` | `avatar` | `avatarUrl` | `picture` | `thumbnailPhoto` (base64) |
| `role` | *(默认 USER)* | *(默认 USER)* | *(按部门映射)* | *(默认 USER)* | `roles` / `groups` → RBAC 映射 | `memberOf` → group → role |

### 默认角色映射逻辑

```javascript
// SSO 用户默认角色为 USER
// 可通过以下方式覆盖：
// 1. Keycloak/OIDC: 从 token claims 的 roles/groups 字段提取
// 2. LDAP: 从 memberOf 属性匹配 CN=AdminGroup → ADMIN
// 3. 配置文件: sso-providers.json 中的 roleMapping 规则
```

### SSO Identity 存储结构

SSO 身份链接信息存储在 **User.metadata JSON 字段**中：

```json
{
  "ssoIdentities": {
    "google": {
      "provider": "google",
      "providerUserId": "google-oauth2-123456789",
      "linkedAt": "2026-06-09T00:00:00Z",
      "lastLoginAt": "2026-06-09T00:00:00Z"
    },
    "github": {
      "provider": "github",
      "providerUserId": "12345",
      "linkedAt": "2026-06-09T00:00:00Z",
      "lastLoginAt": "2026-06-09T00:00:00Z"
    }
  }
}
```

---

## 5. 会话联合管理策略

### SSO 登录 → JWT Token 颁发流程

```
1. 用户点击 "使用 Google 登录"
2. 前端 → GET /api/v1/sso/google/login
3. 后端生成 state 参数（防 CSRF），存入 session/Redis
4. 302 重定向到 Google 授权页面
5. 用户在 Google 完成认证并授权
6. Google 重定向回 → GET /api/v1/sso/google/callback?code=xxx&state=yyy
7. Passport.js 用 code 换取 access_token + id_token (OIDC) / user profile (OAuth2)
8. ssoService.findOrCreateBySSO(profile):
   a. 按 provider+providerUserId 查找已存在的 SSO identity
   b. 若找到 → 返回关联的本地 User
   c. 若未找到 → 自动创建新 User（auto-provisioning）
9. 使用现有 auth 中间件颁发:
   - accessToken (JWT, 15min)
   - refreshToken (DB 存储, 7d)
   - csrfToken
10. 前端重定向到 /dashboard?token=xxx （或通过 postMessage 传递）
``### 关键设计决策

| 决策项 | 方案 | 理由 |
|--------|------|------|
| **Token 传递** | Callback 返回 JSON → 前端轮询/API 获取 | 避免 URL fragment 安全风险 |
| **Session 存储** | Redis / 内存（state 参数） | 无状态设计，适合容器化部署 |
| **Auto-Provisioning** | 默认开启，可配置关闭 | 降低首次使用门槛 |
| **Account Linking** | 已登录状态下 link；未登录时自动创建 | 支持多身份联合 |

---

## 6. 安全考量

### 6.1 State 参数（防 CSRF）

```javascript
// 每次发起 SSO 登录时生成随机 state
const state = crypto.randomBytes(32).toString('hex');
// 存入 session/临时存储，callback 时验证
await tempStore.set(`sso_state:${state}`, { provider, expiresAt }, 300); // 5min TTL
```

### 6.2 Nonce 参数（OIDC Replay 防护）

```javascript
// OIDC 流程额外使用 nonce
const nonce = crypto.randomBytes(16).toString('hex');
// 存入 session，验证 ID Token 中的 nonce claim
```

### 6.3 PKCE（OAuth2 公开客户端）

对于 SPA 场景（无 client_secret），启用 **PKCE** (Proof Key for Code Exchange):

```
Authorization Request:
  code_challenge = BASE64URL(SHA256(code_verifier))
  code_challenge_method = S256

Token Exchange:
  code_verifier = <原始随机数>
```

### 6.4 Token Exchange 安全

- **Callback URL 白名单**: 严格限制 redirect_uri 为预配置值
- **Scope 最小权限**: 仅请求必要的 scope（email, profile, openid）
- **HTTPS 强制**: 所有 SSO 重定向必须走 HTTPS
- **Token 加密存储**: Refresh Token 做 SHA256 哈希后存库

### 6.5 安全检查清单

- [ ] State 参数验证（每次请求唯一，一次性使用）
- [ ] Nonce 验证（OIDC 必须校验 ID Token nonce claim）
- [ ] Redirect URI 白名单校验
- [ ] PKCE 启用（SPA 场景）
- [ ] CSRF Token 保护 link/unlink 端点
- [ ] Rate Limiting（防止暴力枚举 SSO callback）
- [ ] Audit Logging（所有 SSO 操作记录审计日志）

---

## 7. 故障回退机制

### 降级策略

```
┌──────────────────────────────────────────────────────┐
│                 SSO 故障检测与回退                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  SSO Provider 不可达？                                 │
│  ├── 连接超时 (>10s)                                  │
│  ├── HTTP 5xx 错误                                    │
│  ├── Token exchange 失败                              │
│  └── SSL/TLS 证书问题                                 │
│         │                                            │
│         ▼                                            │
│  ┌─────────────────────┐                             │
│  │  自动降级到本地登录    │ ◄── 始终可用               │
│  │  (邮箱 + 密码)       │                             │
│  └─────────────────────┘                             │
│                                                      │
│  前端表现：                                           │
│  • SSO 按钮置灰 + tooltip "服务暂时不可用"             │
│  • 本地登录表单始终显示且可用                           │
│  • 显示友好的错误提示信息                              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 实现要点

1. **超时控制**: SSO 请求设置 10s 超时
2. **健康检查**: `/sso/providers` 端点返回各 Provider 连通状态
3. **优雅降级**: SSO 失败不影响本地登录流程
4. **监控告警**: SSO 失败事件写入 ErrorLog + AuditLog

---

## 8. 配置模板

### .env 变量

```bash
# ============================================
# SSO 全局配置
# ============================================
SSO_ENABLED=true                          # SSO 功能总开关
SSO_AUTO_PROVISIONING=true                 # 首次登录自动创建用户
SSO_CALLBACK_BASE_URL=https://app.globalreach.com  # 回调地址
SSO_SESSION_SECRET=sso-session-secret-key  # State/Nonce 加密密钥

# ============================================
# Google (OIDC / OAuth2)
# ============================================
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=/api/v1/sso/google/callback
GOOGLE_SCOPE=email profile openid

# ============================================
# GitHub (OAuth2)
# ============================================
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=/api/v1/sso/github/callback
GITHUB_SCOPE=user:email

# ============================================
# 企业微信 (OAuth2)
# =================================-----------
WECOM_CORP_ID=your-corp-id
WECOM_AGENT_ID=your-agent-id
WECOM_SECRET=your-wecom-secret
WECOM_CALLBACK_URL=/api/v1/sso/wecom/callback

# ============================================
# 钉钉 (OAuth2)
# ============================================
DINGTALK_APP_KEY=your-app-key
DINGTALK_APP_SECRET=your-app-secret
DINGTALK_CALLBACK_URL=/api/v1/sso/dingtalk/callback
DINGTALK_SCOPE=openid corpid

# ============================================
# Keycloak (OIDC)
# ============================================
KEYCLOAK_REALM=globalreach
KEYCLOAK_AUTH_SERVER_URL=https://keycloak.example.com/auth
KEYCLOAK_CLIENT_ID=globalreach-client
KEYCLOAK_CLIENT_SECRET=your-keycloak-client-secret
KEYCLOAK_CALLBACK_URL=/api/v1/sso/keycloak/callback

# ============================================
# Auth0 (OIDC)
# ============================================
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret
AUTH0_CALLBACK_URL=/api/v1/sso/auth0/callback

# ============================================
# LDAP / Active Directory
# ============================================
LDAP_URL=ldaps://ad.example.com:636
LDAP_BIND_DN=CN=service-account,OU=ServiceAccounts,DC=example,DC=com
LDAP_BIND_PASSWORD=service-account-password
LDAP_SEARCH_BASE=OU=Users,DC=example,DC=com
LDAP_SEARCH_FILTER=(sAMAccountName={{username}})
LDAP_SEARCH_ATTRIBUTES=mail displayName memberOf thumbnailPhoto
LDAP_TLS_CA_CERTS=path/to/ca-cert.pem  # 可选
```

---

## 9. API 端点说明

### 端点列表

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| `GET` | `/api/v1/sso/providers` | 否 | 列出已启用的 SSO 提供商及状态 |
| `GET` | `/api/v1/sso/:provider/login` | 否 | 发起 SSO 登录（302 重定向） |
| `GET` | `/api/v1/sso/:provider/callback` | 否 | SSO 回调处理（由 IdP 调用） |
| `POST` | `/api/v1/sso/link` | 是 (JWT) | 将 SSO 身份链接到当前账户 |
| `POST` | `/api/v1/sso/unlink` | 是 (JWT) | 解除 SSO 身份链接 |
| `GET` | `/api/v1/sso/status` | 是 (JWT) | 获取当前用户的 SSO 绑定状态 |

### 响应格式示例

**GET /sso/providers**
```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "name": "google",
        "displayName": "Google",
        "type": "oidc",
        "enabled": true,
        "icon": "google",
        "loginUrl": "/api/v1/sso/google/login"
      },
      {
        "name": "github",
        "displayName": "GitHub",
        "type": "oauth2",
        "enabled": true,
        "icon": "github",
        "loginUrl": "/api/v1/sso/github/login"
      }
    ]
  }
}
```

**GET /sso/status**
```json
{
  "success": true,
  "data": {
    "linkedProviders": [
      {
        "provider": "google",
        "providerUserId": "google-oauth2-123456789",
        "linkedAt": "2026-06-09T00:00:00Z",
        "lastLoginAt": "2026-06-09T12:00:00Z"
      }
    ],
    "availableProviders": ["google", "github", "wecom", "dingtalk", "keycloak", "ldap"]
  }
}
```

---

## 附录：数据库变更

> SSO 集成 **不需要新增数据库表**。所有 SSO 身份信息存储在现有 `users` 表的 `metadata` JSON 字段中。

如未来需要更复杂的 SSO 身份管理（如多租户 SSO），可考虑新增 `sso_identities` 表：

```sql
-- 未来可选：独立的 SSO Identity 表
CREATE TABLE sso_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,           -- 'google', 'github', 'ldap'
  provider_user_id VARCHAR(255) NOT NULL,   -- IdP 端的用户标识
  access_token TEXT,                        -- 加密存储的 OAuth token
  refresh_token TEXT,                       -- 加密存储的 refresh token
  token_expires_at TIMESTAMP,
  raw_profile JSONB,                        -- 原始 IdP profile 数据
  linked_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP,
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_sso_identities_user_id ON sso_identities(user_id);
CREATE INDEX idx_sso_identities_provider ON sso_identities(provider);
```
