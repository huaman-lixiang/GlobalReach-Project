/**
 * Prometheus Metrics Module — D15 Monitoring & Alerting
 *
 * Enterprise-grade metrics collection built on prom-client:
 *
 *   - HTTP request duration histogram (with method/route/status labels)
 *   - HTTP requests total counter (with method/route/status labels)
 *   - Active connections gauge (real-time concurrent requests)
 *   - Error rate gauges (from D11 errorRateTracker integration)
 *   - Health check status gauges (from D14 subsystem data)
 *   - Email queue depth gauge (pipeline monitoring)
 *   - System resource gauges (memory, CPU, event loop)
 *   - CSRF token store size gauge (security monitoring)
 *   - Auth token operations counter (login/logout/refresh/refresh failures)
 *   - Default Node.js process metrics (GC, event loop, heap)
 *
 * Usage:
 *   const { startMetricsCollection, getMetrics } = require('./metrics');
 *   app.use(startMetricsCollection(app));  // Auto-instrument all requests
 *   app.get('/api/v1/metrics', async (req, res) => {
 *     res.set('Content-Type', 'text/plain');
 *     res.end(await getMetrics());
 *   });
 */

const client = require('prom-client');

// ============================================
// Configuration
// ============================================

const METRICS_PREFIX = 'globalreach_';
const isProduction = (process.env.NODE_ENV || 'development') === 'production';

// Collect default Node.js metrics (process_cpu, nodejs_heap, etc.)
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: METRICS_PREFIX });

// ============================================
// Custom Metrics Definitions
// ============================================

// --- HTTP Layer ---

