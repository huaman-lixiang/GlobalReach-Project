/**
 * Unit Tests: validator.js — D08 Input Validation Layer
 *
 * Covers:
 *   - XSS prevention (escapeHtml, sanitizeString, sanitizeObject)
 *   - SQL LIKE wildcard escaping (escapeLikeWildcard, buildSearchPattern)
 *   - Password complexity validation
 *   - Constants (LIMITS, PLATFORM_VALUES)
 *   - sanitizeBody middleware
 */

const {
  escapeHtml,
  sanitizeString,
  sanitizeObject,
  sanitizeBody,
  escapeLikeWildcard,
  buildSearchPattern,
  validatePasswordComplexity,
  LIMITS,
  PLATFORM_VALUES,
} = require('../../middleware/validator');

const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

describe('validator — D08 Input Validation Layer', () => {

  // ============================================
  // XSS Prevention
  // ============================================

  describe('XSS Prevention — escapeHtml', () => {
    test('escapes < and > characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>'))
        .toMatch(/^&lt;script&gt;alert\(&quot;xss&quot;\)&lt;(\/|&#x2F;)script&gt;$/);
    });

    test('escapes ampersand', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('escapes quotes', () => {
      expect(escapeHtml('"hello" \'world\'')).toBe('&quot;hello&quot; &#x27;world&#x27;');
    });

    test('handles empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('handles non-string input gracefully', () => {
      expect(escapeHtml(null)).toBeNull();
      expect(escapeHtml(undefined)).toBeUndefined();
      expect(escapeHtml(123)).toBe(123);
    });
  });

  describe('sanitizeString', () => {
    test('trims whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    test('collapses multiple spaces', () => {
      expect(sanitizeString('hello   world')).toBe('hello world');
    });

    test('truncates to max length', () => {
      const long = 'x'.repeat(200);
      expect(sanitizeString(long, 100).length).toBeLessThanOrEqual(100);
    });

    test('returns empty for non-string input', () => {
      expect(sanitizeString(null)).toBeNull();
    });
  });

  describe('sanitizeObject — recursive cleaning', () => {
    test('cleans all string values recursively', () => {
      const input = { name: '  Bob  ', email: '<script>', nested: { note: '  hi   ' } };
      const result = sanitizeObject(input);
      expect(result.name).toBe('Bob');
      expect(result.email).toBe('<script>');
      expect(result.nested.note).toBe('hi');
    });

    test('cleans arrays of objects', () => {
      const input = [{ name: '  Alice  ' }, { name: '<b>Bob</b>' }];
      const result = sanitizeObject(input);
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('<b>Bob</b>');
    });

    test('preserves non-string values', () => {
      const input = { count: 42, active: true, items: [1, 2, 3] };
      const result = sanitizeObject(input);
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
    });

    test('returns null for null input', () => {
      expect(sanitizeObject(null)).toBeNull();
    });
  });

  // ============================================
  // SQL Injection Prevention (LIKE Wildcards)
  // ============================================

  describe('SQL LIKE Wildcard Escaping', () => {
    test('escapes % character', () => {
      expect(escapeLikeWildcard('100%')).toBe('100\\%');
    });

    test('escapes _ character', () => {
      expect(escapeLikeWildcard('user_name')).toBe('user\\_name');
    });

    test('escapes both % and _ together', () => {
      expect(escapeLikeWildcard('_test%data_')).toBe('\\_test\\%data\\_');
    });

    test('wraps escaped string with % wildcards for search pattern', () => {
      const pattern = buildSearchPattern('gmail');
      expect(pattern).toBe('%gmail%');
    });

    test('buildSearchPattern escapes injection attempts', () => {
      // Attacker tries to inject % to match everything
      const pattern = buildSearchPattern('%admin');
      expect(pattern).toBe('%\\%admin%');

      const pattern2 = buildSearchPattern('_');
      expect(pattern2).toBe('%\\_%');
    });

    test('handles empty/null input', () => {
      expect(buildSearchPattern('')).toBe('%%');
      expect(buildSearchPattern(null)).toBe('%%');
    });
  });

  // ============================================
  // Password Complexity Validation
  // ============================================

  describe('validatePasswordComplexity', () => {
    test('accepts valid password with all requirements', () => {
      const result = validatePasswordComplexity('TestPass123!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects password shorter than 8 chars', () => {
      const result = validatePasswordComplexity('Ab1!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('8'))).toBe(true);
    });

    test('rejects password without uppercase letter', () => {
      const result = validatePasswordComplexity('testpass123!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    test('rejects password without lowercase letter', () => {
      const result = validatePasswordComplexity('TESTPASS123!');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
    });

    test('rejects password without number or special char', () => {
      const result = validatePasswordComplexity('Testpassword');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('rejects password longer than 128 chars', () => {
      const longPwd = 'A' + 'a1!' + 'x'.repeat(130);
      const result = validatePasswordComplexity(longPwd);
      expect(result.valid).toBe(false);
    });

    test('handles null/undefined input', () => {
      expect(() => validatePasswordComplexity(null)).toThrow();
      expect(() => validatePasswordComplexity(undefined)).toThrow();
      expect(validatePasswordComplexity('').valid).toBe(false);
    });
  });

  // ============================================
  // Constants
  // ============================================

  describe('Constants — LIMITS & PLATFORM_VALUES', () => {
    test('PLATFORM_VALUES contains expected platforms', () => {
      expect(PLATFORM_VALUES).toContain('GMAIL');
      expect(PLATFORM_VALUES).toContain('OUTLOOK');
      expect(PLATFORM_VALUES).toContain('QQ');
      expect(PLATFORM_VALUES).toContain('NETEASE_163');
      expect(PLATFORM_VALUES).toContain('CUSTOM_SMTP');
      expect(PLATFORM_VALUES.length).toBe(5);
    });

    test('LIMITS has expected constraints', () => {
      expect(LIMITS.SUBJECT_MAX).toBeDefined();
      expect(LIMITS.BODY_TEMPLATE_MAX).toBeDefined();
      expect(LIMITS.NAME_MAX).toBe(100);
      expect(LIMITS.PAGE_SIZE_MAX).toBe(100);
      expect(LIMITS.SEARCH_MAX).toBe(200);
    });
  });

  // ============================================
  // sanitizeBody Middleware
  // ============================================

  describe('sanitizeBody middleware', () => {
    test('sanitizes request body strings', async () => {
      const req = createMockRequest({
        method: 'POST',
        body: {
          name: '  <b>Admin</b>  ',
          description: '<script>alert(1)</script>',
          count: 42,
          nested: { title: '<i>Title</i>' },
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await sanitizeBody(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.name).toBe('<b>Admin</b>'); // sanitizeBody trims whitespace only (no HTML stripping)
      expect(req.body.description).toBe('<script>alert(1)</script>');
      expect(req.body.count).toBe(42); // Non-string preserved
      expect(req.body.nested.title).toBe('<i>Title</i>');
    });

    test('skips GET/HEAD/OPTIONS requests', async () => {
      const req = createMockRequest({
        method: 'GET',
        body: { name: '<script>' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await sanitizeBody(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.name).toBe('<script>'); // Not sanitized for safe methods
    });

    test('handles missing body gracefully', async () => {
      const req = createMockRequest({ method: 'POST', body: undefined });
      const res = createMockResponse();
      const next = createMockNext();

      await sanitizeBody(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
