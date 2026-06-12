/**
 * Campaign Delivery (Deliverability) Routes — S152 Engine B
 *
 * 集成Campaign发送前的域名投递性检查（SPF/DKIM/DMARC）
 *
 * Endpoints:
 *   GET    /api/v1/campaign-delivery/check/:campaignId  — 发送前检查
 *   POST   /api/v1/campaign-delivery/domain-score       — 单域名评分
 *   POST   /api/v1/campaign-delivery/batch-check         — 批量域名检查
 *   GET    /api/v1/campaign-delivery/recommendations/:grade — 获取改进建议
 *
 * @openapi
 * @tags Campaign Delivery
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const campaignDeliverabilityBridge = require('../services/campaignDeliverabilityBridge');
const { verifyToken, validateRequest } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const db = require('../db');

router.use(verifyToken);

// ============================================
// GET /api/v1/campaign-delivery/check/:campaignId
// 发送前投递性检查
// ============================================
/**
 * @openapi
 * /campaign-delivery/check/{campaignId}:
 *   get:
 *     summary: Campaign发送前投递性检查
 *     tags: [Campaign Delivery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: 投递性检查结果
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DeliverabilityCheckResult'
 */
router.get('/check/:campaignId', [
  param('campaignId').isUUID().withMessage('Invalid campaign ID'),
], validateRequest, asyncHandler(async (req, res) => {
  const result = await campaignDeliverabilityBridge.checkBeforeSend(req.params.campaignId, { db });

  res.json({
    success: true,
    data: result,
    checkedAt: new Date().toISOString(),
  });
}));

// ============================================
// POST /api/v1/campaign-delivery/domain-score
// 单域名投递性评分
// ============================================
/**
 * @openapi
 * /campaign-delivery/domain-score:
 *   post:
 *     summary: 获取单域名投递性评分
 *     tags: [Campaign Delivery]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - domain
 *             properties:
 *               domain:
 *                 type: string
 *                 example: example.com
 *     responses:
 *       200:
 *         description: 域名评分结果
 */
router.post('/domain-score', [
  body('domain').trim().notEmpty().isFQDN().withMessage('Valid domain name required'),
], validateRequest, asyncHandler(async (req, res) => {
  const result = await campaignDeliverabilityBridge.getDomainScore(req.body.domain);

  res.json({
    success: true,
    data: result,
  });
}));

// ============================================
// POST /api/v1/campaign-delivery/batch-check
// 批量域名检查
// ============================================
/**
 * @openapi
 * /campaign-delivery/batch-check:
 *   post:
 *     summary: 批量检查多个域名投递性
 *     tags: [Campaign Delivery]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - domains
 *             properties:
 *               domains:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["example.com", "mail.example.com"]
 *     responses:
 *       200:
 *         description: 批量检查结果
 */
router.post('/batch-check', [
  body('domains').isArray({ min: 1 }).withMessage('Domains must be a non-empty array'),
  body('domains.*').trim().notEmpty().withMessage('Each domain must be non-empty'),
], validateRequest, asyncHandler(async (req, res) => {
  const results = await campaignDeliverabilityBridge.batchCheck(req.body.domains);

  res.json({
    success: true,
    data: results,
    total: results.length,
  });
}));

// ============================================
// GET /api/v1/campaign-delivery/recommendations/:grade
// 获取指定等级的改进建议
// ============================================
/**
 * @openapi
 * /campaign-delivery/recommendations/{grade}:
 *   get:
 *     summary: 获取投递性等级的改进建议
 *     tags: [Campaign Delivery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: grade
 *         required: true
 *         schema:
 *           type: string
 *           enum: [A, B, C, D, F]
 *     responses:
 *       200:
 *         description: 改进建议列表
 */
router.get('/recommendations/:grade', [
  param('grade').isIn(['A', 'B', 'C', 'D', 'F']).withMessage('Invalid grade. Must be A, B, C, D, or F'),
], validateRequest, asyncHandler(async (req, res) => {
  const recommendations = campaignDeliverabilityBridge.getRecommendations(req.params.grade);

  res.json({
    success: true,
    data: {
      grade: req.params.grade.toUpperCase(),
      recommendations,
    },
  });
}));

module.exports = router;
