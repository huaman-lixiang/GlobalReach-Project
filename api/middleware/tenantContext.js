/**
 * Tenant Context 中间件 — 多租户请求上下文注入
 *
 * 从请求中提取租户标识，为后续处理链提供 req.tenant 上下文：
 *
 * 提取优先级（从高到低）：
 *   1. X-Tenant-ID 请求头 — 内部服务间调用使用
 *   2. JWT Payload 中的 tenantId 字段 — 标准认证流程
 *   3. 默认值 1 — 向后兼容（默认租户）
 *
 * 注入内容：
 *   req.tenant = { id, plan, status, quota }
 *   为 Sequelize 模型设置运行时 defaultScope 的 where 条件
 *
 * 使用方式：
 *   router.use(verifyToken);       // 先认证
 *   router.use(tenantContext);     // 再提取租户上下文
 */

const db = require('../db');

// 默认租户 ID（向后兼容：所有已有数据归属此租户）
const DEFAULT_TENANT_ID = 1;

/**
 * 从请求中提取租户 ID
 * @param {Express.Request} req
 * @returns {number} 租户 ID
 */
function extractTenantId(req) {
  // 优先级 1: X-Tenant-ID Header（内部服务调用 / 管理员切换视图）
  if (req.headers['x-tenant-id']) {
    const headerId = parseInt(req.headers['x-tenant-id'], 10);
    if (!isNaN(headerId) && headerId > 0) {
      return headerId;
    }
  }

  // 优先级 2: JWT Payload 中的 tenantId 字段
  if (req.user && req.user.tenantId) {
    const jwtTenantId = parseInt(req.user.tenantId, 10);
    if (!isNaN(jwtTenantId) && jwtTenantId > 0) {
      return jwtTenantId;
    }
  }

  // 优先级 3: 向后兼容默认值
  return DEFAULT_TENANT_ID;
}

/**
 * 租户上下文中间件
 *
 * 执行逻辑：
 *   1. 提取 tenant_id
 *   2. 查询租户信息（带缓存优化）
 *   3. 将租户信息挂载到 req.tenant
 *   4. 验证租户状态（非 active 则拒绝）
 */
async function tenantContext(req, res, next) {
  try {
    const tenantId = extractTenantId(req);

    // 查询租户信息（优先从缓存获取）
    let tenant;
    if (req.app.get('cacheService')) {
      const cacheKey = `tenant:${tenantId}:info`;
      const cached = await req.app.get('cacheService').get(cacheKey);
      if (cached) {
        tenant = typeof cached === 'string' ? JSON.parse(cached) : cached;
      }
    }

    if (!tenant) {
      tenant = await db.Tenant.findByPk(tenantId, {
        attributes: ['id', 'name', 'slug', 'plan', 'quota', 'status'],
      });

      if (!tenant) {
        // 租户不存在时，对于默认租户 ID 自动降级处理
        if (tenantId === DEFAULT_TENANT_ID) {
          console.warn(`[TenantContext] Default tenant (id=${DEFAULT_TENANT_ID}) not found in DB, using fallback`);
          req.tenant = {
            id: DEFAULT_TENANT_ID,
            name: 'Default Tenant',
            slug: 'default',
            plan: 'enterprise',
            status: 'active',
            quota: {},
          };
          return next();
        }

        return res.status(404).json({
          success: false,
          error: 'TENANT_NOT_FOUND',
          message: `Tenant with ID ${tenantId} does not exist`,
          code: 'TENANT_001',
        });
      }

      tenant = tenant.toJSON();

      // 写入缓存（5分钟 TTL）
      if (req.app.get('cacheService')) {
        try {
          await req.app.get('cacheService').setex(
            `tenant:${tenantId}:info`,
            300,
            JSON.stringify(tenant)
          );
        } catch (_) {
          // 缓存写入失败不影响主流程
        }
      }
    }

    // 检查租户状态
    if (tenant.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'TENANT_SUSPENDED',
        message: `Tenant "${tenant.name}" is currently ${tenant.status}`,
        code: 'TENANT_002',
      });
    }

    // 将租户上下文挂载到请求对象
    req.tenant = tenant;

    next();
  } catch (error) {
    console.error('[TenantContext] Error:', error.message);
    // 中间件故障时不阻塞请求（降级到默认租户）
    req.tenant = {
      id: DEFAULT_TENANT_ID,
      name: 'Default Tenant (fallback)',
      slug: 'default',
      plan: 'enterprise',
      status: 'active',
      quota: {},
    };
    next();
  }
}

/**
 * 为 Sequelize 模型动态添加 tenant_id 过滤条件
 *
 * 在业务 handler 中调用，将当前租户 ID 注入查询条件：
 *
 * @param {Sequelize.Model} Model - Sequelize 模型类
 * @param {number} tenantId - 租户 ID
 * @param {Object} queryOptions - 原始查询选项
 * @returns {Object} 增强后的查询选项（包含 tenant_id WHERE 条件）
 */
function applyTenantScope(Model, tenantId, queryOptions = {}) {
  // 如果已经是 unscoped() 调用，则不重复添加
  if (queryOptions._unscoped) {
    return queryOptions;
  }

  // 合并 where 条件（保留原有条件）
  const enhancedOptions = { ...queryOptions };
  enhancedOptions.where = {
    ...enhancedOptions.where,
    tenant_id: tenantId,
  };

  return enhancedOptions;
}

/**
 * 可选租户中间件 — 不强制要求认证即可使用
 * 用于公开端点或健康检查等场景
 */
async function optionalTenantContext(req, res, next) {
  try {
    const tenantId = extractTenantId(req);
    const tenant = await db.Tenant.findByPk(tenantId, {
      attributes: ['id', 'name', 'slug', 'plan', 'status'],
    });

    req.tenant = tenant ? tenant.toJSON() : {
      id: DEFAULT_TENANT_ID,
      name: 'Default Tenant',
      slug: 'default',
      plan: 'enterprise',
      status: 'active',
      quota: {},
    };

    next();
  } catch (error) {
    req.tenant = { id: DEFAULT_TENANT_ID, status: 'active' };
    next();
  }
}

module.exports = {
  tenantContext,
  optionalTenantContext,
  applyTenantScope,
  extractTenantId,
  DEFAULT_TENANT_ID,
};
