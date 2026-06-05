/**
 * RBAC Middleware (D05) — Resource-Level Permission Control
 *
 * Extends basic role-based access with ownership checks:
 *   - ADMIN: full access (bypasses ownership)
 *   - USER: can only access their own resources (userId match)
 *   - VIEWER: read-only access to their own resources
 *
 * Usage:
 *   router.get('/campaigns/:id', verifyToken, requireOwnership('Campaign'), handler);
 *   router.delete('/accounts/:id', verifyToken, requireRole('admin'), handler);
 */

const db = require('../db');

/**
 * Check if user owns a specific resource.
 * Supports: Campaign, EmailAccount, Client, Email
 */
const requireOwnership = (resourceModel, options = {}) => {
  return async (req, res, next) => {
    // Admin bypasses ownership check
    if (req.user && req.user.role === 'ADMIN') {
      return next();
    }

    const resourceId = req.params.id || req.body[options.idField || 'id'];
    if (!resourceId) {
      return res.status(400).json({
        success: false,
        error: 'RESOURCE_ID_REQUIRED',
        message: 'Resource ID is required',
      });
    }

    try {
      const Model = db[resourceModel];
      if (!Model) {
        return res.status(500).json({
          success: false,
          error: 'INVALID_RESOURCE_TYPE',
          message: `Unknown resource type: ${resourceModel}`,
        });
      }

      const resource = await Model.findByPk(resourceId);
      if (!resource) {
        return res.status(404).json({
          success: false,
          error: 'RESOURCE_NOT_FOUND',
          message: `${resourceModel} not found`,
        });
      }

      // Check userId field on resource matches authenticated user
      const resourceUserId = resource.userId || resource.user_id;
      if (!resourceUserId || resourceUserId !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'ACCESS_DENIED',
          message: `You do not have permission to access this ${resourceModel.toLowerCase()}`,
          code: 'RBAC_001',
        });
      }

      // Attach resource to request for handler use
      req.resource = resource;
      next();
    } catch (error) {
      console.error('[RBAC] Ownership check error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'PERMISSION_CHECK_FAILED',
        message: 'Failed to verify permissions',
      });
    }
  };
};

/**
 * Require specific role OR resource ownership.
 * Useful for endpoints where both admins AND owners should have access.
 */
const requireRoleOrOwnership = (roles, resourceModel) => {
  return async (req, res, next) => {
    // Role check first
    if (req.user && roles.includes(req.user.role)) {
      return next();
    }

    // Fallback to ownership check
    return requireOwnership(resourceModel)(req, res, next);
  };
};

/**
 * Check if user has access to a specific account.
 * Admins can access all accounts; users only their own.
 */
const requireAccountAccess = async (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    return next();
  }

  const accountId = req.params.id || req.body.accountId;
  if (!accountId) {
    return next(); // No accountId specified — let handler deal with it
  }

  try {
    const account = await db.EmailAccount.findByPk(accountId);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Email account not found',
      });
    }

    if (account.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'ACCOUNT_ACCESS_DENIED',
        message: 'You do not have permission to manage this email account',
        code: 'RBAC_002',
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'PERMISSION_CHECK_FAILED',
      message: 'Failed to verify account access',
    });
  }
};

/**
 * Rate-limit sensitive actions per user.
 * Simple in-memory tracker for password reset attempts, etc.
 */
const actionRateLimit = (action, maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();

  return (req, res, next) => {
    if (!req.user) return next();

    const key = `${req.user.id}:${action}`;
    const now = Date.now();
    const userAttempts = attempts.get(key);

    if (userAttempts) {
      if (now - userAttempts.startTime < windowMs) {
        if (userAttempts.count >= maxAttempts) {
          const resetSeconds = Math.ceil((windowMs - (now - userAttempts.startTime)) / 1000);
          return res.status(429).json({
            success: false,
            error: 'RATE_LIMITED',
            message: `Too many ${action} attempts. Please try again in ${resetSeconds} seconds.`,
            retryAfter: resetSeconds,
          });
        }
        userAttempts.count++;
      } else {
        attempts.delete(key); // Window expired, reset
      }
    } else {
      attempts.set(key, { count: 1, startTime: now });
    }

    // Cleanup expired entries periodically
    if (attempts.size > 1000) {
      for (const [k, v] of attempts.entries()) {
        if (now - v.startTime > windowMs) attempts.delete(k);
      }
    }

    next();
  };
};

module.exports = {
  requireOwnership,
  requireRoleOrOwnership,
  requireAccountAccess,
  actionRateLimit,
};
