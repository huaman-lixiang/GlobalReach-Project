/**
 * Campaigns page i18n texts (zh-CN)
 * DEBT-014: Extracted from Campaigns.tsx hardcoded strings
 * To add English: create campaigns.en.ts and switch based on locale
 */
export const campaignsTexts = {
  // Status config labels
  status: {
    draft: 'Draft',
    scheduled: 'Scheduled',
    sending: 'Sending',
    completed: 'Completed',
  },
  // Type options
  types: {
    coldOutreach: 'Cold Outreach Email',
    followUp: 'Follow-up Email',
    newsletter: 'Newsletter',
    transactional: 'Transactional Notification',
  },
  // Messages
  messages: {
    createSuccess: 'Campaign created successfully!',
    queuedForSending: (total: string) => `Campaign added to send queue! ${total} emails total`,
    sendFailed: 'Send failed',
  },
  // Wizard form labels
  wizard: {
    campaignName: 'Campaign Name',
    campaignNameRequired: 'Please enter campaign name',
    campaignNamePlaceholder: 'e.g.: Q2 Product Promotion - North America',
    campaignType: 'Campaign Type',
    campaignTypeRequired: 'Please select campaign type',
    selectType: 'Select Type',
    handlebarsSupport: 'Supports Handlebars template variables',
    availableVars: 'Available variables: {{client.name}}, {{client.company}}, {{client.email}}, {{user.name}}, {{campaign.name}}, {{date}}',
    emailSubject: 'Email Subject',
    emailSubjectRequired: 'Please enter email subject',
    emailSubjectPlaceholder: 'e.g.: Hi {{client.name}} - Invitation about {{company}} cooperation',
    sendAccounts: 'Send Accounts',
    selectAccountsPlaceholder: 'Select email accounts to use (optional, auto-assign if none selected)',
    autoAssign: 'System auto-assigns optimal account',
    scheduleConfig: 'Schedule Settings',
    scheduleNote: 'Current version uses immediate send mode. Scheduled sending will be available in a future version.',
    summaryTitle: 'Creation Summary',
  },
  // Page header
  page: {
    title: 'Campaign Management',
    createBtn: 'Create Campaign',
  },
  // Filter section
  filter: {
    searchPlaceholder: 'Search campaign name...',
    typePlaceholder: 'Campaign Type',
    statusPlaceholder: 'Filter by Status',
    filterBtn: 'Filter',
    filterTitle: 'Filters',
    filterAndSearch: 'Filter & Search',
    applyFilter: 'Apply Filter',
    mobileFilterTrigger: 'Filter & Search',
    drawerTitle: 'Filter Conditions',
  },
  // Table / list
  table: {
    totalRecords: (total: number) => `Total ${total} records`,
  },
  // Mobile FAB
  mobile: {
    note: 'Mobile card list item component',
    fabNote: 'Mobile FAB create button',
    paginationNote: 'Mobile simplified pagination',
    cardListNote: 'Mobile: card list view; Desktop: table view',
    filterDrawerNote: 'Mobile: use drawer trigger for filters',
    createBtnInHeader: 'Mobile: move create button to FAB or keep in header',
  },
} as const;
