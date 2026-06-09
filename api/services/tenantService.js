/**
 * Tenant Service — 租户服务层
 *
 * 提供 CRUD 操作、配额管理、用量统计等核心功能。
 * 所有操作均通过 Sequelize ORM 与 PostgreSQL 交互，
 * 并支持 Redis 缓存层加速高频读取。
 *
 * 主要功能：
 *   - 租户 CRUD（创建/读取/更新/删除/列表）
 *   - 配额管理与超限检查
 *   - 用量统计（实时 + 缓存）
 *   - 租户生命周期管理（激活/暂停/终止）
 */

const db = require('../db');
const { Op } = db.Sequelize;

// ============================================
// 常量定义
// ============================================

// 默认配额模板（按套餐类型）
const DEFAULT_QUOTAS = {
  basic: {
    maxUsers: 5,
    maxClients: 1000,
    maxEmailAccounts: 3,
    maxEmailsPerDay: 500,
    maxEmailsPerMonth: 10000,
    maxActiveCampaigns: 5,
    maxStorageMB: 500,
    apiRateLimit: 60,
    features: {
      customDomain: false,
      webhook: false,
      analytics: false,
      export: true,
      sso: false,
    },
  },
  professional: {
    maxUsers: 20,
    maxClients: 10000,
    maxEmailAccounts: 10,
    maxEmailsPerDay: 2000,
    maxEmailsPerMonth: 100000,
    maxActiveCampaigns: 20,
    maxStorageMB: 5000,
    apiRateLimit: 120,
    features: {
      customDomain: true,
      webhook: true,
      analytics: true,
      export: true,
      sso: false,
    },
  },
  enterprise: {
    maxUsers: 100,
    maxClients: 100000,
    maxEmailAccounts: 50,
    maxEmailsPerDay: 10000,
    maxEmailsPerMonth: 1000000,
    maxActiveCampaigns: 100,
    maxStorageMB: 50000,
    apiRateLimit: 300,
    features: {
      customDomain: true,
      webhook: true,
      analytics: true,
      export: true,
      sso: true,
    },
  },
};

// ============================================
// CRUD 操作
// ============================================

/**
 * 获取所有租户列表（分页，管理员专用）
 * @param {Object} options - 查询选项
 * @param {number} options.page - 页码（从1开始）
 * @param {number} options.pageSize - 每页条数
 * @param {string} options.status - 按状态过滤
 * @param {string} options.plan - 按套餐过滤
 * @param {string} options.search - 搜索关键词（匹配name/slug）
 * @returns {Promise<{rows: Object[], count: number}>}
 */
