/**
 * SSO Service (N02 Single Sign-On Integration)
 *
 * 基于 Passport.js 的统一 SSO 认证服务，支持：
 *   - OAuth2: Google, GitHub, 企业微信, 钉钉
 *   - OIDC:  Keycloak, Auth0
 *   - LDAP:  Active Directory
 *
 * 核心功能：
 *   - Passport.js 策略初始化与动态注册
 *   - SSO 用户自动 provisioning（首次登录自动创建本地用户）
 *   - 身份链接/解链（link/unlink SSO identity 到本地账户）
 *   - State/Nonce 安全参数管理
 *   - 与现有 JWT Dual-Token 系统的无缝集成
 */

const crypto = require('crypto');
const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2').Strategy;
const OpenIDConnectStrategy = require('passport-openidconnect').Strategy;
const LdapStrategy = require('passport-ldapauth').Strategy;

const db = require('../db');
const {
  generateAccessToken,
  createRefreshToken,
} = require('../middleware/auth');

// ============================================
// 配置加载
// ============================================

let providerConfig = null;

/**
 * 加载 SSO Provider 配置（懒加载 + 缓存）
 */
function loadProviderConfig() {
  if (providerConfig) return providerConfig;

  try {
    providerConfig = require('../config/sso-providers.json');
    return providerConfig;
  } catch (error) {
    console.warn('[SSO] 未找到 sso-providers.json，使用默认配置');
    return { global: {}, providers: {} };
  }
}

/**
 * 检查某个 Provider 是否已启用
 * @param {string} providerName - Provider 名称
 * @returns {boolean}
 */
function isProviderEnabled(providerName) {
  const config = loadProviderConfig();
  const provider = config.providers[providerName];
  if (!provider || provider.enabled === false) return false;

  // 检查必要的环境变量是否存在
  switch (providerName) {
    case 'google': return !!process.env.GOOGLE_CLIENT_ID;
    case 'github': return !!process.env.GITHUB_CLIENT_ID;
    case 'wecom': return !!process.env.WECOM_CORP_ID;
    case 'dingtalk': return !!process.env.DINGTALK_APP_KEY;
    case 'keycloak': return !!process.env.KEYCLOAK_AUTH_SERVER_URL;
    case 'auth0': return !!process.env.AUTH0_DOMAIN;
    case 'ldap': return !!process.env.LDAP_URL;
    default: return false;
  }
}

/**
 * 获取所有已启用的 Provider 列表
 * @returns {Array<{name: string, displayName: string, type: string, icon: string, enabled: boolean}>}
 */
function getEnabledProviders() {
  const config = loadProviderConfig();
  const allProviders = Object.keys(config.providers || {});

  return allProviders
    .map(name => ({
      name,
      displayName: config.providers[name]?.displayName || name,
      type: config.providers[name]?.type || 'oauth2',
      icon: config.providers[name]?.icon || name,
      enabled: isProviderEnabled(name),
      loginUrl: `/api/v1/sso/${name}/login`,
    }))
    .filter(p => p.enabled);
}

// ============================================
// State / Nonce 管理（内存存储，生产环境建议用 Redis）
// ============================================

const stateStore = new Map();

/**
 * 生成并存储 state 参数（防 CSRF）
 * @param {string} provider - Provider 名称
 * @param {object} [extraData] - 额外数据
 * @returns {string} state 值
 */
function generateState(provider, extraData = {}) {
  const state = crypto.randomBytes(32).toString('hex');
  stateStore.set(state, {
    provider,
    createdAt: Date.now(),
    ...extraData,
  });
  // 10 分钟后自动清理
  setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);
  return state;
}

/**
 * 验证 state 参数（一次性使用）
 * @param {string} state - 待验证的 state
 * @returns {object|null} state 数据或 null（验证失败）
 */
function validateAndConsumeState(state) {
  if (!state || !stateStore.has(state)) return null;
  const data = stateStore.get(state);
  // 检查是否过期（10分钟）
  if (Date.now() - data.createdAt > 10 * 60 * 1000) {
    stateStore.delete(state);
    return null;
  }
  // 一次性使用，立即删除
  stateStore.delete(state);
  return data;
}

/**
 * 生成 OIDC nonce 参数
 * @returns {string}
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

// ============================================
// Passport.js 初始化
// ============================================

/**
 * 初始化 Passport.js 并注册所有启用的 SSO 策略
 * 必须在 app.use(passport.initialize()) 之前调用
 * @param {express.Application} app - Express 应用实例
 */
