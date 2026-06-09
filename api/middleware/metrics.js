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
// M-B02: Custom Business Metrics
// ============================================

// --- Email Sending Business Metrics ---

/**
 * Total emails sent with status and campaign_id labels.
 * Replaces the older emails_sent_total / emails_failed_total for unified tracking.
 * status: success | fail | bounced
 */
const emailsTotal = new client.Counter({
  name: `${METRICS_PREFIX}emails_total`,
  help: 'Total number of emails sent, labeled by status and campaign_id',
  labelNames: ['status', 'campaign_id'],
});

/** Duration of individual email send operations */
const emailSendDurationSeconds = new client.Histogram({
  name: `${METRICS_PREFIX}email_send_duration_seconds`,
  help: 'Duration of single email send operations in seconds',
  labelNames: ['platform', 'campaign_id'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 15, 30, 60],
});

/** Number of currently active (running) marketing campaigns */
const campaignsActive = new client.Gauge({
  name: `${METRICS_PREFIX}campaigns_active`,
  help: 'Number of currently active marketing campaigns',
});

// --- User / Client Business Metrics ---

/** Total number of registered clients */
const clientsTotal = new client.Gauge({
  name: `${METRICS_PREFIX}clients_total`,
  help: 'Total number of registered clients',
});

/** Number of currently online users */
const usersOnline = new client.Gauge({
  name: `${METRICS_PREFIX}users_online`,
  help: 'Number of currently online users',
});

/**
 * Total API requests counter with endpoint/method/status labels.
 * More granular than http_requests_total which uses route paths.
 */
const apiRequestsTotal = new client.Counter({
  name: `${METRICS_PREFIX}api_requests_total`,
  help: 'Total API requests labeled by endpoint, method, and status',
  labelNames: ['endpoint', 'method', 'status'],
});

/** API request latency histogram for P50/P95/P99 analysis */
const apiRequestDurationSeconds = new client.Histogram({
  name: `${METRICS_PREFIX}api_request_duration_seconds`,
  help: 'API request duration in seconds for latency analysis',
  labelNames: ['endpoint', 'method'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// --- System Resource Business Metrics ---

/** Active database connections (from pool) */
const dbConnectionsActive = new client.Gauge({
  name: `${METRICS_PREFIX}db_connections_active`,
  help: 'Number of active database connections',
});

/** Redis operation duration histogram */
const redisOpsDurationSeconds = new client.Histogram({
  name: `${METRICS_PREFIX}redis_ops_duration_seconds`,
  help: 'Duration of Redis operations in seconds',
  labelNames: ['operation'], // get, set, del, hget, hset, etc.
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
});

/** Email queue depth by state (pending, sending, completed, failed) */
const queueDepth = new client.Gauge({
  name: `${METRICS_PREFIX}queue_depth`,
  help: 'Email queue depth by state',
  labelNames: ['state'], // pending, sending, completed, failed
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

// ============================================
// M-B02: Business Metric Helpers
// ============================================

/**
 * Record an email send result with unified status label (M-B02).
 * Use this instead of recordEmailSend for business-level tracking.
 *
 * @param {object} params
 * @param {string} params.status - 'success' | 'fail' | 'bounced'
 * @param {string} [params.campaign_id] - Campaign UUID
 * @param {string} [params.platform] - SMTP platform name
 * @param {number} [params.durationSec] - Send duration in seconds
 */
function recordBusinessEmailSend({ status, campaign_id, platform, durationSec }) {
  emailsTotal.inc({ status, campaign_id: campaign_id || '' });
  if (durationSec !== undefined) {
    emailSendDurationSeconds.observe({ platform: platform || 'unknown', campaign_id: campaign_id || '' }, durationSec);
  }
}

/**
 * Update active campaigns count.
 * @param {number} count
 */
function updateCampaignsActive(count) {
  campaignsActive.set(count);
}

/**
 * Update total clients count.
 * @param {number} count
 */
function updateClientsTotal(count) {
  clientsTotal.set(count);
}

/**
 * Update online users count.
 * @param {number} count
 */
function updateUsersOnline(count) {
  usersOnline.set(count);
}

/**
 * Record an API request (M-B02 business-level).
 * Called alongside the existing HTTP auto-instrumentation.
 *
 * @param {string} endpoint - e.g. '/api/campaigns', '/api/v1/auth/login'
 * @param {string} method - GET|POST|PUT|DELETE
 * @param {number|string} status - HTTP status code
 * @param {number} [durationSec] - Request duration in seconds
 */
function recordApiRequest(endpoint, method, status, durationSec) {
  apiRequestsTotal.inc({ endpoint, method, status: String(status) });
  if (durationSec !== undefined) {
    apiRequestDurationSeconds.observe({ endpoint, method }, durationSec);
  }
}

/**
 * Update active DB connections count.
 * @param {number} count
 */
function updateDbConnectionsActive(count) {
  dbConnectionsActive.set(count);
}

/**
 * Record a Redis operation duration.
 * @param {string} operation - get|set|del|hget|hset|etc
 * @param {number} durationSec - Operation duration in seconds
 */
function recordRedisOp(operation, durationSec) {
  redisOpsDurationSeconds.observe({ operation }, durationSec);
}

/**
 * Update queue depth by state.
 * @param {string} state - pending|sending|completed|failed
 * @param {number} count
 */
function updateQueueDepth(state, count) {
  queueDepth.set({ state }, count);
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
 * Start periodic metric collection (system resources + error rates + business metrics).
 * Returns a cleanup function to stop the timer.
 *
 * @param {object} deps - Optional dependencies for richer metrics
 * @param {Function} [deps.getErrorSummary] - D11 error tracker
 * @param {Function} [deps.getCsrfInfo] - D10 CSRF module
 * @param {Function} [deps.getBusinessMetrics] - M-B02: async fn returning { activeCampaigns, totalClients, queueDepths }
 * @returns {{ stop: Function }} Handle to stop collection
 */
function startPeriodicCollection(deps = {}) {
  const intervalMs = parseInt(process.env.METRICS_COLLECTION_INTERVAL_MS || '10000');

  const timer = setInterval(async () => {
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

      // M-B02: Collect business metrics if provider is available
      if (deps.getBusinessMetrics) {
        try {
          const biz = await deps.getBusinessMetrics();
          if (biz.activeCampaigns !== undefined) updateCampaignsActive(biz.activeCampaigns);
          if (biz.totalClients !== undefined) updateClientsTotal(biz.totalClients);
          if (biz.onlineUsers !== undefined) updateUsersOnline(biz.onlineUsers);
          if (biz.dbConnectionsActive !== undefined) updateDbConnectionsActive(biz.dbConnectionsActive);
          if (biz.queueDepths && typeof biz.queueDepths === 'object') {
            for (const [state, count] of Object.entries(biz.queueDepths)) {
              updateQueueDepth(state, count);
            }
          }
        } catch (_) {
          // Business metrics collection failure should not crash
        }
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

  // M-B02: Business metric helpers
  recordBusinessEmailSend,
  updateCampaignsActive,
  updateClientsTotal,
  updateUsersOnline,
  recordApiRequest,
  updateDbConnectionsActive,
  recordRedisOp,
  updateQueueDepth,

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
    // M-B02: Business Metrics
    emailsTotal,
    emailSendDurationSeconds,
    campaignsActive,
    clientsTotal,
    usersOnline,
    apiRequestsTotal,
    apiRequestDurationSeconds,
    dbConnectionsActive,
    redisOpsDurationSeconds,
    queueDepth,
  },

  // Config
  METRICS_PREFIX,
};
