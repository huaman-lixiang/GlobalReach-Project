/**
 * Metrics Route — D15 Prometheus Endpoint + M-A04 Queue Metrics
 *
 * GET /api/v1/metrics — Exposes all Prometheus-format metrics
 * GET /api/v1/metrics/info — Returns metric metadata summary
 * GET /api/v1/metrics/queue — M-A04: Enhanced queue depth & throughput metrics
 */

const express = require('express');
const router = express.Router();
const { getMetrics, getContentType, METRICS_PREFIX } = require('../middleware/metrics');
const { asyncHandler } = require('../middleware/errorHandler');

// M-A04: Queue metrics helper (lazy load to avoid circular dependency)
let _emailQueue = null;
function getEmailQueue() {
  if (!_emailQueue) {
    try {
      // Queue is set by server.js after initialization
      const queue = require('../queue/emailQueue');
      // This won't work directly - we need the instance from server.js
      // Instead, we'll expose it via a setter
    } catch (e) {
      console.warn('[Metrics/M-A04] EmailQueue not available for metrics');
    }
  }
  return _emailQueue;
}

// M-A04: Setter for queue instance (called by server.js)
function setQueue(queueInstance) {
  _emailQueue = queueInstance;
}

/**
 * Main Prometheus metrics endpoint.
 * Scraped by Prometheus / Grafana / monitoring systems.
 */
router.get('/', asyncHandler(async (req, res) => {
  const contentType = getContentType() || 'text/plain; version=0.0.4; charset=utf-8';
  res.set('Content-Type', contentType);
  // Cache for 5s to prevent excessive scraping
  res.set('Cache-Control', 'public, max-age=5');
  const metrics = await getMetrics();
  res.end(metrics);
}));

/**
 * Metric info endpoint — returns summary of available custom metrics.
 * Useful for debugging and discovery without parsing Prometheus format.
 */
router.get('/info', (_req, res) => {
  res.json({
    success: true,
    data: {
      prefix: METRICS_PREFIX,
      format: 'prometheus/text',
      customMetricGroups: [
        { group: 'http', metrics: ['http_request_duration_seconds', 'http_requests_total', 'active_connections'] },
        { group: 'errors (D11)', metrics: ['error_rate_by_code', 'errors_total'] },
        { group: 'health (D14)', metrics: ['subsystem_health_status', 'subsystem_health_latency_ms', 'health_score'] },
        { group: 'pipeline', metrics: ['email_queue_size', 'emails_sent_total', 'emails_failed_total'] },
        { group: 'security (D10)', metrics: ['csrf_token_store_size', 'csrf_validation_failures_total'] },
        { group: 'auth', metrics: ['auth_operations_total'] },
        { group: 'system', metrics: ['process_memory_bytes', 'process_uptime_seconds', 'heap_usage_percent'] },
        { group: 'database', metrics: ['database_query_duration_seconds', 'db_pool_size'] },
        { group: 'business (M-B02) email', metrics: ['emails_total', 'email_send_duration_seconds', 'campaigns_active'] },
        { group: 'business (M-B02) user/client', metrics: ['clients_total', 'users_online', 'api_requests_total', 'api_request_duration_seconds'] },
        { group: 'business (M-B02) resource', metrics: ['db_connections_active', 'redis_ops_duration_seconds', 'queue_depth'] },
      ],
      defaultNodeMetrics: true,
      scrapeEndpoint: '/api/v1/metrics',
    },
  });
});

/**
 * M-A04: Queue-specific metrics endpoint.
 * Provides real-time queue depth, throughput, DLQ size, and health indicators.
 * Enhanced observability for operations team.
 */
router.get('/queue', (req, res) => {
  try {
    const queue = getEmailQueue();

    if (!queue) {
      return res.status(503).json({
        success: false,
        error: 'QUEUE_NOT_AVAILABLE',
        message: 'Email queue not initialized',
      });
    }

    const stats = queue.getStats();
    const dlq = queue.getDeadLetterQueue({ limit: 10 }); // Last 10 DLQ entries

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        // Queue depth by state
        depth: {
          pending: stats.pending,
          processing: stats.processing,
          delayed: stats.delayed || 0,
          completed: stats.totalProcessed, // Approximation
          deadLetter: stats.dlqSize || 0,
        },
        // Throughput & performance
        performance: {
          throughput: stats.throughput || 0, // jobs/second
          currentConcurrency: stats.currentConcurrency,
          totalEnqueued: stats.totalEnqueued,
          totalProcessed: stats.totalProcessed,
          successRate: stats.totalProcessed > 0
            ? parseFloat(((stats.totalSucceeded / stats.totalProcessed) * 100).toFixed(2))
            : 0,
        },
        // Retry & failure tracking
        reliability: {
          totalRetries: stats.totalRetried,
          totalFailed: stats.totalFailed,
          totalDLQ: stats.totalDLQ || 0,
          totalStalledRecovered: stats.totalStalledRecovered || 0,
        },
        // System health
        health: {
          memoryUnderPressure: stats.memoryUnderPressure || false,
          globalRateLimitUsage: stats.globalRateLimitUsage || '0/20',
          activeCampaigns: stats.activeCampaigns,
        },
        // Recent DLQ entries (for ops review)
        recentDLQ: dlq.map(entry => ({
          id: entry.id,
          type: entry.type,
          error: entry.error,
          enqueuedAt: entry.enqueuedAt,
          priority: entry.priority,
        })),
      },
      meta: {
        endpoint: '/api/v1/metrics/queue',
        refreshInterval: '5s',
      },
    });
  } catch (error) {
    console.error('[Metrics/M-A04] Queue metrics error:', error.message);
    res.status(500).json({
      success: false,
      error: 'QUEUE_METRICS_ERROR',
      message: 'Failed to collect queue metrics',
    });
  }
});

/**
 * M-A04: DLQ management endpoint (admin only).
 * GET /api/v1/metrics/queue/dlq - View DLQ contents
 * POST /api/v1/metrics/queue/dlq/:jobId/retry - Retry a specific job from DLQ
 */
router.get('/queue/dlq', (req, res) => {
  try {
    const queue = getEmailQueue();
    if (!queue) {
      return res.status(503).json({ success: false, error: 'QUEUE_NOT_AVAILABLE' });
    }

    const { limit = 100, since } = req.query;
    const dlq = queue.getDeadLetterQueue({
      limit: parseInt(limit),
      since,
    });

    res.json({
      success: true,
      data: {
        totalDLQ: dlq.length,
        entries: dlq.map(entry => ({
          id: entry.id,
          type: entry.type,
          campaignId: entry.campaignId,
          emailId: entry.emailId,
          error: entry.error,
          retryCount: entry.retryCount,
          priority: entry.priority,
          enqueuedAt: entry.enqueuedAt,
          metadata: entry.metadata,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'DLQ_QUERY_ERROR', message: error.message });
  }
});

router.post('/queue/dlq/:jobId/retry', (req, res) => {
  try {
    const queue = getEmailQueue();
    if (!queue) {
      return res.status(503).json({ success: false, error: 'QUEUE_NOT_AVAILABLE' });
    }

    const { jobId } = req.params;
    const success = queue.retryFromDLQ(jobId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'JOB_NOT_IN_DLQ',
        message: `Job ${jobId} not found in Dead Letter Queue`,
      });
    }

    res.json({
      success: true,
      message: `Job ${jobId} retried from DLQ and re-enqueued`,
      data: { jobId, retriedAt: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'DLQ_RETRY_ERROR', message: error.message });
  }
});

module.exports = router;
// M-A04: Export setter for server.js to inject queue instance
module.exports.setQueue = setQueue;