function initializePassport(app) {
  if (!app) {
    throw new Error('[SSO] initializePassport 需要传入 Express app 实例');
  }

  // 序列化用户：将 user.id 存入 session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // 反序列化用户：从 DB 查询完整用户信息
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await db.User.findByPk(id, {
        attributes: { exclude: ['passwordHash'] },
      });
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  // 注册各策略
  registerGoogleStrategy();
  registerGitHubStrategy();
  registerWeComStrategy();
  registerDingTalkStrategy();
  registerKeycloakStrategy();
  registerAuth0Strategy();
  registerLdapStrategy();

  app.use(passport.initialize());
  console.log('[SSO] Passport.js 初始化完成');
}

// ============================================
// 策略注册：Google (OIDC / OAuth2)
// ============================================

function registerGoogleStrategy() {
  if (!isProviderEnabled('google')) return;

  const config = loadProviderConfig().providers.google;

  passport.use('google', new OAuth2Strategy({
    authorizationURL: config.authorizationURL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenURL: config.tokenURL || 'https://oauth2.googleapis.com/token',
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: config.callbackURL || '/api/v1/sso/google/callback',
    scope: config.scope || ['email', 'profile', 'openid'],
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, params, profile, done) => {
    try {
      // Google OIDC 返回 id_token 时解析用户信息
      let userInfo = profile;

      if (params.id_token) {
        // 解析 ID Token 获取更完整的用户信息
        const decoded = decodeJwtPayload(params.id_token);
        userInfo = {
          id: decoded.sub,
          email: decoded.email,
          name: decoded.name,
          avatar: decoded.picture,
          emailVerified: decoded.email_verified,
        };
      } else if (accessToken) {
        // 回退到 UserInfo Endpoint
        userInfo = await fetchOAuth2UserInfo(
          config.userInfoURL || 'https://www.googleapis.com/oauth2/v2/userinfo',
          accessToken
        );
      }

      const ssoUser = await findOrCreateBySSO('google', userInfo);
      done(null, ssoUser);
    } catch (error) {
      console.error('[SSO/Google] 策略回调错误:', error.message);
      done(error);
    }
  }));

  console.log('[SSO] Google 策略已注册');
}

// ============================================
// 策略注册：GitHub (OAuth2)
// ============================================

function registerGitHubStrategy() {
  if (!isProviderEnabled('github')) return;

  const config = loadProviderConfig().providers.github;

  passport.use('github', new OAuth2Strategy({
    authorizationURL: config.authorizationURL || 'https://github.com/login/oauth/authorize',
    tokenURL: config.tokenURL || 'https://github.com/login/oauth/access_token',
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: config.callbackURL || '/api/v1/sso/github/callback',
    scope: config.scope || ['user:email'],
    passReqToCallback: true,
    customHeaders: { Accept: 'application/json' },
  }, async (req, accessToken, refreshToken, params, profile, done) => {
    try {
      // GitHub 需要额外请求用户邮箱和头像
      let userInfo = profile;

      if (accessToken) {
        const [githubProfile, emails] = await Promise.all([
          fetchOAuth2UserInfo(
            config.userProfileURL || 'https://api.github.com/user',
            accessToken
          ),
          fetchOAuth2UserInfo(
            config.userEmailURL || 'https://api.github.com/user/emails',
            accessToken
          ),
        ]);

        userInfo = {
          id: String(githubProfile.id),
          email: extractPrimaryEmail(emails) || `${githubProfile.login}@github.local`,
          name: githubProfile.name || githubProfile.login,
          avatar: githubProfile.avatar_url,
          login: githubProfile.login,
        };
      }

      const ssoUser = await findOrCreateBySSO('github', userInfo);
      done(null, ssoUser);
    } catch (error) {
      console.error('[SSO/GitHub] 策略回调错误:', error.message);
      done(error);
    }
  }));

  console.log('[SSO] GitHub 策略已注册');
}

// ============================================
// 策略注册：企业微信 (OAuth2)
// ============================================

