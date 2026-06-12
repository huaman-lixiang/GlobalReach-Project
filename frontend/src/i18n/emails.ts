/**
 * Emails page i18n texts (zh-CN)
 * DEBT-014: Extracted from Emails.tsx hardcoded strings
 * To add English: create emails.en.ts and switch based on locale
 */
export const emailsTexts = {
  // Status labels (for mobile card + table)
  status: {
    pending: 'Pending',
    sending: 'Sending',
    delivered: 'Delivered',
    bounced: 'Bounced',
    failed: 'Failed',
  },
  // Messages
  messages: {
    resendSubmitted: 'Resend request submitted',
    resendFailed: 'Resend failed',
    close: 'Close',
  },
  // Table columns
  table: {
    recipient: 'Recipient',
    subject: 'Subject',
    status: 'Status',
    sentAt: 'Sent Time',
    actions: 'Actions',
    totalRecords: (total: number) => `Total ${total} records`,
  },
  // Detail modal
  detail: {
    id: 'ID',
    sentTime: 'Sent Time',
    createdAt: 'Created At',
    errorMessage: 'Error Message',
  },
  // Action buttons / tooltips
  actions: {
    viewDetails: 'View Details',
    resend: 'Resend',
    resendConfirm: 'Are you sure you want to resend this email?',
    resendOk: 'Confirm',
    resendCancel: 'Cancel',
    details: 'Details',
  },
  // Page header
  page: {
    title: 'Email Send History',
    refreshData: 'Refresh Data',
  },
  // Filter section
  filter: {
    searchPlaceholder: 'Search recipient or subject...',
    statusPlaceholder: 'Filter by Status',
    filterBtn: 'Filter',
    filterAndSearch: 'Filter & Search',
    drawerTitle: 'Filter Conditions',
    cancel: 'Cancel',
    search: 'Search',
  },
  // Empty state
  empty: {
    noRecords: 'No email records yet',
  },
  // Mobile notes
  mobile: {
    cardItemNote: 'Mobile email card list item',
    fabNote: 'Mobile refresh button (FAB)',
    fullscreenNote: 'Email detail modal - fullscreen on mobile',
  },
} as const;
