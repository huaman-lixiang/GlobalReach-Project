// S104/PhaseH: OpenTelemetry SDK Initialization (v2.x compatible)
// ============================================================
// Distributed Tracing — Grafana Tempo Backend
//
// Strategy: Manual tracing mode (no auto-instrumentation)
// - Auto-instrumentations cause "MetricReader bound twice" conflict in Node.js 24
// - Custom traceId middleware already provides trace context in logs
// - This module exports spans to Tempo for Grafana Explore visualization
//
// Non-blocking: if OTEL fails, API continues normally.
//

let sdk;

try {
  const opentelemetry = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

  // S104: Minimal config
  const traceExporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo:4317',
  });

  sdk = new opentelemetry.NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'globalreach-api',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '2.0.0',
    }),
    traceExporter,
  });

  // S104: Start SDK (v2.x returns undefined/sync, not Promise)
  sdk.start();
  console.log('[OTEL] Initialized — exporting traces to Tempo');

  // Graceful shutdown
  process.on('SIGTERM', () => {
    if (sdk) {
      sdk.shutdown()
        .then(() => console.log('[OTEL] Shutdown complete'))
        .catch(() => {})
        .finally(() => process.exit(0));
    }
  });

} catch (err) {
  console.warn('[OTEL] Not available (tracing disabled):', err.message);
}

module.exports = sdk || null;
