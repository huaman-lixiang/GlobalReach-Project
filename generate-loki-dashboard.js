// S109/PhaseH: Loki Analytics Dashboard Generator
// Rebuilds damaged globalreach-loki-analytics.json using programmatic JS → JSON.stringify()
// This guarantees valid JSON output (no escaping issues like the original file)

const fs = require('fs');
const path = require('path');

// ─── Panel Builder Helpers ──────────────────────────────────────
function makeTarget(expr, refId = 'A', legendFormat = '__auto') {
  return {
    datasource: { type: 'loki', uid: '${loki_uid}' },
    editorMode: 'code',
    expr: expr,
    hide: false,
    legendFormat: legendFormat,
    queryType: 'range',
    refId: refId
  };
}

function makeTablePanel(id, title, description, queryExpr, gridPos, overrides = []) {
  return {
    datasource: { type: 'loki', uid: '${loki_uid}' },
    description: description,
    fieldConfig: {
      defaults: {
        color: { mode: 'thresholds' },
        custom: {
          align: 'auto',
          cellOptions: { type: 'auto' },
          inspect: false
        },
        mappings: [],
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'green', value: null },
            { color: 'yellow', value: 200 },
            { color: 'red', value: 400 }
          ]
        },
        unit: 'none'
      },
      overrides: overrides
    },
    gridPos: gridPos,
    id: id,
    options: {
      cellHeight: 'sm',
      footer: { countRows: false, fields: '', reducer: ['sum'], show: false },
      showHeader: true
    },
    pluginVersion: '11.6.1',
    targets: [makeTarget(queryExpr)],
    title: title,
    transformations: [{ id: 'labelsToFields', options: { mode: 'rows' } }],
    type: 'table'
  };
}

function makeTimeSeriesPanel(id, title, description, queryExpr, gridPos, unit = 'short') {
  return {
    datasource: { type: 'loki', uid: '${loki_uid}' },
    description: description,
    fieldConfig: {
      defaults: {
        color: { mode: 'palette-classic' },
        custom: {
          axisCenteredZero: false,
          axisColorMode: 'text',
          axisLabel: '',
          axisPlacement: 'auto',
          barAlignment: 0,
          drawStyle: 'line',
          fillOpacity: 10,
          gradientMode: 'none',
          hideFrom: { legend: false, tooltip: false, viz: false },
          lineInterpolation: 'linear',
          lineWidth: 1,
          pointSize: 5,
          scaleDistribution: { type: 'linear' },
          showPoints: 'never',
          spanNulls: false,
          stacking: { group: 'A', mode: 'none' },
          thresholdsStyle: { mode: 'off' }
        },
        mappings: [],
        thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
        unit: unit
      },
      overrides: []
    },
    gridPos: gridPos,
    id: id,
    options: {
      legend: { calcs: ['last', 'mean'], displayMode: 'table', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'multi', sort: 'desc' }
    },
    pluginVersion: '11.6.1',
    targets: [makeTarget(queryExpr)],
    title: title,
    type: 'timeseries'
  };
}

function makeStatPanel(id, title, description, queryExpr, gridPos, colorMode = 'value') {
  return {
    datasource: { type: 'loki', uid: '${loki_uid}' },
    description: description,
    fieldConfig: {
      defaults: {
        color: { mode: colorMode },
        mappings: [],
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'green', value: null },
            { color: 'yellow', value: 50 },
            { color: 'red', value: 100 }
          ]
        },
        unit: 'ops'
      },
      overrides: []
    },
    gridPos: gridPos,
    id: id,
    options: {
      colorMode: colorMode || 'value',
      graphMode: 'area',
      justifyMode: 'auto',
      orientation: 'auto',
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      textMode: 'auto'
    },
    pluginVersion: '11.6.1',
    targets: [makeTarget(queryExpr)],
    title: title,
    type: 'stat'
  };
}

function makeBarPanel(id, title, description, queryExpr, gridPos) {
  return {
    datasource: { type: 'loki', uid: '${loki_uid}' },
    description: description,
    fieldConfig: {
      defaults: {
        color: { mode: 'palette-classic' },
        custom: {
          axisBorderShow: false,
          axisCenteredZero: false,
          axisColorMode: 'text',
          axisLabel: '',
          axisPlacement: 'auto',
          barAlignment: 0,
          drawStyle: 'bars',
          fillOpacity: 80,
          gradientMode: 'none',
          hideFrom: { legend: false, tooltip: false, viz: false },
          lineInterpolation: 'linear',
          lineWidth: 1,
          pointSize: 5,
          scaleDistribution: { type: 'linear' },
          showPoints: 'never',
          spanNulls: false,
          stacking: { group: 'A', mode: 'normal' },
          thresholdsStyle: { mode: 'off' }
        },
        mappings: [],
        thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
        unit: 'short'
      },
      overrides: []
    },
    gridPos: gridPos,
    id: id,
    options: {
      legend: { calcs: ['last'], displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'single', sort: 'none' }
    },
    pluginVersion: '11.6.1',
    targets: [makeTarget(queryExpr)],
    title: title,
    type: 'barchart'
  };
}