function registerWeComStrategy() {
  if (!isProviderEnabled('wecom')) return;

  const config = loadProviderConfig().providers.wecom;

  passport.use('wecom', new OAuth2Strategy({
    authorizationURL: config.authorizationURL || 'https://open.weixin.qq.com/connect/oauth2/authorize',
    tokenURL: config.tokenURL || 'https://qyapi.weixin.cgi/cgi-bin/gettoken',
    clientID: process.env.WECOM_CORP_ID,
    clientSecret: process.env.WECOM_SECRET,
    callbackURL: config.callbackURL || '/api/v1/sso/wecom/callback',
    scope: config.scope || ['snsapi_base'],
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, params, profile, done) => {
    try {
      // 企业微信需要用 access_token 获取用户信息
      let userInfo = profile;

      if (accessToken && req.query.code) {
        const corpId = process.env.WECOM_CORP_ID;
        const agentId = process.env.WECOM_AGENT_ID;
        // 先获取 user_ticket，再获取用户详情
        const userIdRes = await fetchOAuth2UserInfo(
          `https://qyapi.weixin.cgi/cgi-bin/user/getuserinfo?access_token=${accessToken}&code=${req.query.code}`
        );
        const userId = userIdRes.userid || userIdRes.UserId;

        if (userId && agentId) {
          const userDetail = await fetchOAuth2UserInfo(
            `https://qyapi.weixin.cgi/cgi-bin/user/get?access_token=${accessToken}&userid=${userId}`
          );
          userInfo = {
            id: userId,
            email: userDetail.email || `${userId}@${corpId}.wecom.local`,
            name: userDetail.name || userId,
            avatar: userDetail.avatar,
            mobile: userDetail.mobile,
            department: userDetail.department,
          };
        } else {
          userInfo = { id: userId, email: `${userId}@${corpId}.wecom.local`, name: userId };
        }
      }

      const ssoUser = await findOrCreateBySSO('wecom', userInfo);
      done(null, ssoUser);
    } catch (error) {
      console.error('[SSO/WeCom] 策略回调错误:', error.message);
      done(error);
    }
  }));

  console.log('[SSO] 企业微信策略已注册');
}

// ============================================
// 策略注册：钉钉 (OAuth2)
// ============================================

function registerDingTalkStrategy() {
  if (!isProviderEnabled('dingtalk')) return;

  const config = loadProviderConfig().providers.dingtalk;

  passport.use('dingtalk', new OAuth2Strategy({
    authorizationURL: config.authorizationURL || 'https://oapi.dingtalk.com/connect/qrconnect',
    tokenURL: config.tokenURL || 'https://oapi.dingtalk.com/v1.0/oauth2/userAccessToken',
    clientID: process.env.DINGTALK_APP_KEY,
    clientSecret: process.env.DINGTALK_APP_SECRET,
    callbackURL: config.callbackURL || '/api/v1/sso/dingtalk/callback',
    scope: config.scope || ['openid', 'corpid'],
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, params, profile, done) => {
    try {
      let userInfo = profile;

      if (accessToken) {
        // 钉钉通过 authCode 获取用户信息
        const userDetail = await fetchOAuth2UserInfo(
          `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${accessToken}`,
          null,
          { userid: req.query.authCode || req.query.code }
        );

        const result = userDetail.result || userDetail;
        userInfo = {
          id: result.unionid || result.userid,
          email: result.mobile || `${result.unionid}@dingtalk.local`,
          name: result.nick || result.username,
          avatar: result.avatarUrl,
        };
      }

      const ssoUser = await findOrCreateBySSO('dingtalk', userInfo);
      done(null, ssoUser);
    } catch (error) {
      console.error('[SSO/DingTalk] 策略回调错误:', error.message);
      done(error);
    }
  }));

  console.log('[SSO] 钉钉策略已注册');
}

// ============================================
// 策略注册：Keycloak (OIDC)
// ============================================