async function getAllTenants(options = {}) {
  const page = parseInt(options.page, 10) || 1;
  const pageSize = Math.min(parseInt(options.pageSize, 10) || 20, 100); // 上限100
  const offset = (page - 1) * pageSize;

  const where = {};
  if (options.status) where.status = options.status;
  if (options.plan) where.plan = options.plan;
  if (options.search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${options.search}%` } },
      { slug: { [Op.iLike]: `%${options.search}%` } },
    ];
  }

  const { count, rows } = await db.Tenant.findAndCountAll({
    where,
    limit: pageSize,
    offset,
    order: [['createdAt', 'DESC']],
    attributes: { exclude: ['settings'] }, // 列表不返回敏感配置
  });

  return { rows, count, page, pageSize };
}

/**
 * 根据 ID 获取单个租户详情
 * @param {number} tenantId
 * @returns {Promise<Object|null>}
 */
async function getTenantById(tenantId) {
  const tenant = await db.Tenant.findByPk(tenantId);
  return tenant ? tenant.toJSON() : null;
}

/**
 * 根据 Slug 获取租户（用于域名路由解析）
 * @param {string} slug
 * @returns {Promise<Object|null>}
 */
async function getTenantBySlug(slug) {
  const tenant = await db.Tenant.findOne({ where: { slug } });
  return tenant ? tenant.toJSON() : null;
}

/**
 * 创建新租户
 * @param {Object} data - 租户数据
 * @param {string} data.name - 租户名称
 * @param {string} data.slug - 唯一标识符
 * @param {string} [data.plan='basic'] - 套餐计划
 * @param {string} [data.domain] - 自定义域名
 * @param {Object} [data.quota] - 自定义配额（覆盖默认值）
 * @returns {Promise<Object>} 创建的租户对象
 */
async function createTenant(data) {
  const { name, slug, plan = 'basic', domain, quota } = data;

  // 检查 slug 唯一性
  const existing = await db.Tenant.findOne({ where: { slug } });
  if (existing) {
    throw Object.assign(new Error(`Tenant with slug "${slug}" already exists`), {
      code: 'TENANT_SLUG_CONFLICT',
      statusCode: 409,
    });
  }

  // 合并默认配额与自定义配额
  const mergedQuota = {
    ...DEFAULT_QUOTAS[plan || 'basic'],
    ...(quota || {}),
  };

  const tenant = await db.Tenant.create({
    name,
    slug,
    plan,
    domain: domain || null,
    quota: mergedQuota,
    status: 'active',
  });

  console.log(`[TenantService] Created tenant: ${name} (${tenant.id})`);

  return tenant.toJSON();
}

/**
 * 更新租户信息
 * @param {number} tenantId
 * @param {Object} updateData - 要更新的字段
 * @returns {Promise<Object>} 更新后的租户对象
 */
async function updateTenant(tenantId, updateData) {
  const tenant = await db.Tenant.findByPk(tenantId);
  if (!tenant) {
    throw Object.assign(new Error(`Tenant ${tenantId} not found`), {
      code: 'TENANT_NOT_FOUND',
      statusCode: 404,
    });
  }

  // 允许更新的字段白名单
  const allowedFields = ['name', 'domain', 'status', 'settings'];
  const safeUpdate = {};

  for (const field of allowedFields) {
    if (updateData[field] !== undefined) {
      safeUpdate[field] = updateData[field];
    }
  }

  // 套餐变更时更新默认配额
  if (updateData.plan && updateData.plan !== tenant.plan) {
    safeUpdate.plan = updateData.plan;
    safeUpdate.quota = {
      ...DEFAULT_QUOTAS[updateData.plan],
      ...(tenant.quota || {}), // 保留已有的自定义覆盖值
    };
  }

  // 自定义配额合并（深层合并）
  if (updateData.quota) {
    safeUpdate.quota = {
      ...(safeUpdate.quota || tenant.quota || {}),
      ...updateData.quota,
      features: {
        ...(safeUpdate.quota?.features || tenant.quota?.features || {}),
        ...(updateData.quota.features || {}),
      },
    };
  }

  await tenant.update(safeUpdate);

  // 清除缓存（下次查询会重新加载）
  await invalidateCache(tenantId);

  console.log(`[TenantService] Updated tenant ${tenantId}`);

  return tenant.toJSON();
}

/**
 * 删除租户（软删除 → 设置 status=terminated）
 * @param {number} tenantId
 * @returns {Promise<void>}
 * @throws 不允许删除默认租户
 */
async function deleteTenant(tenantId) {
  if (tenantId === 1) {
    throw Object.assign(new Error('Cannot delete the default tenant'), {
      code: 'TENANT_DELETE_FORBIDDEN',
      statusCode: 403,
    });
  }

  const tenant = await db.Tenant.findByPk(tenantId);
  if (!tenant) {
    throw Object.assign(new Error(`Tenant ${tenantId} not found`), {
      code: 'TENANT_NOT_FOUND',
      statusCode: 404,
    });
  }

  // 软删除：标记为 terminated
  await tenant.update({ status: 'terminated' });

  await invalidateCache(tenantId);

  console.log(`[TenantService] Terminated tenant ${tenantId} (${tenant.name})`);
}

// ============================================
// 配额管理
// ============================================

/**
 * 检查资源是否超出配额
 * @param {number} tenantId - 租户 ID
 * @param {string} resource - 资源类型 ('users'|'clients'|'emailAccounts'|'emails')
 * @param {number} [increment=1] - 即将增加的数量
 * @returns {Promise<{allowed: boolean, current: number, limit: number, remaining: number}>}
 */
async function checkQuota(tenantId, resource, increment = 1) {
  const tenant = await db.Tenant.findByPk(tenantId, { attributes: ['id', 'quota'] });
  if (!tenant) {
    return { allowed: false, current: 0, limit: 0, remaining: 0 };
  }

  const quota = tenant.quota || {};
  const usage = await getUsageStats(tenantId);

  const limits = {
    users: quota.maxUsers || Infinity,
    clients: quota.maxClients || Infinity,
    emailAccounts: quota.maxEmailAccounts || Infinity,
    emails: quota.maxEmailsPerMonth || Infinity,
  };

  const current = usage[`${resource}Count`] || 0;
  const limit = limits[resource] || Infinity;

  return {
    allowed: current + increment <= limit,
    current,
    limit: limit === Infinity ? -1 : limit,
    remaining: Math.max(0, limit - current),
  };
}

/**
 * 更新租户配额
 * @param {number} tenantId
 * @param {Object} newQuota - 新配额（部分更新，未提供的字段保持不变）
 * @returns {Promise<Object>} 更新后的完整配额
 */
async function updateQuota(tenantId, newQuota) {
  const tenant = await db.Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  const currentQuota = tenant.quota || {};

  // 深层合并配额
  const mergedQuota = {
    ...currentQuota,
    ...newQuota,
    features: {
      ...(currentQuota.features || {}),
      ...(newQuota.features || {}),
    },
  };

  await tenant.update({ quota: mergedQuota });
  await invalidateCache(tenantId);

  return mergedQuota;
}

// ============================================
// 用量统计
// ============================================

/**
 * 获取租户用量统计（带 Redis 缓存）
 * @param {number} tenantId
 * @param {boolean} [forceRefresh=false] - 强制刷新缓存
 * @returns {Promise<Object>} 用量数据
 */
async function getUsageStats(tenantId, forceRefresh = false) {
  const cacheKey = `tenant:${tenantId}:usage`;

  // 尝试从缓存获取
  if (!forceRefresh) {
    const cacheService = global.cacheService; // 通过全局引用访问
    if (cacheService) {
      try {
        const cached = await cacheService.get(cacheKey);
        if (cached) {
          return typeof cached === 'string' ? JSON.parse(cached) : cached;
        }
      } catch (_) {
        // 缓存读取失败，继续走 DB 查询
      }
    }
  }

  // 计算本月起始时间
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // 并行查询各资源的用量
  const [
    usersCount,
    clientsCount,
    accountsCount,
    campaignsActive,
    emailsThisMonth,
  ] = await Promise.all([
    db.User.count({ where: { tenantId } }),
    db.Client.count({ where: { tenantId } }),
    db.EmailAccount.count({ where: { tenantId } }),
    db.Campaign.count({
      where: {
        tenantId,
        status: { [Op.in]: ['DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED'] },
      },
    }),
    db.Email.count({
      where: {
        tenantId,
        status: 'SENT',
        sentAt: { [Op.gte]: startOfMonth },
      },
    }),
  ]);

  const stats = {
    usersCount,
    clientsCount,
    accountsCount,
    campaignsActive,
    emailsThisMonth,
    calculatedAt: now.toISOString(),
  };

  // 写入缓存（TTL: 1小时）
  const cacheService = global.cacheService;
  if (cacheService) {
    try {
      await cacheService.setex(cacheKey, 3600, JSON.stringify(stats));
    } catch (_) {
      // 缓存写入失败不影响主流程
    }
  }

  return stats;
}

/**
 * 获取所有租户的全局摘要（管理面板概览）
 * @returns {Promise<Object>}
 */
async function getGlobalSummary() {
  const [
    totalTenants,
    activeTenants,
    totalUsers,
    totalClients,
    totalEmailsSent,
  ] = await Promise.all([
    db.Tenant.count(),
    db.Tenant.count({ where: { status: 'active' } }),
    db.User.count(),
    db.Client.count(),
    db.Email.count({ where: { status: 'SENT' } }),
  ]);

  return {
    totalTenants,
    activeTenants,
    totalUsers,
    totalClients,
    totalEmailsSent,
    timestamp: new Date().toISOString(),
  };
}

// ============================================
// 辅助函数
// ============================================

/**
 * 清除租户相关缓存
 * @param {number} tenantId
 */
async function invalidateCache(tenantId) {
  const cacheService = global.cacheService;
  if (!cacheService) return;

  try {
    // 清除租户基本信息缓存和用量缓存
    await Promise.all([
      cacheService.del(`tenant:${tenantId}:info`),
      cacheService.del(`tenant:${tenantId}:usage`),
    ]);
  } catch (_) {
    // 缓存清除失败不影响主流程
  }
}

/**
 * 获取默认配额模板（用于前端展示）
 * @param {string} [plan] - 套餐类型，不传则返回全部
 * @returns {Object}
 */
function getDefaultQuotas(plan) {
  if (plan) return DEFAULT_QUOTAS[plan] || DEFAULT_QUOTAS.basic;
  return DEFAULT_QUOTAS;
}

/**
 * 验证 slug 格式（只允许字母、数字、连字符）
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length >= 2 && slug.length <= 100;
}

module.exports = {
  // CRUD
  getAllTenants,
  getTenantById,
  getTenantBySlug,
  createTenant,
  updateTenant,
  deleteTenant,

  // 配额
  checkQuota,
  updateQuota,

  // 统计
  getUsageStats,
  getGlobalSummary,

  // 工具
  getDefaultQuotas,
  isValidSlug,
  invalidateCache,
  DEFAULT_QUOTAS,
};
