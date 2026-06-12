/**
 * Accounts page i18n texts (zh-CN)
 * DEBT-014: Extracted from Accounts.tsx hardcoded strings
 * To add English: create accounts.en.ts and switch based on locale
 */
export const accountsTexts = {
  // Platform options
  platforms: {
    gmail: 'Gmail',
    outlook: 'Outlook',
    qq: 'QQ Mail',
    netease163: '163 Mail',
    customSmtp: 'Custom SMTP',
  },
  // Status config
  status: {
    active: 'Active',
    inactive: 'Disabled',
    restricted: 'Restricted',
    banned: 'Banned',
    error: 'Error',
  },
  // Messages
  messages: {
    deleteSuccess: 'Deleted successfully',
    deleteFailed: 'Delete failed',
    connectionSuccess: (latency: string) => `Connection successful! Latency: ${latency}ms`,
    connectionFailed: (reason: string) => `Connection failed: ${reason || 'Unknown error'}`,
    testConnectionFailed: 'Connection test failed',
    activated: 'Account activated',
    activateFailed: 'Activation failed',
    deactivated: 'Account disabled',
    deactivateFailed: 'Deactivation failed',
    updateSuccess: 'Updated successfully',
    createSuccess: 'Created successfully',
  },
  // Table columns
  table: {
    email: 'Email Address',
    platform: 'Platform Type',
    status: 'Status',
    health: 'Health Score',
    sentToday: 'Sent Today',
    createdAt: 'Created At',
    actions: 'Actions',
    totalRecords: (total: number) => `Total ${total} records`,
  },
  // Action buttons / tooltips
  actions: {
    testConnection: 'Test Connection',
    edit: 'Edit',
    activate: 'Activate',
    deactivate: 'Disable',
    delete: 'Delete',
    deleteConfirm: 'Are you sure you want to delete this account?',
    deleteOk: 'Confirm',
    deleteCancel: 'Cancel',
  },
  // Page header
  page: {
    title: 'Account Management Center',
  },
  // Health summary
  health: {
    engineStatus: 'Engine Status:',
    registeredAccounts: 'Registered Accounts:',
    activeAccounts: 'Active Accounts:',
    avgHealthScore: 'Avg Health Score:',
    refresh: 'Refresh Status',
  },
  // Filter section
  filter: {
    platformPlaceholder: 'Filter by Platform',
    statusPlaceholder: 'Filter by Status',
    search: 'Search',
    refresh: 'Refresh',
    newAccount: 'New Account',
    filterAndSearch: 'Filter & Search',
  },
  // Modal
  modal: {
    editTitle: 'Edit Account',
    createTitle: 'Add Email Account',
    save: 'Save',
    cancel: 'Cancel',
    emailLabel: 'Email Address',
    emailRequired: 'Please enter email address',
    emailInvalid: 'Please enter a valid email address',
    emailPlaceholder: 'example@gmail.com',
    platformLabel: 'Platform Type',
    platformRequired: 'Please select platform type',
    platformPlaceholder: 'Select Platform',
    passwordLabel: 'Password / App-Specific Password',
    passwordRequired: 'Please enter password or app-specific password',
    passwordPlaceholder: 'For Gmail, please use app-specific password',
    encryptionLabel: 'Encryption Method',
    ssl: 'SSL/TLS',
    starttls: 'STARTTLS',
    none: 'No Encryption (not recommended)',
    statusLabel: 'Status',
  },
} as const;