/** Duration of HTTP requests in seconds */
const httpRequestDurationSeconds = new client.Histogram({
  name: `${METRICS_PREFIX}http_request_duration_seconds`,
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Total number of HTTP requests */
const httpRequestsTotal = new client.Counter({
  name: `${METRICS_PREFIX}http_requests_total`,
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

/** Number of active HTTP connections */
const activeConnections = new client.Gauge({
  name: `${METRICS_PREFIX}active_connections`,
  help: 'Number of active HTTP connections',
});

// --- Error Tracking (D11 Integration) ---

/** Current error rate by error code (sliding window) */
const errorRateByCode = new client.Gauge({
  name: `${METRICS_PREFIX}error_rate_by_code`,
  help: 'Error count by error code in the current sliding window',
  labelNames: ['error_code'],
});

/** Total errors in current window */
const errorTotalGauge = new client.Gauge({
  name: `${METRICS_PREFIX}errors_total`,
  help: 'Total errors in the current sliding window window',
});

// --- Health Check Status (D14 Integration) ---

/** Subsystem health status (1=healthy, 0=unhealthy, -1=not_configured) */
const subsystemHealthStatus = new client.Gauge({
  name: `${METRICS_PREFIX}subsystem_health_status`,
  help: 'Health status of each subsystem (1=healthy, 0=unhealthy, -1=not_configured)',
  labelNames: ['subsystem'],
});

/** Health check response latency per subsystem */
const subsystemHealthLatencyMs = new client.Gauge({
  name: `${METRICS_PREFIX}subsystem_health_latency_ms`,
  help: 'Health check latency in milliseconds per subsystem',
  labelNames: ['subsystem'],
});

/** Overall health score (0-100) */
const healthScoreGauge = new client.Gauge({
  name: `${METRICS_PREFIX}health_score`,
  help: 'Overall system health score (0-100)',
});

// --- Pipeline / Queue ---

/** Email queue pending count */
const emailQueueSize = new client.Gauge({
  name: `${METRICS_PREFIX}email_queue_size`,
  help: 'Number of emails pending in the sending queue',
});

/** Emails sent total (counter) */
const emailsSentTotal = new client.Counter({
  name: `${METRICS_PREFIX}emails_sent_total`,
  help: 'Total number of emails sent successfully',
  labelNames: ['platform', 'campaign_id'],
});

/** Emails failed total (counter) */
const emailsFailedTotal = new client.Counter({
  name: `${METRICS_PREFIX}emails_failed_total`,
  help: 'Total number of emails that failed to send',
  labelNames: ['reason'],
});

// --- Security ---

/** Active CSRF tokens in memory store */
const csrfTokenStoreSize = new client.Gauge({
  name: `${METRICS_PREFIX}csrf_token_store_size`,
  help: 'Number of active CSRF tokens in memory',
  labelNames: ['store_type'], // 'total' or 'users'
});

/** CSRF validation failures (replay attacks blocked, invalid tokens) */
const csrfValidationFailures = new client.Counter({
  name: `${METRICS_PREFIX}csrf_validation_failures_total`,
  help: 'Total CSRF validation failures',
  labelNames: ['reason'], // TOKEN_NOT_FOUND, TOKEN_ALREADY_USED, TOKEN_EXPIRED, MISSING_CREDENTIALS
});

// --- Authentication ---

/** Authentication operations counter */
const authOperationsTotal = new client.Counter({
  name: `${METRICS_PREFIX}auth_operations_total`,
  help: 'Total authentication operations',
  labelNames: ['operation', 'status'], // operation: login/register/refresh/logout/reset_password; status: success/failure
});

// --- System Resources ---

/** Process memory usage in bytes */
const processMemoryBytes = new client.Gauge({
  name: `${METRICS_PREFIX}process_memory_bytes`,
  help: 'Process memory usage in bytes',
  labelNames: ['type'], // heapUsed, heapTotal, rss, external, arrayBuffers
});

/** Process uptime in seconds */
const processUptimeSeconds = new client.Gauge({
  name: `${METRICS_PREFIX}process_uptime_seconds`,
  help: 'Process uptime in seconds',
});

/** Heap usage percentage */
const heapUsagePercent = new client.Gauge({
  name: `${METRICS_PREFIX}heap_usage_percent`,
  help: 'Heap usage as a percentage of total allocated heap',
});

// --- Database ---

/** Database query duration in seconds */
const databaseQueryDurationSeconds = new client.Histogram({
  name: `${METRICS_PREFIX}database_query_duration_seconds`,
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

/** Active database connection pool size */
const dbPoolSize = new client.Gauge({
  name: `${METRICS_PREFIX}db_pool_size`,
  help: 'Database connection pool size',
  labelNames: ['state'], // active, idle, total
});

// ============================================
// Middleware: Auto-Instrumentation
// ============================================

/**
 * Express middleware that auto-instruments all HTTP requests.
 * Records duration, status code, and increments counters.
 *
 * Must be mounted early in the middleware stack (before routes).
 */
function startMetricsCollection() {
  return (req, res, next) => {
    const start = Date.now();

    // Track active connections
    activeConnections.inc();

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const durationSec = durationMs / 1000;

      const route = req.route?.path || req.originalUrl || req.path;
      const statusCode = String(res.statusCode);

      // Record duration histogram
      httpRequestDurationSeconds.observe(
        { method: req.method, route, status_code: statusCode },
        durationSec,
      );

      // Increment request counter
      httpRequestsTotal.inc({ method: req.method, route, status_code: statusCode });

      // Decrement active connections
      activeConnections.dec();
    });

    next();
  };
}

// ============================================
// Metric Update Helpers (called from other modules)
// ============================================

/**
 * Update error rate metrics from D11 errorRateTracker.
 * Call this periodically or on demand.
 *
 * @param {object} errorSummary - From errorHandler.getErrorSummary()
 */
function updateErrorMetrics(errorSummary) {
  if (!errorSummary) return;

  errorTotalGauge.set(errorSummary.totalErrors || 0);

  if (errorSummary.topErrors) {
    for (const entry of errorSummary.topErrors) {
      errorRateByCode.set({ error_code: entry.code }, entry.count);
    }
  }
}

/**
 * Update health check metrics from D14 deep health check.
 *
 * @param {object} healthData - Response body from GET /api/v1/health
 */
function updateHealthMetrics(healthData) {
  if (!healthData || !healthData.checks) return;

  // Overall score
  if (healthData.healthScore) {
    healthScoreGauge.set(healthData.healthScore.score);
  }

  // Per-subsystem status
  const checks = healthData.checks;
  for (const [name, check] of Object.entries(checks)) {
    let statusValue;
    switch (check.status) {
      case 'healthy': statusValue = 1; break;
      case 'degraded': statusValue = 0.5; break;
      case 'unstable': statusValue = 0.25; break;
      case 'down': statusValue = 0; break;
      default:
        statusValue = check.status === 'not_configured' ? -1 : -1;
    }

    subsystemHealthStatus.set({ subsystem: name }, statusValue);

    if (check.latencyMs !== undefined) {
      subsystemHealthLatencyMs.set({ subsystem: name }, check.latencyMs);
    }
  }
}

/**
 * Update system resource metrics.
 * Call this periodically (e.g., every 10s via setInterval).
 */
function updateSystemMetrics() {
  const memUsage = process.memoryUsage();

  processMemoryBytes.set({ type: 'heapUsed' }, memUsage.heapUsed);
  processMemoryBytes.set({ type: 'heapTotal' }, memUsage.heapTotal);
  processMemoryBytes.set({ type: 'rss' }, memUsage.rss);
  processMemoryBytes.set({ type: 'external' }, memUsage.external);
  processMemoryBytes.set({ type: 'arrayBuffers' }, memUsage.arrayBuffers);

  processUptimeSeconds.set(process.uptime());

  if (memUsage.heapTotal > 0) {
    heapUsagePercent.set((memUsage.heapUsed / memUsage.heapTotal) * 100);
  }
}

/**
 * Update security metrics from D10 CSRF module.
 *
 * @param {object} csrfInfo - From csrf.getCsrfInfo()
 */
function updateCsrfMetrics(csrfInfo) {
  if (!csrfInfo) return;

  csrfTokenStoreSize.set({ store_type: 'total' }, csrfInfo.totalActiveTokens || 0);
  csrfTokenStoreSize.set({ store_type: 'users' }, csrfInfo.activeUsers || 0);
}

/**
 * Record an auth operation.
 *
 * @param {string} operation - login|register|refresh|logout|reset_password
 * @param {string} status - success|failure
 */
function recordAuthOperation(operation, status) {
  authOperationsTotal.inc({ operation, status });
}

/**
 * Record an email send result.
 *
 * @param {string} platform - GMAIL|OUTLOOK|QQ|NETEASE_163|CUSTOM_SMTP
 * @param {boolean} success - Whether it succeeded
 * @param {string} [failureReason] - Reason if failed
 */
function recordEmailSend(platform, success, failureReason) {
  if (success) {
    emailsSentTotal.inc({ platform });
  } else {
    emailsFailedTotal.inc({ reason: failureReason || 'unknown' });
  }
}

/**
 * Record a CSRF validation failure.
 *
 * @param {string} reason - The rejection reason code
 */
function recordCsrfFailure(reason) {
  csrfValidationFailures.inc({ reason });
}

/**
 * Start periodic metric collection (system resources + error rates).
 * Returns a cleanup function to stop the timer.
 *
 * @param {object} deps - Optional dependencies for richer metrics
 * @returns {{ stop: Function }} Handle to stop collection
 */
function startPeriodicCollection(deps = {}) {
  const intervalMs = parseInt(process.env.METRICS_COLLECTION_INTERVAL_MS || '10000');

  const timer = setInterval(() => {
    try {
      updateSystemMetrics();

      // Integrate with D11 error tracker if available
      if (deps.getErrorSummary) {
        updateErrorMetrics(deps.getErrorSummary());
      }

      // Integrate with D10 CSRF if available
      if (deps.getCsrfInfo) {
        updateCsrfMetrics(deps.getCsrfInfo());
      }
    } catch (e) {
      // Silently fail — metrics collection should never crash the app
    }
  }, intervalMs);

  // Don't prevent Node.js exit
  if (timer.unref) timer.unref();

  // Run once immediately
  updateSystemMetrics();

  return {
    stop: () => clearInterval(timer),
  };
}

// ============================================
// Export All Metrics
// ============================================

async function getMetrics() {
  return client.register.metrics();
}

async function resetMetrics() {
  return client.register.resetMetrics();
}

function getContentType() {
  return client.register.contentType;
}

module.exports = {
  // Main functions
  startMetricsCollection,
  getMetrics,
  resetMetrics,
  getContentType,
  startPeriodicCollection,

  // Manual update helpers
  updateErrorMetrics,
  updateHealthMetrics,
  updateSystemMetrics,
  updateCsrfMetrics,
  recordAuthOperation,
  recordEmailSend,
  recordCsrfFailure,

  // Individual metric objects (for direct manipulation)
  metrics: {
    // HTTP
    httpRequestDurationSeconds,
    httpRequestsTotal,
    activeConnections,
    // Errors (D11)
    errorRateByCode,
    errorTotalGauge,
    // Health (D14)
    subsystemHealthStatus,
    subsystemHealthLatencyMs,
    healthScoreGauge,
    // Pipeline
    emailQueueSize,
    emailsSentTotal,
    emailsFailedTotal,
    // Security (D10)
    csrfTokenStoreSize,
    csrfValidationFailures,
    // Auth
    authOperationsTotal,
    // System
    processMemoryBytes,
    processUptimeSeconds,
    heapUsagePercent,
    // Database
    databaseQueryDurationSeconds,
    dbPoolSize,
  },

  // Config
  METRICS_PREFIX,
};
