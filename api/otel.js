// S102/PhaseH: OpenTelemetry SDK Initialization
// ============================================================
// Distributed Tracing Integration — Grafana Tempo Backend
//
// Non-blocking initialization: if OTEL fails, API continues normally.
// Tracing is a best-effort observability feature, not a hard dependency.
//

let sdk;

try {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
  const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

  // Suppress OTEL internal logs in production
  if (process.env.NODE_ENV === 'production') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
  }

  sdk = new NodeSDK({
    serviceName: 'globalreach-api',
    serviceVersion: process.env.npm_package_version || '2.0.0',
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo:4317',
      })
    ),
  });

  // Start asynchronously — don't block server startup
  sdk.start()
    .then(() => console.log('[OTEL] OpenTelemetry initialized — exporting to Tempo'))
    .catch((err) => console.warn('[OTEL] Init failed (tracing disabled):', err.message));

  // Graceful shutdown
  process.on('SIGTERM', () => {
    if (sdk) {
      sdk.shutdown()
        .then(() => console.log('[OTEL] Tracing shutdown complete'))
        .catch(() => {})
        .finally(() => process.exit(0));
    }
  });

} catch (err) {
  console.warn('[OTEL] SDK not available (tracing disabled):', err.message);
}

module.exports = sdk || null;