function registerKeycloakStrategy() {
  if (!isProviderEnabled('keycloak')) return;

  const config = loadProviderConfig().providers.keycloak;
  const realm = process.env.KEYCLOAK_REALM || 'globalreach';
  const authServerURL = process.env.KEYCLOAK_AUTH_SERVER_URL;

  passport.use('keycloak', new OpenIDConnectStrategy({
    issuer: `${authServerURL}/realms/${realm}`,
    authorizationURL: `${authServerURL}/realms/${realm}/protocol/openid-connect/auth`,
    tokenURL: `${authServerURL}/realms/${realm}/protocol/openid-connect/token`,
    userInfoURL: `${authServerURL}/realms/${realm}/protocol/openid-connect/userinfo`,
    clientID: process.env.KEYCLOAK_CLIENT_ID,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    callbackURL: config.callbackURL || '/api/v1/sso/keycloak/callback',
    scope: config.scope || ['openid', 'profile', 'email'],
    passReqToCallback: true,
  }, async (req, issuer, sub, profile, jwtClaims, accessToken, refreshToken, idToken, done) => {
    try {
      // 从 Keycloak JWT claims 中提取角色映射
      const roles = jwtClaims.resource_access?.[process.env.KEYCLOAK_CLIENT_ID]?.roles || [];
      const groups = jwtClaims.groups || [];

      const mappedRole = mapRolesFromGroups(roles, groups, config.roleMapping);

      const userInfo = {
        id: sub,
        email: profile.emails?.[0] || profile._json?.email,
        name: profile.displayName || profile.name?.givenName,
        avatar: profile.photos?.[0]?.value,
        role: mappedRole,
        rawGroups: groups,
        rawRoles: roles,
      };

      const ssoUser = await findOrCreateBySSO('keycloak', userInfo, mappedRole);
      done(null, ssoUser);
    } catch (error) {
      console.error('[SSO/Keycloak] 策略回调错误:', error.message);
      done(error);
    }
  }));

  console.log('[SSO] Keycloak 策略已注册');
}

// ============================================
// 策略注册：Auth0 (OIDC)
// ============================================

function registerAuth0Strategy() {
  if (!isProviderEnabled('auth0')) return;

  const config = loadProviderConfig().providers.auth0;
  const domain = process.env.AUTH0_DOMAIN;

  passport.use('auth0', new OpenIDConnectStrategy({
    issuer: `https://${domain}`,
    authorizationURL: `https://${domain}/authorize`,
    tokenURL: `https://${domain}/oauth/token`,
    userInfoURL: `https://${domain}/userinfo`,
    clientID: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    callbackURL: config.callbackURL || '/api/v1/sso/auth0/callback',
    scope: config.scope || ['openid', 'profile', 'email'],
    passReqToCallback: true,
  }, async (req, issuer, sub, profile, jwtClaims, accessToken, refreshToken, idToken, done) => {
    try {
      const userInfo = {
        id: sub,
        email: profile.emails?.[0] || profile._json?.email,
        name: profile.displayName || profile.name?.givenName,
        avatar: profile.photos?.[0]?.value,
      };

      const ssoUser = await findOrCreateBySSO('auth0', userInfo);
      done(null, ssoUser);
    } catch (error) {
      console.error('[SSO/Auth0] 策略回调错误:', error.message);
      done(error);
    }
  }));

  console.log('[SSO] Auth0 策略已注册');
}

// ============================================
// 策略注册：LDAP / Active Directory
// ============================================

function registerLdapStrategy() {
  if (!isProviderEnabled('ldap')) return;

  const config = loadProviderConfig().providers.ldap;

  passport.use('ldap', new LdapStrategy({
    url: process.env.LDAP_URL,
    bindDN: process.env.LDAP_BIND_DN,
    bindCredentials: process.env.LDAP_BIND_PASSWORD,
    searchBase: process.env.LDAP_SEARCH_BASE,
    searchFilter: process.env.LDAP_SEARCH_FILTER || '(sAMAccountName={{username}})',
    searchAttributes: config.searchAttributes || ['mail', 'displayName', 'memberOf', 'thumbnailPhoto'],
    tlsOptions: process.env.LDAP_TLS_CA_CERTS ? {
      ca: [require('fs').readFileSync(process.env.LDAP_TLS_CA_CERTS)],
    } : undefined,
  }, async (user, done) => {
    try {
      // LDAP 属性映射
      const configMap = config.attributeMap || {};
      const userInfo = {
        id: user.dn || user.uid,
        email: user[configMap.email || 'mail'] || `${user.uid}@ldap.local`,
        name: user[configMap.name || 'displayName'] || user.cn || user.uid,
        avatar: user[configMap.avatar || 'thumbnailPhoto'] || null,
        memberOf: user.memberOf || [],
      };

      // 从 LDAP 组映射角色
      const mappedRole = mapLdapGroupsToRole(userInfo.memberOf, config.roleMapping);

      const ssoUser = await findOrCreateBySSO('ldap', userInfo, mappedRole);
      done(null, ssoUser);
    } catch (error) {
      console.error('[SSO/LDAP] 策略回调错误:', error.message);
      done(error);
    }
  }));

  console.log('[SSO] LDAP/AD 策略已注册');
}

