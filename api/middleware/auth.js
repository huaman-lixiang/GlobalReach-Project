/**
 * Auth Middleware (D05 Enhanced)
 *
 * JWT-based authentication with:
 *   - Access Token (short-lived, 15min default)
 *   - Refresh Token (long-lived, 7d default, stored in DB)
 *   - Token rotation on refresh
 *   - Role-based access control
 *   - Request validation helper
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026';
const ACCESS_TOKEN_EXPIRES = process.env.ACCESS_TOKEN_EXPIRES || '15m';    // Short-lived access token
const REFRESH_TOKEN_EXPIRES = process.env.REFRESH_TOKEN_EXPIRES || '7d';     // Long-lived refresh token

// ============================================
// Token Generation
// ============================================

const generateAccessToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
};

const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex'); // 80-char hex string
};

const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// ============================================
// Token Verification
// ============================================

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: 'ACCESS_DENIED',
      message: 'No authorization token provided',
      code: 'AUTH_001',
    });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.tokenExp = decoded.exp;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'Access token has expired. Use /api/auth/refresh to get a new one.',
        code: 'AUTH_002',
      });
    }

    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid authentication token',
      code: 'AUTH_003',
    });
  }
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next();
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (error) {
    // Token invalid but continue as unauthenticated
  }

  next();
};

// ============================================
// Role-Based Access
// ============================================

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required for this endpoint',
        code: 'AUTH_004',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: `Required role(s): ${roles.join(', ')}. Current role: ${req.user.role}`,
        code: 'AUTH_005',
      });
    }

    next();
  };
};

// ============================================
// Refresh Token Helpers (used by routes)
// ============================================

/**
 * Create a refresh token record in DB.
 * @param {string} userId
 * @returns {Promise<string>} The raw refresh token (to be returned to client)
 */
const createRefreshToken = async (userId, ipAddress = null) => {
  const rawToken = generateRefreshToken();
  const tokenHash = hashToken(rawToken);

  // Revoke any existing active tokens for this user (single session model)
  await db.RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null } }
  );

  await db.RefreshToken.create({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + parseDuration(REFRESH_TOKEN_EXPIRES)),
    ipAddress,
  });

  return rawToken;
};

/**
 * Verify a refresh token and rotate it.
 * @param {string} rawToken - The raw refresh token from client
 * @param {string} ipAddress
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 */
const verifyAndRotateRefreshToken = async (rawToken, ipAddress = null) => {
  const tokenHash = hashToken(rawToken);

  // Find the token in DB
  const storedToken = await db.RefreshToken.findOne({
    where: { tokenHash, revokedAt: null },
  });

  if (!storedToken) {
    throw Object.assign(new Error('Invalid or expired refresh token'), { code: 'INVALID_REFRESH_TOKEN' });
  }

  // Check expiration
  if (new Date() > storedToken.expiresAt) {
    await storedToken.update({ revokedAt: new Date() });
    throw Object.assign(new Error('Refresh token has expired'), { code: 'REFRESH_TOKEN_EXPIRED' });
  }

  // Check if associated user still exists
  const user = await db.User.findByPk(storedToken.userId);
  if (!user || !user.isActive !== false) {
    throw Object.assign(new Error('User account not found or inactive'), { code: 'USER_NOT_FOUND' });
  }

  // Revoke old token (rotation)
  await storedToken.update({ revokedAt: new Date() });

  // Generate new token pair
  const newAccessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  const newRefreshToken = await createRefreshToken(user.id, ipAddress);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
};

/**
 * Revoke all refresh tokens for a user (logout).
 */
const revokeAllUserTokens = async (userId) => {
  return db.RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null } }
  );
};

// ============================================
// Validation Helper
// ============================================

const validateRequest = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: errors.array().map(err => ({
          field: err.path,
          value: err.value,
          message: err.msg,
        })),
      });
    }

    next();
  };
};

// ============================================
// Internal Helpers
// ============================================

function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 86400000);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  optionalAuth,
  requireRole,
  createRefreshToken,
  verifyAndRotateRefreshToken,
  revokeAllUserTokens,
  validateRequest,
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRES,
  REFRESH_TOKEN_EXPIRES,
};
