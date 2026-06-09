/**
 * Tenants Route — 租户管理 API 端点（超级管理员专用）
 *
 * 提供完整的租户生命周期管理：
 *
 *   GET    /api/v1/tenants              — 租户列表（分页/搜索/过滤）
 *   POST   /api/v1/tenants              — 创建新租户
 *   GET    /api/v1/tenants/:id          — 租户详情
 *   PUT    /api/v1/tenants/:id          — 更新租户信息/配额
 *   DELETE /api/v1/tenants/:id          — 删除/终止租户
 *   GET    /api/v1/tenants/:id/quota    — 获取配额详情
 *   PUT    /api/v1/tenants/:id/quota    — 更新配额
 *   GET    /api/v1/tenants/:id/usage    — 用量统计
 *   GET    /api/v1/tenants/summary      — 全局摘要（管理面板概览）
 *
 * 权限要求：所有端点需要 verifyToken + SUPER_ADMIN 或 ADMIN 角色
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const tenantService = require('../services/tenantService');
const { verifyToken, requireRole, validateRequest } = require('../middleware/auth');
const { tenantContext } = require('../middleware/tenantContext');

// ============================================
// 认证与授权中间件
// ============================================

// 所有租户管理接口都需要认证 + 管理员权限
router.use(verifyToken);
router.use(requireRole('ADMIN'));

// ============================================
// GET /api/v1/tenants — 租户列表
// ============================================
router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(['active', 'suspended', 'terminated']),
  query('plan').optional().isIn(['basic', 'professional', 'enterprise']),
  query('search').optional().trim().isLength({ max: 100 }).escape(),
], validateRequest, async (req, res) => {
  try {
    const result = await tenantService.getAllTenants({
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
      plan: req.query.plan,
      search: req.query.search,
    });

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: result.count,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: Math.ceil(result.count / result.pageSize),
      },
    });
  } catch (error) {
    console.error('[Tenants] List error:', error.message);
    res.status(500).json({
      success: false,
      error: 'FETCH_TENANTS_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// POST /api/v1/tenants — 创建租户
// ============================================
router.post('/', [
  body('name').trim().isLength({ min: 2, max: 100 })
    .withMessage('租户名称长度需在 2-100 个字符之间'),
  body('slug').trim().isLength({ min: 2, max: 100 })
    .matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .withMessage('Slug 格式无效，只允许小写字母、数字、连字符'),
  body('plan').optional().isIn(['basic', 'professional', 'enterprise'])
    .withMessage('无效的套餐计划'),
  body('domain').optional().trim().isLength({ max: 255 }).isURL()
    .withMessage('域名格式无效'),
], validateRequest, async (req, res) => {
  try {
    // 验证 slug 唯一性（额外检查）
    if (!tenantService.isValidSlug(req.body.slug)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_SLUG',
        message: 'Slug 格式无效',
      });
    }

    const tenant = await tenantService.createTenant({
      name: req.body.name,
      slug: req.body.slug,
      plan: req.body.plan || 'basic',
      domain: req.body.domain || null,
    });

    res.status(201).json({
      success: true,
      data: tenant,
      message: `租户 "${tenant.name}" 创建成功`,
    });
  } catch (error) {
    if (error.code === 'TENANT_SLUG_CONFLICT') {
      return res.status(409).json({
        success: false,
        error: error.code,
        message: error.message,
      });
    }
    console.error('[Tenants] Create error:', error.message);
    res.status(400).json({
      success: false,
      error: 'CREATE_TENANT_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// GET /api/v1/tenants/summary — 全局摘要
// ============================================
router.get('/summary', async (req, res) => {
  try {
    const summary = await tenantService.getGlobalSummary();

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('[Tenants] Summary error:', error.message);
    res.status(500).json({
      success: false,
      error: 'FETCH_SUMMARY_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// GET /api/v1/tenants/:id — 租户详情
// ============================================
router.get('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
], validateRequest, async (req, res) => {
  try {
    const tenant = await tenantService.getTenantById(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: `ID 为 ${req.params.id} 的租户不存在`,
      });
    }

    res.json({
      success: true,
      data: tenant,
    });
  } catch (error) {
    console.error('[Tenants] Get error:', error.message);
    res.status(500).json({
      success: false,
      error: 'GET_TENANT_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// PUT /api/v1/tenants/:id — 更新租户
// ============================================
router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('domain').optional().trim().isLength({ max: 255 }),
  body('plan').optional().isIn(['basic', 'professional', 'enterprise']),
  body('status').optional().isIn(['active', 'suspended', 'terminated']),
], validateRequest, async (req, res) => {
  try {
    const updated = await tenantService.updateTenant(req.params.id, req.body);

    res.json({
      success: true,
      data: updated,
      message: '租户更新成功',
    });
  } catch (error) {
    if (error.code === 'TENANT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: error.code,
        message: error.message,
      });
    }
    console.error('[Tenants] Update error:', error.message);
    res.status(400).json({
      success: false,
      error: 'UPDATE_TENANT_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// DELETE /api/v1/tenants/:id — 终止租户
// ============================================
router.delete('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
], validateRequest, async (req, res) => {
  try {
    await tenantService.deleteTenant(req.params.id);

    res.json({
      success: true,
      message: '租户已终止',
    });
  } catch (error) {
    if (error.code === 'TENANT_DELETE_FORBIDDEN') {
      return res.status(403).json({
        success: false,
        error: error.code,
        message: error.message,
      });
    }
    if (error.code === 'TENANT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: error.code,
        message: error.message,
      });
    }
    console.error('[Tenants] Delete error:', error.message);
    res.status(400).json({
      success: false,
      error: 'DELETE_TENANT_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// GET /api/v1/tenants/:id/quota — 配额详情
// ============================================
router.get('/:id/quota', [
  param('id').isInt({ min: 1 }).toInt(),
], validateRequest, async (req, res) => {
  try {
    const tenant = await tenantService.getTenantById(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: '租户不存在',
      });
    }

    // 并行获取当前用量
    const usage = await tenantService.getUsageStats(req.params.id);

    res.json({
      success: true,
      data: {
        quota: tenant.quota || {},
        usage,
      },
    });
  } catch (error) {
    console.error('[Tenants] Quota get error:', error.message);
    res.status(500).json({
      success: false,
      error: 'FETCH_QUOTA_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// PUT /api/v1/tenants/:id/quota — 更新配额
// ============================================
router.put('/:id/quota', [
  param('id').isInt({ min: 1 }).toInt(),
  body('maxUsers').optional().isInt({ min: 1 }),
  body('maxClients').optional().isInt({ min: 1 }),
  body('maxEmailAccounts').optional().isInt({ min: 1 }),
  body('maxEmailsPerDay').optional().isInt({ min: 1 }),
  body('maxEmailsPerMonth').optional().isInt({ min: 1 }),
  body('maxActiveCampaigns').optional().isInt({ min: 1 }),
  body('maxStorageMB').optional().isInt({ min: 1 }),
  body('apiRateLimit').optional().isInt({ min: 1 }),
  body('features').optional().isObject(),
], validateRequest, async (req, res) => {
  try {
    const updatedQuota = await tenantService.updateQuota(req.params.id, req.body);

    res.json({
      success: true,
      data: updatedQuota,
      message: '配额更新成功',
    });
  } catch (error) {
    console.error('[Tenants] Quota update error:', error.message);
    res.status(400).json({
      success: false,
      error: 'UPDATE_QUOTA_FAILED',
      message: error.message,
    });
  }
});

// ============================================
// GET /api/v1/tenants/:id/usage — 用量统计
// ============================================
router.get('/:id/usage', [
  param('id').isInt({ min: 1 }).toInt(),
  query('refresh').optional().isBoolean().toBoolean(),
], validateRequest, async (req, res) => {
  try {
    const usage = await tenantService.getUsageStats(
      req.params.id,
      req.query.refresh === true
    );

    res.json({
      success: true,
      data: usage,
    });
  } catch (error) {
    console.error('[Tenants] Usage error:', error.message);
    res.status(500).json({
      success: false,
      error: 'FETCH_USAGE_FAILED',
      message: error.message,
    });
  }
});

module.exports = router;
