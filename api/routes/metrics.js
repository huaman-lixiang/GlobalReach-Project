/**
 * Metrics Route — D15 Prometheus Endpoint
 *
 * GET /api/v1/metrics — Exposes all Prometheus-format metrics
 * GET /api/v1/metrics/info — Returns metric metadata summary
 */

const express = require('express');
const router = express.Router();
const { getMetrics, getContentType, METRICS_PREFIX } = require('../middleware/metrics');

/**
 * Main Prometheus metrics endpoint.
 * Scraped by Prometheus / Grafana / monitoring systems.
 */
router.get('/', async (req, res) => {
  try {
    const contentType = getContentType() || 'text/plain; version=0.0.4; charset=utf-8';
    res.set('Content-Type', contentType);
    // Cache for 5s to prevent excessive scraping
    res.set('Cache-Control', 'public, max-age=5');
    const metrics = await getMetrics();
    res.end(metrics);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'METRICS_COLLECTION_FAILED',
      message: 'Failed to collect Prometheus metrics',
    });
  }
});

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
      ],
      defaultNodeMetrics: true,
      scrapeEndpoint: '/api/v1/metrics',
    },
  });
});

module.exports = router;
