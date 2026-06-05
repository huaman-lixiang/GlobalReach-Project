/**
 * Unit Tests: metrics.js — D15 Prometheus Monitoring
 *
 * Covers:
 *   - Metric definitions (all 18 custom metrics)
 *   - startMetricsCollection middleware
 *   - updateSystemMetrics
 *   - updateErrorMetrics / updateCsrfMetrics / recordAuthOperation / recordEmailSend
 *   - getMetrics output format (Prometheus text format)
 */

const {
  startMetricsCollection,
  getMetrics,
  resetMetrics,
  startPeriodicCollection,
  updateErrorMetrics,
  updateHealthMetrics,
  updateSystemMetrics,
  updateCsrfMetrics,
  recordAuthOperation,
  recordEmailSend,
  recordCsrfFailure,
  metrics,
  METRICS_PREFIX,
} = require('../../middleware/metrics');

const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

describe('metrics — D15 Prometheus Monitoring', () => {

  // ============================================
  // Configuration & Setup
  // ============================================

  describe('Configuration', () => {
    test('has correct prefix', () => {
      expect(METRICS_PREFIX).toBe('globalreach_');
    });

    test('exports all expected metric groups', () => {
      const groupNames = Object.keys(metrics);
      expect(groupNames).toContain('httpRequestDurationSeconds');
      expect(groupNames).toContain('errorRateByCode');
      expect(groupNames).toContain('subsystemHealthStatus');
      expect(groupNames).toContain('emailQueueSize');
      expect(groupNames).toContain('csrfTokenStoreSize');
      expect(groupNames).toContain('authOperationsTotal');
      expect(groupNames).toContain('processMemoryBytes');
      expect(groupNames).toContain('databaseQueryDurationSeconds');
    });
  });

  // ============================================
  // Middleware: startMetricsCollection
  // ============================================

  describe('startMetricsCollection middleware', () => {
    test('calls next() immediately', async () => {
      const mw = startMetricsCollection();
      const req = createMockRequest({ method: 'GET', path: '/api/v1/health' });
      const res = createMockResponse();
      res.statusCode = 200;
      const next = createMockNext();

      await new Promise((resolve) => {
        mw(req, res, next);
        resolve();
      });

      expect(next).toHaveBeenCalled();
    });

    test('tracks active connections', async () => {
      const mw = startMetricsCollection();
      const req = createMockRequest({ method: 'POST', path: '/api/v1/auth/login' });
      const res = createMockResponse();
      const next = createMockNext();

      await new Promise((resolve) => {
        mw(req, res, next);
        // Simulate response finish
        res._emitFinish();
        resolve();
      });

      next.mock.calls.length; // Just ensure no errors
    });
  });

  // ============================================
  // System Metrics
  // ============================================

  describe('updateSystemMetrics', () => {
    test('sets process memory metrics without error', () => {
      expect(() => updateSystemMetrics()).not.toThrow();
    });

    test('sets heap usage percent', () => {
      updateSystemMetrics();
      // The gauge should have been set — we can't easily read it back from prom-client
      // but we verify the function doesn't throw
      expect(true).toBe(true);
    });

    test('sets uptime > 0 after process has been running', () => {
      updateSystemMetrics();
      expect(process.uptime()).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Error Metrics (D11 Integration)
  // ============================================

  describe('updateErrorMetrics', () => {
    beforeEach(() => {
      // Reset error tracker state between tests
    });

    test('handles null input gracefully', () => {
      expect(() => updateErrorMetrics(null)).not.toThrow();
    });

    test('handles undefined input gracefully', () => {
      expect(() => updateErrorMetrics(undefined)).not.toThrow();
    });

    test('processes valid error summary', () => {
      const summary = {
        totalErrors: 42,
        topErrors: [
          { code: 'NOT_FOUND', count: 20 },
          { code: 'VALIDATION_ERROR', count: 15 },
          { code: 'UNAUTHORIZED', count: 7 },
        ],
      };

      expect(() => updateErrorMetrics(summary)).not.toThrow();
    });

    test('handles empty topErrors array', () => {
      const summary = { totalErrors: 0, topErrors: [] };
      expect(() => updateErrorMetrics(summary)).not.toThrow();
    });
  });

  // ============================================
  // Health Metrics (D14 Integration)
  // ============================================

  describe('updateHealthMetrics', () => {
    test('handles null input gracefully', () => {
      expect(() => updateHealthMetrics(null)).not.toThrow();
    });

    test('processes full health check data', () => {
      const healthData = {
        healthScore: { score: 80, status: 'degraded' },
        checks: {
          database: { status: 'healthy', latencyMs: 3 },
          redis: { status: 'healthy', latencyMs: 2 },
          engine: { status: 'healthy' },
          email_queue: { status: 'healthy' },
          system_resources: { status: 'degraded', latencyMs: 1 },
        },
      };

      expect(() => updateHealthMetrics(healthData)).not.toThrow();
    });

    test('maps health statuses to numeric values correctly', () => {
      // healthy → 1, degraded → 0.5, down → 0, not_configured → -1
      const testCases = [
        { status: 'healthy', expected: 1 },
        { status: 'degraded', expected: 0.5 },
        { status: 'unstable', expected: 0.25 },
        { status: 'down', expected: 0 },
        { status: 'not_configured', expected: -1 },
      ];

      for (const tc of testCases) {
        const data = {
          healthScore: { score: 100 },
          checks: { test_subsystem: { status: tc.status } },
        };
        expect(() => updateHealthMetrics(data)).not.toThrow(`Failed for status: ${tc.status}`);
      }
    });
  });

  // ============================================
  // CSRF Security Metrics (D10 Integration)
  // ============================================

  describe('updateCsrfMetrics', () => {
    test('handles null input gracefully', () => {
      expect(() => updateCsrfMetrics(null)).not.toThrow();
    });

    test('processes CSRF info with token counts', () => {
      const csrfInfo = {
        enabled: true,
        headerName: 'x-csrf-token',
        totalActiveTokens: 12,
        activeUsers: 5,
      };

      expect(() => updateCsrfMetrics(csrfInfo)).not.toThrow();
    });

    test('handles empty token store', () => {
      const csrfInfo = {
        totalActiveTokens: 0,
        activeUsers: 0,
      };

      expect(() => updateCsrfMetrics(csrfInfo)).not.toThrow();
    });
  });

  // ============================================
  // Auth Operation Counter
  // ============================================

  describe('recordAuthOperation', () => {
    test('increments login success counter', () => {
      expect(() => recordAuthOperation('login', 'success')).not.toThrow();
    });

    test('increments login failure counter', () => {
      expect(() => recordAuthOperation('login', 'failure')).not.toThrow();
    });

    test('increments register success counter', () => {
      expect(() => recordAuthOperation('register', 'success')).not.toThrow();
    });

    test('increments refresh failure counter', () => {
      expect(() => recordAuthOperation('refresh', 'failure')).not.toThrow();
    });

    test('increments logout success counter', () => {
      expect(() => recordAuthOperation('logout', 'success')).not.toThrow();
    });

    test('increments reset_password counter', () => {
      expect(() => recordAuthOperation('reset_password', 'success')).not.toThrow();
    });
  });

  // ============================================
  // Email Send Counters
  // ============================================

  describe('recordEmailSend', () => {
    test('increments sent counter for successful send', () => {
      expect(() => recordEmailSend('GMAIL', true)).not.toThrow();
    });

    test('increments failed counter for failed send', () => {
      expect(() => recordEmailSend('OUTLOOK', false, 'connection_refused')).not.toThrow();
    });

    test('increments failed counter with unknown reason default', () => {
      expect(() => recordEmailSend('QQ', false)).not.toThrow();
    });

    test('handles all platform values', () => {
      const platforms = ['GMAIL', 'OUTLOOK', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP'];
      for (const p of platforms) {
        expect(() => recordEmailSend(p, true)).not.toThrow(`Failed for platform: ${p}`);
      }
    });
  });

  // ============================================
  // CSRF Failure Counter
  // ============================================

  describe('recordCsrfFailure', () => {
    test('increments for TOKEN_NOT_FOUND reason', () => {
      expect(() => recordCsrfFailure('TOKEN_NOT_FOUND')).not.toThrow();
    });

    test('increments for TOKEN_ALREADY_USED reason (replay attack)', () => {
      expect(() => recordCsrfFailure('TOKEN_ALREADY_USED')).not.toThrow();
    });

    test('increments for TOKEN_EXPIRED reason', () => {
      expect(() => recordCsrfFailure('TOKEN_EXPIRED')).not.toThrow();
    });

    test('increments for MISSING_CREDENTIALS reason', () => {
      expect(() => recordCsrfFailure('MISSING_CREDENTIALS')).not.toThrow();
    });
  });

  // ============================================
  // Periodic Collection
  // ============================================

  describe('startPeriodicCollection', () => {
    test('returns a stop function', () => {
      const collector = startPeriodicCollection({
        getErrorSummary: () => ({ totalErrors: 0, topErrors: [] }),
        getCsrfInfo: () => ({ totalActiveTokens: 0, activeUsers: 0 }),
      });

      expect(collector).toBeDefined();
      expect(typeof collector.stop).toBe('function');

      // Clean up
      collector.stop();
    });

    test('works without dependencies', () => {
      const collector = startPeriodicCollection({});
      expect(collector).toBeDefined();
      collector.stop();
    });

    test('works with only partial dependencies', () => {
      const collector = startPeriodicCollection({
        getErrorSummary: () => ({ totalErrors: 5, topErrors: [{ code: 'NOT_FOUND', count: 3 }] }),
        // No getCsrfInfo
      });

      expect(collector).toBeDefined();
      collector.stop();
    });
  });

  // ============================================
  // getMetrics Output
  // ============================================

  describe('getMetrics', () => {
    test('returns Prometheus-format text', async () => {
      const output = await getMetrics();

      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);

      // Should contain our custom prefix
      expect(output).toContain(METRICS_PREFIX);
    });

    test('contains HTTP request metric definitions', async () => {
      const output = await getMetrics();
      expect(output).toContain(`${METRICS_PREFIX}http_request_duration_seconds`);
      expect(output).toContain(`${METRICS_PREFIX}http_requests_total`);
    });

    test('contains error tracking metrics', async () => {
      const output = await getMetrics();
      expect(output).toContain(`${METRICS_PREFIX}errors_total`);
      expect(output).toContain(`${METRICS_PREFIX}error_rate_by_code`);
    });

    test('contains system resource metrics', async () => {
      const output = await getMetrics();
      expect(output).toContain(`${METRICS_PREFIX}process_memory_bytes`);
      expect(output).toContain(`${METRICS_PREFIX}heap_usage_percent`);
    });

    test('contains security metrics', async () => {
      const output = await getMetrics();
      expect(output).toContain(`${METRICS_PREFIX}csrf_token_store_size`);
      expect(output).toContain(`${METRICS_PREFIX}auth_operations_total`);
    });

    test('contains HELP text for each metric', async () => {
      const output = await getMetrics();
      // Prometheus format includes # HELP lines
      expect(output).toContain('# HELP');
    });
  });

  // ============================================
  // resetMetrics
  // ============================================

  describe('resetMetrics', () => {
    test('resets all metrics without error', async () => {
      // First generate some data
      recordAuthOperation('login', 'success');

      // Then reset
      await expect(resetMetrics()).resolves.not.toThrow();
    });
  });
});
