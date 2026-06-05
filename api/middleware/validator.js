/**
 * Centralized Validation Module — D08 Input Validation Layer
 *
 * Provides:
 *   - Reusable express-validator rule sets per entity type
 *   - XSS sanitization helpers (escapeHtml, sanitizeInput)
 *   - SQL LIKE wildcard escaping for safe search queries
 *   - Pagination parameter validation
 *   - Password complexity enforcement
 *   - String length limits for DoS prevention
 */

const { body, query, param, validationResult } = require('express-validator');

// ============================================
// Constants & Limits
// ============================================

const LIMITS = {
  // Pagination
  PAGE_MIN: 1,
  PAGE_MAX: 10000,
  PAGE_SIZE_MIN: 1,
  PAGE_SIZE_MAX: 100,

  // String lengths
  NAME_MAX: 100,
  EMAIL_MAX: 254,        // RFC 5321 max
  PASSWORD_MAX: 128,
  SUBJECT_MAX: 500,
  BODY_TEMPLATE_MAX: 100000, // ~100KB max email body
  SEARCH_MAX: 200,

  // Array limits
  RECIPIENTS_MAX: 50,
  BATCH_EMAILS_MAX: 100,
};

const PLATFORM_VALUES = ['GMAIL', 'OUTLOOK', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP'];
const CAMPAIGN_TYPES = ['COLD_OUTREACH', 'FOLLOW_UP', 'NEWSLETTER', 'TRANSACTIONAL'];
const ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE', 'RESTRICTED', 'BANNED', 'ERROR'];

// ============================================
// XSS Sanitization
// ============================================

/**
 * Escape HTML entities to prevent XSS when rendering user content
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize a string value: trim + collapse whitespace + limit length
 */
function sanitizeString(value, maxLength = LIMITS.NAME_MAX) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

/**
 * Sanitize an object's string fields recursively
 */
function sanitizeObject(obj, fieldLimits = {}) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && !key.includes('password') && !key.includes('token')) {
      result[key] = sanitizeString(val, fieldLimits[key] || LIMITS.NAME_MAX);
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result[key] = sanitizeObject(val, fieldLimits);
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ============================================
// SQL LIKE Wildcard Escaping
// ============================================

/**
 * Escape SQL LIKE wildcards (%) and (_) in search strings.
 * Safe to use in Sequelize Op.iLike / Op.like queries.
 */
function escapeLikeWildcard(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Build a safe Sequelize iLike search pattern from user input
 */
function buildSearchPattern(searchStr) {
  return '%' + escapeLikeWildcard(sanitizeString(searchStr, LIMITS.SEARCH_MAX)) + '%';
}

// ============================================
// Password Validation
// ============================================

/**
 * Validate password meets complexity requirements:
 * - Min 8 chars
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number or special character
 */
function validatePasswordComplexity(password) {
  const errors = [];

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (password.length > LIMITS.PASSWORD_MAX) {
    errors.push(`Password must be at most ${LIMITS.PASSWORD_MAX} characters`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least 1 uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least 1 lowercase letter');
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{}|;:',.<>?`~]/.test(password)) {
    errors.push('Password must contain at least 1 number or special character');
  }

  return { valid: errors.length === 0, errors };
}

// Custom password validator for express-validator
function isStrongPassword(value) {
  if (!value) return false;
  const { valid } = validatePasswordComplexity(value);
  return valid;
}

// ============================================
// Reusable Validation Rule Sets
// ============================================

/** Pagination query params (page + pageSize) */
const paginationRules = () => [
  query('page')
    .optional()
    .isInt({ min: LIMITS.PAGE_MIN, max: LIMITS.PAGE_MAX })
    .withMessage(`Page must be between ${LIMITS.PAGE_MIN}-${LIMITS.PAGE_MAX}`)
    .toInt(),
  query('pageSize')
    .optional()
    .isInt({ min: LIMITS.PAGE_SIZE_MIN, max: LIMITS.PAGE_SIZE_MAX })
    .withMessage(`PageSize must be between ${LIMITS.PAGE_SIZE_MIN}-${LIMITS.PAGE_SIZE_MAX}`)
    .toInt(),
];

/** Search query param with length limit */
const searchRule = () => [
  query('search')
    .optional()
    .isLength({ max: LIMITS.SEARCH_MAX })
    .withMessage(`Search term too long (max ${LIMITS.SEARCH_MAX})`)
    .trim(),
];

/** Status filter (uppercase enum) */
const statusFilterRule = () => [
  query('status')
    .optional()
    .toUpperCase()
    .isIn(['DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED',
            'PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED'])
    .withMessage('Invalid status filter'),
];

/** UUID param validator */
const uuidParam = (paramName = 'id') => [
  param(paramName).isUUID(4).withMessage(`Invalid ${paramName}: must be a valid UUID`),
];

/** User registration rules */
const registrationRules = () => [
  body('email')
    .isEmail()
    .normalizeEmail()
    .isLength({ max: LIMITS.EMAIL_MAX })
    .withMessage(`Email must be valid and ≤${LIMITS.EMAIL_MAX} chars`),
  body('password')
    .isLength({ min: 8, max: LIMITS.PASSWORD_MAX })
    .custom(isStrongPassword)
    .withMessage('Password: min 8 chars, upper+lower+number/special'),
  body('name')
    .trim()
    .notEmpty()
    .isLength({ max: LIMITS.NAME_MAX })
    .withMessage(`Name required, max ${LIMITS.NAME_MAX} chars`)
    .escape(),
];

/** Login rules */
const loginRules = () => [
  body('email').isEmail().normalizeEmail().withMessage('Invalid email format'),
  body('password').notEmpty().withMessage('Password is required'),
];

/** Account creation/update rules */
const accountRules = () => [
  body('platform').isIn(PLATFORM_VALUES).withMessage(
    `Invalid platform. Must be one of: ${PLATFORM_VALUES.join(', ')}`),
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').notEmpty().withMessage('Password is required'),
  body('name').optional().trim().isLength({ max: LIMITS.NAME_MAX }).escape(),
  body('encryptionType').optional().isIn(['SSL', 'STARTTLS', 'NONE']),
];

/** Campaign creation rules */
const campaignRules = () => [
  body('name').trim().notEmpty().isLength({ max: LIMITS.NAME_MAX })
    .withMessage(`Campaign name required, max ${LIMITS.NAME_MAX} chars`).escape(),
  body('subject_template').optional().trim()
    .isLength({ max: LIMITS.SUBJECT_MAX })
    .withMessage(`Subject template too long (max ${LIMITS.SUBJECT_MAX})`),
  body('body_template').optional()
    .isLength({ max: LIMITS.BODY_TEMPLATE_MAX })
    .withMessage(`Body template too long (max ${LIMITS.BODY_TEMPLATE_MAX} chars)`),
  body('type').optional().isIn(CAMPAIGN_TYPES).withMessage(
    `Invalid campaign type. Must be one of: ${CAMPAIGN_TYPES.join(', ')}`),
];

/** Email send rules */
const emailSendRules = () => [
  body('to').isArray({ min: 1, max: LIMITS.RECIPIENTS_MAX })
    .withMessage(`Recipients array required (max ${LIMITS.RECIPIENTS_MAX})`),
  body('to.*').isEmail().withMessage('Invalid recipient email address'),
  body('subject').trim().notEmpty()
    .isLength({ max: LIMITS.SUBJECT_MAX })
    .withMessage(`Subject required, max ${LIMITS.SUBJECT_MAX} chars`).escape(),
  body('html').optional().isString()
    .isLength({ max: LIMITS.BODY_TEMPLATE_MAX }),
  body('text').optional().isString()
    .isLength({ max: LIMITS.BODY_TEMPLATE_MAX }),
];

/** Email validate rules */
const emailValidateRules = () => [
  body('to').isArray({ min: 1, max: LIMITS.RECIPIENTS_MAX }),
  body('to.*').isEmail(),
  body('subject').optional().trim().isLength({ max: LIMITS.SUBJECT_MAX }).escape(),
  body('html').optional().isString().isLength({ max: LIMITS.BODY_TEMPLATE_MAX }),
];

/** Batch import rules */
const batchImportRules = () => [
  body('accounts').isArray({ min: 1, max: LIMITS.BATCH_EMAILS_MAX }),
  body('accounts.*.platform').isIn(PLATFORM_VALUES),
  body('accounts.*.email').isEmail(),
  body('accounts.*.password').notEmpty(),
];

// ============================================
// Middleware: Auto-sanitize request body strings
// ============================================

/**
 * Express middleware that sanitizes all string values in req.body.
 * Applied globally after JSON parsing to automatically clean all input.
 *
 * Does NOT mask passwords/tokens — those are handled separately by logger masking.
 */
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
};

// ============================================
// Exports
// ============================================

module.exports = {
  // Limits & constants
  LIMITS,
  PLATFORM_VALUES,
  CAMPAIGN_TYPES,
  ACCOUNT_STATUSES,

  // Sanitization utilities
  escapeHtml,
  sanitizeString,
  sanitizeObject,
  sanitizeBody,
  escapeLikeWildcard,
  buildSearchPattern,

  // Password validation
  validatePasswordComplexity,
  isStrongPassword,

  // Reusable rule sets (express-validator arrays)
  paginationRules,
  searchRule,
  statusFilterRule,
  uuidParam,
  registrationRules,
  loginRules,
  accountRules,
  campaignRules,
  emailSendRules,
  emailValidateRules,
  batchImportRules,
};