// ============================================
// User Provisioning Engine（核心：查找或创建用户）
// ============================================

/**
 * 根据 SSO Profile 查找或创建本地用户
 * 支持自动 provisioning（首次登录自动创建本地账户）
 *
 * @param {string} provider - Provider 名称 ('google', 'github', ...)
 * @param {object} ssoProfile - IdP 返回的用户属性
 * @param {string} [forcedRole] - 强制指定的角色（来自组/角色映射）
 * @returns {Promise<object>} 本地 User 实例
 */
async function findOrCreateBySSO(provider, ssoProfile, forcedRole = null) {
  const autoProvisioning = process.env.SSO_AUTO_PROVISIONING !== 'false';
  const defaultRole = forcedRole || loadProviderConfig().global?.defaultRole || 'USER';

  // 1. 尝试按 provider+providerUserId 查找已有 SSO identity
  const providerUserId = buildProviderUserId(provider, ssoProfile);
  const existingUser = await findUserBySSOIdentity(provider, providerUserId);

  if (existingUser) {
    // 找到已有用户 → 更新 lastLoginAt 和 SSO identity 信息
    await updateSSOLoginMetadata(existingUser, provider, providerUserId);
    return existingUser;
  }

  // 2. 尝试按 email 匹配已有本地账户（支持账号关联）
  const email = normalizeEmail(ssoProfile.email);
  if (email) {
    const userByEmail = await db.User.findOne({ where: { email } });
    if (userByEmail) {
      // 找到同邮箱的本地账户 → 链接 SSO identity（不创建新用户）
      await linkSSOIdentity(userByEmail, provider, providerUserId);
      await updateSSOLoginMetadata(userByEmail, provider, providerUserId);
      return userByEmail;
    }
  }

  // 3. 自动 provisioning：创建新用户
  if (!autoProvisioning) {
    throw Object.assign(
      new Error(`SSO 用户 ${provider}:${providerUserId} 不存在且自动创建已禁用`),
      { code: 'SSO_PROVISIONING_DISABLED' }
    );
  }

  // 创建新用户
  const newUser = await db.User.create({
    email,
    passwordHash: `__sso_${provider}_${Date.now()}__`, // SSO 用户无密码，占位值
    name: ssoProfile.name || `SSO User (${provider})`,
    role: defaultRole,
    isActive: true,
    isEmailVerified: true, // SSO 用户默认邮箱已验证
    avatar: ssoProfile.avatar || null,
    metadata: {
      ssoIdentities: {
        [provider]: {
          provider,
          providerUserId,
          linkedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
      },
      authMethod: 'sso',
      ssoPrimaryProvider: provider,
    },
  });

  // 写入审计日志
  await db.AuditLog.create({
    userId: newUser.id,
    action: 'SSO_AUTO_PROVISION',
    resourceType: 'User',
    resourceId: newUser.id,
    details: JSON.stringify({ provider, providerUserId }),
    severity: 'INFO',
  });

  console.log(`[SSO] Auto-provisioned new user: ${newUser.email} via ${provider}`);
  return newUser;
}

/**
 * 构建 Provider 端的唯一用户标识
 */
function buildProviderUserId(provider, profile) {
  switch (provider) {
    case 'google':
      return `google-oauth2-${profile.id}`;
    case 'github':
      return `github-${profile.id}`;
    case 'wecom':
      return `wecom-${profile.id}`;
    case 'dingtalk':
      return `dingtalk-${profile.id}`;
    case 'keycloak':
    case 'auth0':
      return `${provider}-${profile.id}`;
    case 'ldap':
      return `ldap-${profile.id}`;
    default:
      return `${provider}-${profile.id}`;
  }
}

/**
 * 通过 SSO Identity 查找用户
 * 在 users 表的 metadata.ssoIdentities 字段中查询
 */
async function findUserBySSOIdentity(provider, providerUserId) {
  // 使用 Sequelize 的 JSON 查询（PostgreSQL 支持）
  const users = await db.User.findAll({
    where: {
      metadata: {
        [db.Sequelize.Op.and]: [
          { ssoIdentities: { [db.Sequelize.Op.ne]: null } },
          db.Sequelize.where(
            db.Sequelize.fn("JSONB_EXTRACT_PATH_TEXT", db.Sequelize.col("metadata"), "ssoIdentities", provider),
            { [db.Sequelize.Op.ne]: null }
          ),
        ],
      },
    },
  });

  // 在应用层精确匹配 providerUserId
  for (const user of users) {
    const meta = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : (user.metadata || {});
    const identity = meta.ssoIdentities?.[provider];
    if (identity && identity.providerUserId === providerUserId) {
      return user;
    }
  }

  return null;
}

/**
 * 更新 SSO 登录元数据（lastLoginAt 等）
 */
async function updateSSOLoginMetadata(user, provider, providerUserId) {
  const meta = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : (user.metadata || {});
  if (!meta.ssoIdentities) meta.ssoIdentities = {};

  if (meta.ssoIdentities[provider]) {
    meta.ssoIdentities[provider].lastLoginAt = new Date().toISOString();
  } else {
    meta.ssoIdentities[provider] = {
      provider,
      providerUserId,
      linkedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
  }

  await user.update({
    lastLoginAt: new Date(),
    metadata: meta,
  });
}

// ============================================
// 身份链接 / 解链
// ============================================

/**
 * 将 SSO 身份链接到当前已认证的用户
 * @param {object} user - 当前已认证的本地 User 实例
 * @param {string} provider - 要链接的 Provider 名称
 * @param {string} providerUserId - Provider 端的用户标识
 */
async function linkSSOIdentity(user, provider, providerUserId) {
  const meta = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : (user.metadata || {});
  if (!meta.ssoIdentities) meta.ssoIdentities = {};

  // 检查是否已被其他用户绑定
  const existingOwner = await findUserBySSOIdentity(provider, providerUserId);
  if (existingOwner && existingOwner.id !== user.id) {
    throw Object.assign(new Error(`此 ${provider} 账号已被其他用户绑定`), {
      code: 'SSO_IDENTITY_ALREADY_LINKED',
    });
  }

  // 执行链接
  meta.ssoIdentities[provider] = {
    provider,
    providerUserId,
    linkedAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  await user.update({ metadata: meta });

  // 审计日志
  await db.AuditLog.create({
    userId: user.id,
    action: 'SSO_IDENTITY_LINKED',
    resourceType: 'User',
    resourceId: user.id,
    details: JSON.stringify({ provider, providerUserId }),
    severity: 'INFO',
  });

  console.log(`[SSO] User ${user.email} linked ${provider} identity`);
}

/**
 * 解除 SSO 身份链接
 * @param {object} user - 当前已认证的本地 User 实例
 * @param {string} provider - 要解除链接的 Provider 名称
 */
async function unlinkSSOIdentity(user, provider) {
  const meta = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : (user.metadata || {});

  if (!meta.ssoIdentities?.[provider]) {
    throw Object.assign(new Error(`未找到 ${provider} 的绑定记录`), {
      code: 'SSO_IDENTITY_NOT_FOUND',
    });
  }

  delete meta.ssoIdentities[provider];

  // 如果解除了最后一个 SSO 且用户是 SSO 自动创建的、无密码 → 警告
  const remainingSSO = Object.keys(meta.ssoIdentities || {}).length;
  const isSSOOnlyUser = meta.authMethod === 'sso' &&
    !user.passwordHash ||
    user.passwordHash.startsWith('__sso_');

  await user.update({ metadata: meta });

  // 审计日志
  await db.AuditLog.create({
    userId: user.id,
    action: 'SSO_IDENTITY_UNLINKED',
    resourceType: 'User',
    resourceId: user.id,
    details: JSON.stringify({ provider, remainingSSO, wasSSOOnly: isSSOOnlyUser }),
    severity: isSSOOnlyUser ? 'WARN' : 'INFO',
  });

  console.log(`[SSO] User ${user.email} unlinked ${provider} identity`);

  return { remainingSSO, wasSSOOnly: isSSOOnlyUser };
}

/**
 * 获取用户的 SSO 绑定状态
 * @param {object} user - 当前已认证的本地 User 实例
 * @returns {object} 绑定状态信息
 */
function getUserSSOStatus(user) {
  const meta = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : (user.metadata || {});
  const identities = meta.ssoIdentities || {};

  return {
    linkedProviders: Object.entries(identities).map(([key, value]) => ({
      provider: key,
      providerUserId: value.providerUserId,
      linkedAt: value.linkedAt,
      lastLoginAt: value.lastLoginAt,
    })),
    availableProviders: getEnabledProviders().map(p => p.name),
    authMethod: meta.authMethod || 'local',
  };
}

// ============================================
// Token 颁发（复用现有 JWT 系统）
// ============================================

/**
 * SSO 登录成功后颁发 JWT Token 对（复用现有 auth 中间件）
 * @param {object} user - 本地 User 实例
 * @param {string} ipAddress - 客户端 IP
 * @returns {Promise<{accessToken, refreshToken, csrfToken, expiresIn, user: object}>}
 */
async function issueTokensForSSOUser(user, ipAddress = null) {
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken({ id: user.id, email: user.email, role: user.role }),
    createRefreshToken(user.id, ipAddress),
  ]);

  // CSRF Token
  let csrfToken = null;
  try {
    const { issueCsrfToken } = require('../middleware/csrf');
    csrfToken = issueCsrfToken(user.id);
  } catch (e) {
    // CSRF 模块可能不可用，忽略
  }

  // 更新最后登录时间
  await user.update({ lastLoginAt: new Date() });

  // 审计日志
  await db.AuditLog.create({
    userId: user.id,
    action: 'LOGIN_SSO',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress,
    severity: 'INFO',
  });

  return {
    accessToken,
    refreshToken,
    csrfToken,
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES || '15m',
    tokenType: 'Bearer',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatar,
      isEmailVerified: user.isEmailVerified,
    },
  };
}

