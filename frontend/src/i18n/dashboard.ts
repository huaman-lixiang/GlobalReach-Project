/**
 * Dashboard page i18n texts (zh-CN)
 * DEBT-014: Extracted from Dashboard.tsx hardcoded strings
 * To add English: create dashboard.en.ts and switch based on locale
 *
 * NOTE: platformLabels below uses t() at module top-level (outside React component).
 * This violates React Rules of Hooks. The string values are extracted here for i18n
 * purposes; fixing the hook placement is a separate task.
 */
export const dashboardTexts = {
  // Page header
  page: {
    title: '仪表盘概览',
    subtitle: '实时数据 · 自动刷新',
  },
  // Stat card suffixes
  statSuffix: {
    emails: '封',
    count: '个',
  },
  // Additional stat titles (beyond t() keys)
  stats: {
    clickRate: '点击率',
    bounceRate: '退信率',
  },
  // Platform labels (raw values — original code uses t() hook incorrectly at top level)
  platformLabels: {
    GMAIL: 'Gmail',
    OUTLOOK: 'Outlook',
    QQ: 'QQ 邮箱',
    NETEASE_163: '网易 163',
    CUSTOM_SMTP: '自定义 SMTP',
  },
  // Chart labels
  chart: {
    sentCount: '发送数',
    openCount: '打开数',
    sendVolume: '发送量',
    platformComparison: '各平台发送量对比',
  },
  // Empty states
  empty: {
    noPlatformData: '暂无平台数据',
  },
  // Activity timeline
  activity: {
    noSubject: '(无主题)',
  },
} as const;
