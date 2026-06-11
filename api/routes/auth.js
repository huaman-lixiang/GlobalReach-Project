/**
 * Auth Routes (D05 Enhanced)
 *
 * S084/G05: Performance fix — bcrypt saltRounds reduced from 12→10
 * DEFECT-001: bcrypt.compare() with 12 rounds timed out (>30s) on
 *             1 CPU / 512MB container. Rounds=10 completes in ~200ms.
 * Security note: 10 rounds = ~1024 iterations (OWASP minimum acceptable).
 * Consider argon2id migration in future production hardening.
 *
 * Endpoints:
 *   POST /api/auth/register          — Register new user
 *   POST /api/auth/login             — Login (returns accessToken + refreshToken)
 *   POST /api/auth/refresh           — Refresh access token (rotation)
 *   POST /api/auth/logout            — Revoke refresh tokens
 *   GET  /api/auth/me                — Get current user profile
 *   POST /api/auth/forgot-password   — Request password reset email
 *   POST /api/auth/reset-password    — Reset password with token
 */

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// S084/G05: Centralized bcrypt cost factor (was 12, reduced to fix DEFECT-001)
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

const db = require('../db');
const {
  generateAccessToken,
  createRefreshToken,
  verifyAndRotateRefreshToken,
  revokeAllUserTokens,
  verifyToken,
  validateRequest,
} = require('../middleware/auth');
const { issueCsrfToken, revokeUserTokens } = require('../middleware/csrf');
const { actionRateLimit } = require('../middleware/rbac');
const { authLimiter } = require('../middleware/rateLimiter');
const {
  validatePasswordComplexity,
} = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');

// ============================================
// POST /api/auth/register
// ============================================
router.post('/register', authLimiter, [
  body('email').isEmail().withMessage('Invalid email format'), // S084/G05: removed .normalizeEmail() (causes DNS lookup hang)
  body('password')
    .isLength({ min: 8, max: 128 })
    .custom((value) => {
      const { valid, errors } = validatePasswordComplexity(value);
      if (!valid) throw new Error(errors.join('; '));
      return true;
    })
    .withMessage('Password: min 8 chars, upper+lower+number/special'),
  body('name').trim().notEmpty().isLength({ max: 100 }).escape()
    .withMessage('Name is required (max 100 chars)'),
], validateRequest, asyncHandler(async (req, res) => {
  const existingUser = await db.User.findOne({
    where: { email: req.body.email.toLowerCase() },
  });

  if (existingUser) {
    return res.status(409).json({
      success: false,
      error: 'EMAIL_EXISTS',
      message: 'An account with this email already exists',
    });
  }

  const hashedPassword = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);

  const user = await db.User.create({
    email: req.body.email.toLowerCase(),
    passwordHash: hashedPassword,
    name: req.body.name.trim(),
    role: 'USER',
    isActive: true,
    isEmailVerified: false,
  });

  // Generate token pair for new user
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken({ id: user.id, email: user.email, role: user.role }),
    createRefreshToken(user.id, req.ip),
  ]);

  // D10: Issue CSRF token for subsequent mutating requests
  const csrfToken = issueCsrfToken(user.id);

  await db.AuditLog.create({
    userId: user.id,
    action: 'REGISTER',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.status(201).json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      csrfToken, // D10: Include for immediate use
      expiresIn: process.env.ACCESS_TOKEN_EXPIRES || '15m',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
    },
    message: 'Registration successful',
  });
}));

// ============================================
// POST /api/auth/login (D05: returns dual tokens)
// ============================================
router.post('/login', authLimiter, [
  body('email').isEmail().withMessage('Invalid email format'), // S084/G05: removed normalizeEmail
  body('password').notEmpty().withMessage('Password is required'),
], validateRequest, asyncHandler(async (req, res) => {
  const user = await db.User.findOne({
    where: { email: req.body.email.toLowerCase() },
  });

  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      code: 'AUTH_101',
    });
  }

  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      error: 'ACCOUNT_DISABLED',
      message: 'Your account has been disabled. Please contact support.',
      code: 'AUTH_102',
    });
  }

  // Generate dual tokens
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken({ id: user.id, email: user.email, role: user.role }),
    createRefreshToken(user.id, req.ip),
  ]);

  // D10: Issue CSRF token for subsequent mutating requests
  const csrfToken = issueCsrfToken(user.id);

  // Update last login
  await user.update({ lastLoginAt: new Date() });

  await db.AuditLog.create({
    userId: user.id,
    action: 'LOGIN',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      csrfToken, // D10: Include for immediate use
      expiresIn: process.env.ACCESS_TOKEN_EXPIRES || '15m',
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
        isEmailVerified: user.isEmailVerified,
      },
    },
    message: 'Login successful',
  });
}));