// ============================================
// 角色映射辅助函数
// ============================================

/**
 * 从 OIDC groups/roles 映射到本地角色
 */
function mapRolesFromGroups(roles, groups, roleMappingConfig) {
  if (!roleMappingConfig) return null; // 使用默认角色

  const rules = roleMappingConfig.rules || [];
  for (const rule of rules) {
    const pattern = new RegExp(rule.groupPattern);
    // 同时匹配 roles 和 groups 数组
    const allItems = [...(roles || []), ...(groups || [])];
    if (allItems.some(item => pattern.test(item))) {
      return rule.role;
    }
  }

  return roleMappingConfig.defaultRole || null;
}

/**
 * 从 LDAP memberOf 组 DN 映射到本地角色
 */
function mapLdapGroupsToRole(memberOfGroups, roleMappingConfig) {
  if (!roleMappingConfig || !memberOfGroups) return null;

  const rules = roleMappingConfig.rules || [];
  for (const rule of rules) {
    const pattern = new RegExp(rule.groupPattern, 'i'); // 大小写不敏感
    if (memberOfGroups.some(dn => pattern.test(dn))) {
      return rule.role;
    }
  }

  return roleMappingConfig.defaultRole || null;
}

// ============================================
// 工具函数
// ============================================

/**
 * 标准化邮箱地址（小写 + trim）
 */
