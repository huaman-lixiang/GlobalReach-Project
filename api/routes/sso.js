/**
 * SSO Routes (N02 Single Sign-On)
 *
 * SSO 单点登录路由端点：
 *   GET  /providers              — 列出已启用的 SSO 提供商
 *   GET  /:provider/login        — 发起 SSO 登录重定向
 *   GET  /:provider/callback     — SSO 回调处理（由 IdP 调用）
 *   POST /link                   — 链接 SSO 身份到当前账户
 *   POST /unlink                 — 解除 SSO 身份链接
 *   GET  /status                 — 当前用户 SSO 绑定状态
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const passport = require('passport');

const db = require('../db');
const ssoService = require('../services/ssoService');
const { verifyToken } = require('../middleware/auth');

// ============================================
// GET /api/v1/sso/providers — 列出已启用的 SSO 提供商
// ============================================
router.get('/providers', (req, res) => {
  try {
    const providers = ssoService.getEnabledProviders();

    res.json({
      success: true,
      data: {
        providers,
        ssoEnabled: providers.length > 0,
      },
    });
  } catch (error) {
    console.error('[SSO/Routes] 获取 providers 失败:', error.message);
    res.status(500).json({
      success: false,
      error: 'FETCH_PROVIDERS_FAILED',
      message: '获取 SSO 提供商列表失败',
    });
  }
});

// ============================================
// GET /api/v1/sso/:provider/login — 发起 SSO 登录重定向
// ============================================
router.get('/:provider/login', (req, res, next) => {
  const { provider } = req.params;

  // 验证 provider 是否有效
  if (!ssoService.isProviderEnabled(provider)) {
    return res.status(404).json({
      success: false,
      error: 'PROVIDER_NOT_FOUND',
      message: `SSO 提供商 "${provider}" 未启用或不存在`,
      availableProviders: ssoService.getEnabledProviders().map(p => p.name),
    });
  }

  // 生成 state 参数（防 CSRF）
  const state = ssoService.generateState(provider, {
    referer: req.headers.referer || '',
    userAgent: req.headers['user-agent'] || '',
  });

  // 构建授权 URL 参数
  const authParams = {
    state,
    // PKCE support for SPA (可选增强)
    ...(process.env.SSO_PKCE_ENABLED === 'true' ? {
      code_challenge: generatePKCEChallenge(req),
      code_challenge_method: 'S256',
    } : {}),
  };

  // OIDC 协议额外添加 nonce
  if (['keycloak', 'auth0', 'google'].includes(provider)) {
    authParams.nonce = ssoService.generateNonce();
  }

  // 使用 Passport.js 发起认证流程（302 重定向到 IdP）
  passport.authenticate(provider, authParams)(req, res, next);
});

// ============================================
// GET /api/v1/sso/:provider/callback — SSO 回调处理（由 IdP 调用）
// ============================================
router.get('/:provider/callback', (req, res, next) => {
  const { provider } = req.params;

  // 1. 验证 state 参数（防 CSRF，一次性使用）
  const state = req.query.state;
  const stateData = ssoService.validateAndConsumeState(state);

  if (!stateData) {
    console.warn(`[SSO/Routes] 无效或过期的 state 参数 (provider=${provider}, ip=${req.ip})`);
    return res.status(400).json({
      success: false,
      error: 'INVALID_STATE',
      message: 'SSO 登录会话无效或已过期，请重新尝试',
    });
  }

  // 2. 验证 provider 与 state 中记录的一致性
  if (stateData.provider !== provider) {
    console.error(`[SSO/Routes] Provider 不匹配: state=${stateData.provider}, url=${provider}`);
    return res.status(400).json({
      success: false,
      error: 'PROVIDER_MISMATCH',
      message: 'SSO 提供商不匹配',
    });
  }

  // 3. Passport.js 认证中间件处理回调
  const authenticateHandler = passport.authenticate(provider, {
    session: false,     // 无状态模式，不使用 session 存储
    failWithError: true, // 错误传递给自定义回调而非默认响应
  });

  // 4. 自定义回调：认证成功/失败后的统一处理
  authenticateHandler(req, res, async (err) => {
    if (err) {
      console.error(`[SSO/Routes] ${provider} 认证失败:`, err.message);
      const errorCode = err.code || 'AUTH_FAILED';
      const errorMessage = getFriendlyErrorMessage(err, provider);
      return res.redirect(`/login?sso=error&code=${errorCode}&message=${encodeURIComponent(errorMessage)}`);
    }

    // req.user 由 Passport.js 策略的 done(null, user) 注入
    if (!req.user) {
      return res.redirect('/login?sso=error&code=NO_USER&message=' + encodeURIComponent('无法识别用户'));
    }

    try {
      // 5. 颁发 JWT Token 对（复用现有 Dual-Token 认证体系）
      const tokenData = await ssoService.issueTokensForSSOUser(req.user, req.ip);

      // 6. 重定向到前端 SPA，通过 URL fragment 安全传递 token 数据
      // URL fragment (#...) 不会发送到服务器，避免 token 泄露风险
      const redirectUrl = process.env.SSO_REDIRECT_URL || '/dashboard';
      const tokenFragment = encodeURIComponent(JSON.stringify({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        csrfToken: tokenData.csrfToken,
        expiresIn: tokenData.expiresIn,
        user: tokenData.user,
      }));

      res.redirect(`${redirectUrl}#/sso-callback?data=${tokenFragment}`);
    } catch (error) {
      console.error('[SSO/Routes] Token 颁发失败:', error.message);
      res.redirect('/login?sso=error&code=TOKEN_ERROR&message=' + encodeURIComponent('登录成功但 Token 颁发失败'));
    }
  });
});

// ============================================
// POST /api/v1/sso/link — 链接 SSO 身份到当前已认证账户
// ============================================
router.post('/link', verifyToken, async (req, res) => {
  try {
    const { provider, providerUserId } = req.body;

    if (!provider || !providerUserId) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: '缺少必要参数: provider 和 providerUserId',
      });
    }

    if (!ssoService.isProviderEnabled(provider)) {
      return res.status(400).json({
        success: false,
        error: 'PROVIDER_NOT_FOUND',
        message: `SSO 提供商 "${provider}" 未启用`,
      });
    }

    // 获取当前用户
    const user = await db.User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: '当前用户不存在',
      });
    }

    // 执行身份链接
    await ssoService.linkSSOIdentity(user, provider, providerUserId);

    res.json({
      success: true,
      message: `已成功链接 ${provider} 账号`,
      data: { provider, linkedAt: new Date().toISOString() },
    });
  } catch (error) {
    const statusCode = error.code === 'SSO_IDENTITY_ALREADY_LINKED' ? 409 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.code || 'LINK_FAILED',
      message: error.message || 'SSO 身份链接失败',
    });
  }
});

// ============================================
// POST /api/v1/sso/unlink — 解除 SSO 身份链接
// ============================================
router.post('/unlink', verifyToken, async (req, res) => {
  try {
    const { provider } = req.body;

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: '缺少必要参数: provider',
      });
    }

    // 获取当前用户
    const user = await db.User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: '当前用户不存在',
      });
    }

    // 执行解链
    const result = await ssoService.unlinkSSOIdentity(user, provider);

    res.json({
      success: true,
      message: `已成功解除 ${provider} 账号绑定`,
      data: {
        provider,
        unlinkedAt: new Date().toISOString(),
        warning: result.wasSSOOnly
          ? '该账号为纯 SSO 账号，建议设置密码以备后续使用'
          : undefined,
      },
    });
  } catch (error) {
    const statusCode = error.code === 'SSO_IDENTITY_NOT_FOUND' ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.code || 'UNLINK_FAILED',
      message: error.message || 'SSO 身份解绑失败',
    });
  }
});

// ============================================
// GET /api/v1/sso/status — 当前用户 SSO 绑定状态查询
// ============================================
router.get('/status', verifyToken, async (req, res) => {
  try {
    const user = await db.User.findByPk(req.user.id, {
      attributes: { exclude: ['passwordHash'] },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: '用户不存在',
      });
    }

    const status = ssoService.getUserSSOStatus(user);

    res.json({ success: true, data: status });
  } catch (error) {
    console.error('[SSO/Routes] 获取 SSO 状态失败:', error.message);
    res.status(500).json({
      success: false,
      error: 'FETCH_STATUS_FAILED',
      message: '获取 SSO 绑定状态失败',
    });
  }
});

// ============================================
// 辅助函数
// ============================================

/**
 * 将 SSO 错误转换为用户友好的中文提示信息
 */
function getFriendlyErrorMessage(error, provider) {
  const messages = {
    AccessDeniedError: `${provider} 授权被拒绝，请确认您有权限访问`,
    TokenError: `${provider} Token 交换失败，请稍后重试`,
    AuthenticationError: `${provider} 认证失败，请检查账号配置`,
  };

  // 按 error constructor name 匹配
  if (messages[error.constructor?.name]) {
    return messages[error.constructor.name];
  }

  // 按错误消息关键词匹配
  const msg = error.message?.toLowerCase() || '';
  if (msg.includes('access denied') || msg.includes('denied')) return '访问被拒绝';
  if (msg.includes('timeout') || msg.includes('timed out')) return '连接超时，请检查网络后重试';
  if (msg.includes('network') || msg.includes('econnrefused')) return '网络连接异常，请检查 SSO 服务可用性';

  return error.message || 'SSO 登录失败，请稍后重试';
}

/**
 * 生成 PKCE code_challenge（可选安全增强）
 * SPA 场景下使用 PKCE 替代 client_secret
 */
function generatePKCEChallenge(req) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  req.session = req.session || {};
  req.session.pkceVerifier = verifier;
  // SHA256 hash → base64url 编码
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

module.exports = router;
