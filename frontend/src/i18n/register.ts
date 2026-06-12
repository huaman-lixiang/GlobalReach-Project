/**
 * Register page i18n texts (zh-CN)
 * DEBT-014: Extracted from Register.tsx hardcoded strings
 * To add English: create register.en.ts and switch based on locale
 */
export const registerTexts = {
  // Messages
  messages: {
    passwordMismatch: 'Passwords do not match',
    registerSuccess: 'Registration successful! Welcome to GlobalReach',
    registerFailed: 'Registration failed, please try again later',
  },
  // Branding (left panel)
  brand: {
    title: 'Create Account',
    tagline1: 'Join GlobalReach Enterprise Email Marketing Platform',
    tagline2: 'Start your intelligent email marketing journey',
    featureMultiPlatform: 'Multi-Platform Support',
    featureRealtimeAnalytics: 'Real-Time Data Analytics',
    featureSecureEncryption: 'Secure Encrypted Transmission',
  },
  // Mobile branding
  mobile: {
    title: 'Create Account',
    subtitle: 'Join GlobalReach',
  },
  // Form section
  form: {
    title: 'Register New Account',
    subtitle: 'Fill in the information below to create your enterprise account',
    nameLabel: 'Name',
    nameRequired: 'Please enter your name',
    nameMinLength: 'Name must be at least 2 characters',
    namePlaceholder: 'Enter your full name',
    emailLabel: 'Email Address',
    emailRequired: 'Please enter email address',
    emailInvalid: 'Please enter a valid email address',
    emailPlaceholder: 'Enter your email address',
    passwordLabel: 'Password',
    passwordRequired: 'Please enter password',
    passwordMinLength: 'Password must be at least 8 characters',
    passwordPlaceholder: 'Set password (min 8 chars)',
    confirmPasswordLabel: 'Confirm Password',
    confirmPasswordRequired: 'Please confirm password',
    confirmPasswordPlaceholder: 'Re-enter password',
    submitBtn: 'Register Now',
  },
  // Footer link
  footer: {
    hasAccount: 'Already have an account?',
    backToLogin: 'Back to Login',
  },
  // Security badge
  security: {
    badgeText: 'Your information will be securely stored with enterprise-grade encryption standards',
  },
  // Layout comments
  layout: {
    leftPanel: 'Left Panel - Branding',
    decorativeCircles: 'Decorative circles',
    featureHighlights: 'Feature highlights',
    rightPanel: 'Right Panel - Registration Form - fullscreen on mobile',
    mobileLogo: 'Mobile Logo',
  },
} as const;