function normalizeEmail(email) {
  if (!email) return null;
  return email.toLowerCase().trim();
}

/**
 * 解码 JWT Payload（无需验证签名，仅用于提取 claims）
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

/**
 * 从 GitHub emails API 提取主邮箱
 */
function extractPrimaryEmail(emails) {
  if (!emails || !Array.isArray(emails)) return null;
  // 优先 primary + verified
  const primary = emails.find(e => e.primary && e.verified);
  if (primary) return primary.email;
  // 其次 verified
  const verified = emails.find(e => e.verified);
  if (verified) return verified.email;
  // 最后第一个
  return emails[0]?.email || null;
}

/**
 * 通用的 OAuth2 UserInfo 请求
 */
async function fetchOAuth2UserInfo(url, accessToken, body = null) {
  const axios = require('axios');
  const headers = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await axios.get(url, {
    headers,
    timeout: 10000,
    params: body,
  });

  return response.data;
}

module.exports = {
  // 初始化
  initializePassport,

  // Provider 管理
  loadProviderConfig,
  isProviderEnabled,
  getEnabledProviders,

  // State/Nonce 安全
  generateState,
  validateAndConsumeState,
  generateNonce,

  // User Provisioning
  findOrCreateBySSO,

  // 身份链接
  linkSSOIdentity,
  unlinkSSOIdentity,
  getUserSSOStatus,

  // Token 颁发
  issueTokensForSSOUser,

  // 内部工具（供路由层使用）
  _internal: {
    buildProviderUserId,
    normalizeEmail,
    decodeJwtPayload,
    extractPrimaryEmail,
    fetchOAuth2UserInfo,
  },
};
