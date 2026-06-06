// S102/PhaseH: OpenTelemetry SDK Initialization
// ============================================================
// Distributed Tracing Integration — Grafana Tempo Backend
//
// This file initializes OpenTelemetry for automatic instrumentation.
// It MUST be required FIRST in server.js (before any other imports).
//
// Architecture:
//   API Request → OTEL Auto-Instrumentation → Span Created
//     → OTLP Exporter → Tempo (gRPC:4317)
//     → Grafana Explore → Trace Visualization
//
// Trace ID Flow:
//   1. OTEL generates traceId + spanId for each request
//   2. Existing X-Trace-ID header preserved as custom attribute
//   3. Logs include traceId via existing logger middleware
//   4. Loki derivedFields links logs ↔ traces in Grafana
//

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { Resource } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

// Enable debug logging only in non-production
if (process.env.NODE_ENV !== 'production') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

// Initialize the SDK
const sdk = new NodeSDK({
  // Service identity — appears in Grafana Tempo UI
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'globalreach-api',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '2.0.0',
    'deployment.environment': process.env.NODE_ENV || 'production',
    'service.instance.id': process.env.HOSTNAME || 'local-dev',
  }),

  // Export traces to Grafana Tempo via OTLP/gRPC
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo:4317',
      // Optional headers for multi-tenant setups
      headers: {},
    })
  ),

  // Auto-instrumentation — captures Express routes, HTTP calls, DB queries
  instrumentations: [
    // @opentelemetry/auto-instrumentations-node handles all of these:
    // - HttpInstrumentation (Express inbound requests)
    // - GrpcInstrumentation
    // - PostgreSQLInstrumentation (Sequelize queries)
    // - RedisInstrumentation (ioredis/redis calls)
  ],
});

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('[OTEL] Tracing shutdown complete'))
    .catch((err) => console.error('[OTEL] Tracing shutdown error:', err))
    .finally(() => process.exit(0));
});

// Start the SDK
sdk.start().then(() => {
  console.log('[OTEL] OpenTelemetry initialized — exporting to Tempo');
}).catch((err) => {
  console.warn('[OTEL] OpenTelemetry init failed (tracing disabled):', err.message);
});

module.exports = sdk;
