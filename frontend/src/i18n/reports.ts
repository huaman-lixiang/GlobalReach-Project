/**
 * Reports page i18n texts (zh-CN)
 * DEBT-014: Extracted from Reports.tsx hardcoded strings
 * To add English: create reports.en.ts and switch based on locale
 */
export const reportsTexts = {
  // Page header
  page: {
    title: 'Data Report Analysis',
    subtitle: 'Deep Insights · Data-Driven Decisions',
  },
  // KPI metrics
  metrics: {
    openRate: 'Open Rate',
    clickRate: 'Click Rate',
    bounceRate: 'Bounce Rate',
    totalSent: 'Total Sent',
  },
  // Suffixes
  suffix: {
    emails: 'emails',
    percent: '%',
  },
  // Benchmark
  benchmark: {
    label: 'Industry Benchmark:',
  },
  // Export buttons
  export: {
    platformCsv: 'Export Platform Data (CSV)',
    trendCsv: 'Export Trend Data (CSV)',
    exportStarted: 'Export task started',
    exportFailed: 'Export failed',
  },
  // Chart titles
  charts: {
    trend14d: '14-Day Sending Trend',
    hourlyDist: 'Hourly Sending Distribution',
    platformComparison: 'Platform Performance Comparison',
    platformShare: 'Platform Share Analysis',
    keyMetricsTrend: 'Key Metrics Trend',
  },
  // Chart data keys
  chartLabels: {
    sentCount: 'Sent Count',
    openCount: 'Open Count',
    clickCount: 'Click Count',
    sendVolume: 'Send Volume',
    openVolume: 'Open Volume',
    clickVolume: 'Click Volume',
  },
  // Loading / empty states
  loading: 'Loading report data...',
  empty: {
    noPlatformData: 'No platform data yet. Statistics charts will be automatically generated after sending emails.',
    noData: 'No data yet',
  },
  // Platform labels
  platformLabels: {
    GMAIL: 'Gmail',
    OUTLOOK: 'Outlook',
    QQ: 'QQ Mail',
    NETEASE_163: '163 Mail',
    CUSTOM_SMTP: 'Custom SMTP',
  },
  // Responsive note
  responsiveNote: 'KPI Cards - Mobile responsive',
} as const;
