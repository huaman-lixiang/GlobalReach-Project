/**
 * Settings page i18n texts (zh-CN)
 * DEBT-014: Extracted from Settings.tsx hardcoded strings
 * To add English: create settings.en.ts and switch based on locale
 */
export const settingsTexts = {
  // SSO Provider names
  ssoProvider: {
    wecom: '企业微信',
    dingtalk: '钉钉',
  },
  // Console / error messages
  messages: {
    ssoStatusFail: '[Settings] Failed to fetch SSO status:',
    unlinked: (provider: string) => `Unlinked ${provider}`,
    unlinkFailed: 'Unlink failed',
    passwordMismatch: 'Passwords do not match',
    passwordChanged: 'Password changed successfully, please log in again',
    processing: 'Processing...',
    loading: 'Loading...',
  },
  // Profile section
  profile: {
    title: 'Personal Information',
    username: 'Username',
    email: 'Email Address',
    role: 'Role',
    userId: 'User ID',
    edit: 'Edit',
    editProfile: 'Edit Profile',
    save: 'Save',
    cancel: 'Cancel',
  },
  // Security section
  security: {
    title: 'Security Settings',
    authMethod: 'Authentication Method',
    tokenExpiry: 'Token Expiry',
    passwordPolicy: 'Password Policy',
    changePassword: 'Change Password',
    accessTokenExpiry: 'Access Token Expiry',
    refreshTokenExpiry: 'Refresh Token Expiry',
    securityHeaders: 'Security Headers',
    accessControl: 'Access Control',
  },
  // System info section
  system: {
    title: 'System Information',
    apiBaseUrl: 'API Base URL',
    healthCheck: 'Health Check',
    statsOverview: 'Stats Overview',
    version: 'Version',
    backendOrm: 'Backend ORM',
    engineStatus: 'Engine Status',
    pipelineStatus: 'Pipeline Status',
  },
  // SSO section
  sso: {
    title: 'SSO Single Sign-On',
    ssoAccount: 'SSO Account',
    localAccount: 'Local Account',
    linkedAccounts: 'Linked Accounts',
    confirmUnlink: 'Confirm Unlink',
    confirmUnlinkDesc: (name: string) => `Are you sure you want to unlink ${name} account?`,
    okUnlink: 'Confirm Unlink',
    unlinkBtn: 'Unlink',
    boundTime: 'Bound at:',
    lastLogin: 'Last login:',
    availableMethods: 'Available Login Methods',
    linked: '(Linked)',
    noSsoHint: 'No SSO accounts linked yet. You can use SSO login on the login page, and the system will automatically associate it with your current account.',
  },
  // Change Password Modal
  passwordModal: {
    title: 'Change Password',
    okText: 'Confirm Change',
    cancelText: 'Cancel',
    currentPassword: 'Current Password',
    currentPasswordRequired: 'Please enter current password',
    newPassword: 'New Password',
    newPasswordRequired: 'Please enter new password',
    newPasswordMin: 'Password must be at least 8 characters',
    confirmPassword: 'Confirm New Password',
    confirmPasswordRequired: 'Please confirm new password',
    passwordMismatchErr: 'Passwords do not match',
    currentPwdPlaceholder: 'Current Password',
    newPwdPlaceholder: 'New Password (min 8 chars)',
    confirmPwdPlaceholder: 'Re-enter new password',
  },
  // Layout comments (for reference)
  layout: {
    mobileCollapseNote: 'Mobile: use Collapse panels; Desktop: keep independent Cards',
    desktopLayout: 'Desktop: original layout',
    ssoSection: 'SSO Single Sign-On binding management',
    linkedList: 'List of linked SSO identities',
    availableProviders: 'Available SSO providers (unlinked)',
  },
} as const;