function makeLogsPanel(id, title, description, queryExpr, gridPos) {
  return {
    datasource: { type: 'loki', uid: '${loki_uid}' },
    description: description,
    gridPos: gridPos,
    id: id,
    options: {
      dedupStrategy: 'none',
      enableLogDetails: true,
      prettifyLogMessage: false,
      showCommonLabels: false,
      showLabels: false,
      showTime: true,
      sortOrder: 'Descending',
      wrapLogMessage: false
    },
    pluginVersion: '11.6.1',
    targets: [makeTarget(queryExpr)],
    title: title,
    type: 'logs'
  };
}

// ─── Build Dashboard Object ──────────────────────────────────────
const dashboard = {
  annotations: { list: [] },
  editable: true,
  fiscalYearStartMonth: 0,
  graphTooltip: 0,
  id: null,
  links: [],
  liveNow: false,

  // ─── Panels (8 panels total) ────────────────────────────────
  panels: [
    // Panel 1: Log Throughput Stats (row of 4 stat boxes)
    makeStatPanel(1, 'Total Logs/sec', 'Total log volume across all GlobalReach containers',
      'sum(rate({job=~"globalreach.*"}[5m])) * 60', { h: 4, w: 3, x: 0, y: 0 }, 'background'),
    makeStatPanel(2, 'Error Rate', 'Percentage of ERROR/WARN level logs vs total',
      '(sum(rate({job=~"globalreach.*"} |= "ERROR" or |= "WARN" [5m])) / sum(rate({job=~"globalreach.*"}[5m]))) * 100',
      { h: 4, w: 3, x: 3, y: 0 }, 'value'),
    makeStatPanel(3, '5xx Errors/min', 'HTTP 5xx server errors per minute from API logs',
      'sum(count_over_time({container_name="globalreach-api-prod"} |= `5[0-9][0-9]` | json [5m]))',
      { h: 4, w: 3, x: 6, y: 0 }, 'value'),
    makeStatPanel(4, 'Exceptions/min', 'Application exceptions detected per minute',
      'sum(count_over_time({container_name="globalreach-api-prod"} |= `exception` or |= `Error:` [5m]))',
      { h: 4, w: 3, x: 9, y: 0 }, 'value'),

    // Panel 5: Log Volume Over Time (time series - full width)
    makeTimeSeriesPanel(5, 'Log Volume Over Time', 'Log throughput trend by container (logs/sec)',
      'sum by (container_name)(rate({job=~"globalreach.*"}[2m]))',
      { h: 8, w: 12, x: 0, y: 4 }),

    // Panel 6: HTTP Status Code Distribution (bar chart)
    makeBarPanel(6, 'HTTP Status Code Distribution', 'Request count grouped by HTTP status code',
      'sum by (status)(count_over_time({container_name="globalreach-api-prod"} | json [15m]))',
      { h: 8, w: 6, x: 0, y: 12 }),

    // Panel 7: Log Level Distribution (bar chart)
    makeBarPanel(7, 'Log Level Distribution', 'Log volume by severity level (INFO/WARN/ERROR)',
      'sum by (level)(count_over_time({container_name="globalreach-api-prod"} |= `"` | logfmt [15m]))',
      { h: 8, w: 6, x: 6, y: 12 }),

    // Panel 8: API Application Logs Table (live tail)
    makeTablePanel(8, 'API Application Logs (Live)', 'Real-time structured logs from Express/Node.js with JSON parsing',
      '{container_name="globalreach-api-prod"} | json',
      { h: 10, w: 24, x: 0, y: 20 }, [
        {
          matcher: { id: 'byName', options: 'level' },
          properties: [
            { id: 'mappings', value: [{ options: { 'ERROR': { color: 'red', index: 3 }, 'WARN': { color: 'yellow', index: 2 }, 'INFO': { color: 'green', index: 1 }, unknown: { color: 'gray', index: 0 } }, type: 'value' }] },
            { id: 'thresholds', value: { mode: 'absolute', steps: [{ color: 'green', value: null }] } }
          ]
        }
      ])
  ],

  // ─── Dashboard Metadata ──────────────────────────────────────
  refresh: '30s',
  schemaVersion: 39,
  tags: ['globalreach', 'loki', 'analytics', 'logging'],
  templating: {
    list: []
  },
  time: { from: 'now-1h', to: 'now' },
  timepicker: {},
  timezone: 'browser',
  title: 'GlobalReach — Loki Analytics',
  uid: 'globalreach-loki-analytics',
  version: 1,
  weekStart: ''
};

// ─── Write Output ───────────────────────────────────────────────
const outputPath = path.join(__dirname, 'grafana/provisioning/dashboards/globalreach-loki-analytics.json');
const output = JSON.stringify(dashboard, null, 2);
fs.writeFileSync(outputPath, output, 'utf8');

// Verify
try {
  const verify = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  console.log('[OK] Dashboard generated successfully!');
  console.log('     Size:', output.length, 'bytes');
  console.log('     Panels:', verify.panels.length);
  console.log('     Title:', verify.title);
  console.log('     UID:', verify.uid);
  console.log('     Path:', outputPath);
} catch (e) {
  console.error('[FAIL] Generated JSON is invalid:', e.message);
  process.exit(1);
}
