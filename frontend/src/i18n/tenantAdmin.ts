/**
 * TenantAdmin page i18n texts (zh-CN)
 * DEBT-014: Extracted from TenantAdmin.tsx hardcoded strings
 * To add English: create tenantAdmin.en.ts and switch based on locale
 */
export const tenantAdminTexts = {
  // Plan labels
  plans: {
    basic: '基础版',
    professional: '专业版',
    enterprise: '企业版',
  },
  // Status labels
  statuses: {
    active: '正常',
    suspended: '已暂停',
    terminated: '已终止',
  },
  // Form: Create/Edit Tenant
  form: {
    createTitle: '创建新租户',
    editTitlePrefix: '编辑租户: ',
    saveBtn: '保存',
    createBtn: '创建',
    cancelBtn: '取消',
    name: {
      label: '租户名称',
      placeholder: '例如：Acme Corporation',
      requiredMsg: '请输入租户名称',
      lengthMsg: '长度 2-100 个字符',
    },
    slug: {
      label: '标识符 (Slug)',
      placeholder: '例如：acme-corp',
      requiredMsg: '请输入标识符',
      patternMsg: '只允许小写字母、数字、连字符',
    },
    domain: {
      label: '自定义域名（可选）',
      placeholder: '例如：acme.example.com',
    },
    plan: {
      label: '套餐计划',
      requiredMsg: '请选择套餐',
      placeholder: '选择套餐',
    },
    status: {
      label: '状态',
      requiredMsg: '请选择状态',
      placeholder: '选择状态',
    },
  },
  // Messages
  messages: {
    updateSuccess: '租户更新成功',
    createSuccess: '租户创建成功',
    operationFailed: '操作失败',
    fetchFailed: '获取租户列表失败',
    quotaUpdateSuccess: '配额更新成功',
    quotaUpdateFailed: '操作失败',
    terminateSuccess: '租户已终止',
    deleteFailed: '删除失败',
  },
  // Quota Modal
  quota: {
    titlePrefix: '配额管理 - ',
    usageOverview: '用量概览',
    usersCount: '用户数',
    clientsCount: '客户数',
    accountsCount: '邮箱账号',
    campaignsActive: '活跃活动',
    emailsThisMonth: '本月邮件',
    dailyLimit: '每日限额',
    dailyLimitSuffix: '/ 天',
    dailyLimitDesc: '每日发送量上限',
    editLabel: '修改配额',
    maxUsers: '最大用户数',
    maxClients: '最大客户数',
    maxEmailAccounts: '最大邮箱账号',
    maxEmailsPerDay: '每日发送上限',
    maxEmailsPerMonth: '每月发送上限',
    maxActiveCampaigns: '最大活动数',
    maxStorageMB: '存储空间 (MB)',
    apiRateLimit: 'API 速率限制 (请求/分)',
    featureDivider: '功能开关',
    saveBtn: '保存配额设置',
    customDomain: '自定义域名',
    webhook: 'Webhook 集成',
    analytics: '高级分析',
    export: '数据导出',
    sso: '单点登录 (SSO)',
    switchOn: '开启',
    switchOff: '关闭',
  },
  // Table columns
  table: {
    id: 'ID',
    tenantName: '租户名称',
    slug: '标识符',
    plan: '套餐',
    status: '状态',
    domain: '域名',
    createdAt: '创建时间',
    actions: '操作',
    tooltipEdit: '查看/编辑',
    tooltipQuota: '配额管理',
    terminateConfirm: (name: string) => `确定要终止租户 "${name}" 吗？`,
    terminateDesc: '此操作不可撤销，该租户的所有服务将被停止。',
    terminateOk: '确认终止',
    terminateCancel: '取消',
    tooltipTerminate: '终止租户',
  },
  // Page header
  page: {
    title: '多租户管理',
    refreshBtn: '刷新',
    createTenantBtn: '创建租户',
    totalTenants: '总租户数',
    activeTenants: '活跃租户',
    totalUsers: '总用户数',
    totalClients: '总客户数',
  },
  // Pagination
  pagination: {
    totalSuffix: '个租户',
  },
} as const;