// ============================================
// POST /api/auth/refresh (D05 NEW)
// ============================================
router.post('/refresh', [
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
], validateRequest, asyncHandler(async (req, res) => {
  const result = await verifyAndRotateRefreshToken(req.body.refreshToken, req.ip);

  res.json({
    success: true,
    data: {
      ...result,
      expiresIn: process.env.ACCESS_TOKEN_EXPIRES || '15m',
      tokenType: 'Bearer',
    },
    message: 'Tokens refreshed successfully',
  });
}));

// ============================================
// POST /api/auth/logout (D05 NEW)
// ============================================
router.post('/logout', verifyToken, async (req, res) => {
  try {
    await revokeAllUserTokens(req.user.id);

    // D10: Revoke all CSRF tokens for this user
    revokeUserTokens(req.user.id);

    await db.AuditLog.create({
      userId: req.user.id,
      action: 'LOGOUT',
      resourceType: 'User',
      resourceId: req.user.id,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Logged out successfully. All sessions revoked.',
    });
  } catch (error) {
    // Even if DB fails, return success to client (token will expire anyway)
    res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  }
});

// ============================================
// GET /api/auth/me
// ============================================
router.get('/me', verifyToken, asyncHandler(async (req, res) => {
  const user = await db.User.findByPk(req.user.id, {
    attributes: { exclude: ['passwordHash'] },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  }

  res.json({
    success: true,
    data: user.toJSON(),
  });
}));

// ============================================
// POST /api/auth/forgot-password (D05 NEW)
// ============================================
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().withMessage('Valid email is required'), // S084/G05: removed normalizeEmail
], validateRequest, async (req, res) => {
  try {
    const user = await db.User.findOne({
      where: { email: req.body.email.toLowerCase(), isActive: true },
    });

    // Always return success to prevent email enumeration attacks
    // Even if user doesn't exist, we don't reveal that

    if (user) {
      // Generate reset token (valid for 1 hour)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Store in user record (or separate PasswordReset table in production)
      await user.update({
        metadata: {
          ...(user.metadata || {}),
          passwordResetToken: resetTokenHash,
          passwordResetExpiresAt: expiresAt.toISOString(),
        },
      });

      console.log(`[Auth] Password reset token generated for ${user.email}`);
      console.log(`[Dev Mode] Reset link: http://localhost:3000/api/auth/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`);
      // In production, send email here via nodemailer/emailService
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
  } catch (error) {
    console.error('[Auth] Forgot password error:', error);
    // Still return success to prevent enumeration
    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
  }
});

// ============================================
// POST /api/auth/reset-password (D05 NEW)
// ============================================
router.post('/reset-password', actionRateLimit('reset_password', 3), [
  body('token').notEmpty().trim().withMessage('Reset token is required'),
  body('email').isEmail().withMessage('Valid email is required'), // S084/G05: removed normalizeEmail
  body('password')
    .isLength({ min: 8, max: 128 })
    .custom((value) => {
      const { valid, errors } = validatePasswordComplexity(value);
      if (!valid) throw new Error(errors.join('; '));
      return true;
    })
    .withMessage('Password: min 8 chars, upper+lower+number/special'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
], validateRequest, asyncHandler(async (req, res) => {
  const user = await db.User.findOne({
    where: { email: req.body.email.toLowerCase(), isActive: true },
  });

  if (!user || !user.metadata?.passwordResetToken) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_RESET_REQUEST',
      message: 'Invalid or expired password reset request. Please try again.',
    });
  }

  // Verify token
  const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
  if (tokenHash !== user.metadata.passwordResetToken) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_RESET_TOKEN',
      message: 'Invalid reset token.',
    });
  }

  // Check expiration
  const expiresAt = new Date(user.metadata.passwordResetExpiresAt);
  if (new Date() > expiresAt) {
    // Clear the expired token
    await user.update({
      metadata: {
        ...user.metadata,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });
    return res.status(400).json({
      success: false,
      error: 'RESET_TOKEN_EXPIRED',
      message: 'Password reset token has expired. Please request a new one.',
    });
  }

  // Update password
  const newPasswordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
  await user.update({
    passwordHash: newPasswordHash,
    metadata: {
      ...user.metadata,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    },
    passwordChangedAt: new Date(),
  });

  // Revoke all existing sessions (force re-login)
  await revokeAllUserTokens(user.id);

  await db.AuditLog.create({
    userId: user.id,
    action: 'PASSWORD_RESET',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    success: true,
    message: 'Password reset successful. Please log in with your new password.',
  });
}));

module.exports = router;
