/**
 * Login page i18n texts (zh-CN)
 * DEBT-014: Extracted from Login.tsx hardcoded strings
 * To add English: create login.en.ts and switch based on locale
 */
export const loginTexts = {
  // SSO Provider display names
  sso: {
    wecom: '企业微信',
    dingtalk: '钉钉',
    // SSO messages
    loadFailWarn: '[Login] SSO providers 加载失败，将仅显示本地登录',
    loginFailPrefix: 'SSO 登录失败: ',
    unknownError: '未知错误',
    redirectFail: (name: string) => `跳转 ${name} 登录失败`,
    divider: '或使用以下方式登录',
    loginWith: (name: string) => `使用 ${name} 登录`,
  },
  // Form
  form: {
    loginBtn: '登录系统',
    loginFailMsg: '登录失败，请检查邮箱和密码',
  },
  // Branding (left panel)
  brand: {
    tagline1: '企业级智能邮件营销平台',
    tagline2: '多渠道触达 · 精准投放 · 数据驱动',
    deliveryRate: '送达率',
    mailPlatforms: '邮件平台',
    securityAuth: '安全认证',
  },
  // Mobile branding
  mobile: {
    subtitle: '企业级邮件营销平台',
  },
  // Security badge
  security: {
    badgeText: '采用 JWT Dual-Token 安全认证，数据传输全程加密保护',
  },
} as const;
