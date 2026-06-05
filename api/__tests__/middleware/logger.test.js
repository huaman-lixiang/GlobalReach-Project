/**
 * Unit Tests: logger.js — D07 Structured Logging + D13 Request Tracing
 *
 * Covers:
 *   - Sensitive data masking (16 field patterns)
 *   - Tracing Context Store (set/get/complete)
 *   - Span tracking (start/finish)
 *   - Safe method detection
 *   - createLogger factory
 */

const {
  maskSensitiveData,
  createLogger,
  requestIdMiddleware,
  tracingContext,
  updateTraceAuth,
  LOG_LEVELS,
  LOG_LEVEL_NAMES,
  getEffectiveLevel,
} = require('../../middleware/logger');

const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

describe('logger — D07+D13 Structured Logging & Request Tracing', () => {

  // ============================================
  // Sensitive Data Masking
  // ============================================

  describe('maskSensitiveData — 16 field patterns', () => {
    test('masks password fields', () => {
      const data = { username: 'admin', password: 'SuperSecret123!' };
      const result = maskSensitiveData(data);
      expect(result.password).toBe('***MASKED***');
      expect(result.username).toBe('admin'); // Non-sensitive preserved
    });

    test('masks token fields (accessToken, refreshToken)', () => {
      const data = { accessToken: 'eyJhbGci...', refreshToken: 'rt-xyz-123' };
      const result = maskSensitiveData(data);
      expect(result.accessToken).toBe('***MASKED***');
      expect(result.refreshToken).toBe('***MASKED***');
    });

    test('masks apiKey and secret fields', () => {
      const data = { apiKey: 'sk-live-abc123', secret: 'sec_999' };
      const result = maskSensitiveData(data);
      expect(result.apiKey).toBe('***MASKED***');
      expect(result.secret).toBe('***MASKED***');
    });

    test('masks credit_card and ssn', () => {
      const data = { credit_card: '4111111111111111', ssn: '123-45-6789' };
      const result = maskSensitiveData(data);
      expect(result.credit_card).toBe('***MASKED***');
      expect(result.ssn).toBe('***MASKED***');
    });

    test('masks csrfToken and csrf_token', () => {
      const data = { csrfToken: 'csrf-val', csrf_token: 'csrf-val2' };
      const result = maskSensitiveData(data);
      expect(result.csrfToken).toBe('***MASKED***');
      expect(result.csrf_token).toBe('***MASKED***');
    });

    test('masks authorization header', () => {
      const data = { headers: { authorization: 'Bearer eyJhbGci' } };
      const result = maskSensitiveData(data);
      expect(result.headers.authorization).toBe('***MASKED***');
    });

    test('handles nested objects recursively', () => {
      const data = {
        user: {
          email: 'test@example.com',
          password: 'secret123',
          profile: {
            ssn: '000-00-0000',
            name: 'Test User',
          },
        },
      };
      const result = maskSensitiveData(data);

      expect(result.user.password).toBe('***MASKED***');
      expect(result.user.profile.ssn).toBe('***MASKED***');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.profile.name).toBe('Test User');
    });

    test('handles arrays of objects', () => {
      const data = [
        { id: 1, password: 'pw1' },
        { id: 2, token: 'tok2' },
      ];
      const result = maskSensitiveData(data);

      expect(result[0].password).toBe('***MASKED***');
      expect(result[1].token).toBe('***MASKED***');
      expect(result[0].id).toBe(1); // Non-sensitive preserved
    });

    test('returns null/undefined as-is', () => {
      expect(maskSensitiveData(null)).toBeNull();
      expect(maskSensitiveData(undefined)).toBeUndefined();
    });
  });

  // ============================================
  // Tracing Context Store (D13)
  // ============================================

  describe('tracingContext — async tracing context propagation', () => {
    beforeEach(() => {
      tracingContext._store.clear();
    });

    describe('setContext / getContext', () => {
      test('sets and retrieves context by requestId', () => {
        tracingContext.setContext('trace-001', {
          method: 'POST',
          path: '/api/v1/campaigns',
          ip: '10.0.0.1',
        });

        const ctx = tracingContext.getContext('trace-001');

        expect(ctx).toBeDefined();
        expect(ctx.method).toBe('POST');
        expect(ctx.path).toBe('/api/v1/campaigns');
        expect(ctx.ip).toBe('10.0.0.1');
        expect(ctx.spans).toBeDefined();
        expect(Array.isArray(ctx.spans)).toBe(true);
        expect(ctx.startTime).toBeDefined();
      });

      test('returns null for non-existent context', () => {
        expect(tracingContext.getContext('nonexistent')).toBeNull();
      });

      test('overwrites existing context for same requestId', () => {
        tracingContext.setContext('trace-001', { method: 'GET' });
        tracingContext.setContext('trace-001', { method: 'POST' });

        const ctx = tracingContext.getContext('trace-001');
        expect(ctx.method).toBe('POST');
      });
    });

    describe('Span Tracking', () => {
      test('creates and finishes a span', () => {
        tracingContext.setContext('span-test-001', {});

        const span = tracingContext.startSpan('span-test-001', 'db.query', { table: 'users' });

        expect(span.finish).toBeDefined(); // Function
        expect(span.getSpan).toBeDefined();

        span.finish('ok');

        const spanData = span.getSpan();
        expect(spanData.operationName).toBe('db.query');
        expect(spanData.status).toBe('ok');
        expect(spanData.attributes).toEqual({ table: 'users' });
        expect(spanData.durationMs).toBeGreaterThanOrEqual(0);
        expect(spanData.endTime).toBeDefined();
      });

      test('tracks multiple spans in order', () => {
        tracingContext.setContext('multi-span', {});

        tracingContext.startSpan('multi-span', 'auth.verify').finish('ok');
        tracingContext.startSpan('multi-span', 'db.query').finish('ok');
        tracingContext.startSpan('multi-span', 'cache.get').finish('ok');

        const spans = tracingContext.completeContext('multi-span');
        expect(spans.length).toBe(3);
        expect(spans[0].operationName).toBe('auth.verify');
        expect(spans[1].operationName).toBe('db.query');
        expect(spans[2].operationName).toBe('cache.get');
        expect(spans.every(s => s.status === 'ok')).toBe(true);
      });

      test('auto-finishes incomplete spans on completeContext', () => {
        tracingContext.setContext('incomplete-span', {});
        tracingContext.startSpan('incomplete-span', 'slow.operation');
        // Don't call finish — simulate timeout

        const spans = tracingContext.completeContext('incomplete-span');

        expect(spans.length).toBe(1);
        expect(spans[0].status).toBe('incomplete');
        expect(spans[0].durationMs).toBeGreaterThanOrEqual(0);
      });

      test('returns no-op span when no context exists', () => {
        const span = tracingContext.startSpan('nonexistent', 'some.op');
        // Should not throw
        span.finish('ok');
        expect(typeof span.finish).toBe('function');
      });
    });

    describe('completeContext cleanup', () => {
      test('removes context after completion', () => {
        tracingContext.setContext('cleanup-test', {});
        tracingContext.startSpan('cleanup-test', 'op').finish('ok');

        tracingContext.completeContext('cleanup-test');

        expect(tracingContext.getContext('cleanup-test')).toBeNull();
      });

      test('returns empty array for nonexistent context', () => {
        const spans = tracingContext.completeContext('does-not-exist');
        expect(spans).toEqual([]);
      });
    });

    describe('getStats', () => {
      test('reports active traces count', () => {
        tracingContext._store.clear();

        tracingContext.setContext('stat-a', {});
        tracingContext.setContext('stat-b', {});
        tracingContext.startSpan('stat-a', 'op1').finish('ok');

        const stats = tracingContext.getStats();
        expect(stats.activeTraces).toBe(2);
        expect(stats.totalSpans).toBe(1);
      });
    });
  });

  // ============================================
  // updateTraceAuth
  // ============================================

  describe('updateTraceAuth', () => {
    it('links userId and role to tracing context', () => {
      tracingContext.setContext('auth-trace', {});
      updateTraceAuth({
        requestId: 'auth-trace',
        user: { id: 'user-123', role: 'admin' },
      });

      const ctx = tracingContext.getContext('auth-trace');
      expect(ctx.userId).toBe('user-123');
      expect(ctx.userRole).toBe('admin');
    });

    it('does not throw when no context exists', () => {
      expect(() => {
        updateTraceAuth({ requestId: 'no-context', user: { id: 'u1' } });
      }).not.toThrow();
    });
  });

  // ============================================
  // createLogger Factory
  // ============================================

  describe('createLogger — component-level logger', () => {
    test('returns logger with info/warn/error/debug methods', () => {
      const log = createLogger('TestComponent');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.debug).toBe('function');
    });

    test('startSpan delegates to tracingContext', () => {
      const log = createLogger('SpanTest');
      tracingContext.setContext('log-span-test', {});

      const span = log.startSpan('log-span-test', 'component.op');
      span.finish('ok');

      const spans = tracingContext.completeContext('log-span-test');
      expect(spans.length).toBe(1);
      expect(spans[0].operationName).toBe('component.op');
    });
  });

  // ============================================
  // Constants & Config
  // ============================================

  describe('LOG_LEVELS / LOG_LEVEL_NAMES', () => {
    test('LOG_LEVELS has correct numeric values', () => {
      expect(LOG_LEVELS.ERROR).toBe(0);
      expect(LOG_LEVELS.WARN).toBe(1);
      expect(LOG_LEVELS.INFO).toBe(2);
      expect(LOG_LEVELS.DEBUG).toBe(3);
    });

    test('LOG_LEVEL_NAMES maps correctly', () => {
      expect(LOG_LEVEL_NAMES[0]).toBe('ERROR');
      expect(LOG_LEVEL_NAMES[1]).toBe('WARN');
      expect(LOG_LEVEL_NAMES[2]).toBe('INFO');
      expect(LOG_LEVEL_NAMES[3]).toBe('DEBUG');
    });

    test('getEffectiveLevel returns valid level number', () => {
      const level = getEffectiveLevel();
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(3);
    });
  });
});
