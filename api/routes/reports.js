/**
 * Reports Route — PDF Report Generation & Email Delivery (S152)
 *
 * Endpoints:
 *   POST   /api/v1/reports/generate              — 生成PDF报告
 *   GET    /api/v1/reports                       — 列出所有报告
 *   GET    /api/v1/reports/download/:filename     — 下载报告文件
 *   POST   /api/v1/reports/email                  — 生成并通过邮件发送报告
 *   POST   /api/v1/reports/schedule               — 创建定时邮件报告
 *   GET    /api/v1/reports/schedules              — 列出定时任务（预留）
 *   DELETE /api/v1/reports/schedules/:id          — 删除定时任务（预留）
 *
 * @openapi
 * @tags Reports
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const path = require('path');

const pdfReportService = require('../services/pdfReportService');
const { verifyToken, validateRequest } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(verifyToken);

// ============================================
// POST /api/v1/reports/generate — 生成PDF报告
// ============================================
/**
 * @openapi
 * /reports/generate:
 *   post:
 *     summary: 生成PDF/HTML报告
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reportType
 *             properties:
 *               reportType:
 *                 type: string
 *                 enum: [campaign_summary, analytics_dashboard, deliverability_report, cost_optimization, custom]
 *               data:
 *                 type: object
 *                 description: 报告数据
 *               options:
 *                 type: object
 *                 properties:
 *                   brandColor:
 *                     type: string
 *                   companyName:
 *                     type: string
 *     responses:
 *       200:
 *         description: 报告生成成功
 */
router.post('/generate', [
  body('reportType').trim().notEmpty().isIn([
    'campaign_summary', 'analytics_dashboard', 'deliverability_report',
    'cost_optimization', 'custom',
  ]).withMessage('Invalid report type'),
], validateRequest, asyncHandler(async (req, res) => {
  const result = await pdfReportService.generateReport({
    reportType: req.body.reportType,
    data: req.body.data || {},
    options: req.body.options || {},
    // 注入用户信息到options
    userId: req.user.id,
  });

  res.status(201).json({
    success: true,
    data: result,
  });
}));

// ============================================
// GET /api/v1/reports — 列出所有报告
// ============================================
/**
 * @openapi
 * /reports:
 *   get:
 *     summary: 列出已生成的报告
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 报告列表
 */
router.get('/', asyncHandler(async (req, res) => {
  const reports = pdfReportService.listReports();

  res.json({
    success: true,
    data: reports,
    total: reports.length,
  });
}));

// ============================================
// GET /api/v1/reports/download/:filename — 下载报告
// ============================================
/**
 * @openapi
 * /reports/download/{filename}:
 *   get:
 *     summary: 下载报告文件
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 文件内容
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       404:
 *         description: 文件不存在
 */
router.get('/download/:filename', [
  param('filename').matches(/^report_[a-f0-9\-_]+\.html$/).withMessage('Invalid filename'),
], asyncHandler(async (req, res) => {
  const { filepath, exists } = pdfReportService.getReportPath(req.params.filename);

  if (!exists) {
    return res.status(404).json({
      success: false,
      error: 'REPORT_NOT_FOUND',
      message: 'Report file not found',
    });
  }

  res.type('html').sendFile(filepath);
}));

// ============================================
// POST /api/v1/reports/email — 生成并通过邮件发送报告
// ============================================
/**
 * @openapi
 * /reports/email:
 *   post:
 *     summary: 生成PDF报告并通过邮件发送
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipientEmails
 *             properties:
 *               reportId:
 *                 type: string
 *                 description: 已有报告ID（可选，不传则先生成）
 *               recipientEmails:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: email
 *               subject:
 *                 type: string
 *               message:
 *                 type: string
 *               reportType:
 *                 type: string
 *                 enum: [campaign_summary, analytics_dashboard, deliverability_report, cost_optimization]
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: 邮件发送任务已创建
 */
router.post('/email', [
  body('recipientEmails').isArray({ min: 1 }).withMessage('At least one recipient email is required'),
  body('recipientEmails.*').isEmail().withMessage('Invalid email format'),
], validateRequest, asyncHandler(async (req, res) => {
  let reportId = req.body.reportId;

  // 如果没有提供reportId，先生成报告
  if (!reportId && req.body.reportType) {
    const generated = await pdfReportService.generateReport({
      reportType: req.body.reportType,
      data: req.body.data || {},
      options: req.body.options || {},
      userId: req.user.id,
    });
    reportId = generated.reportId;
  }

  if (!reportId) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_REPORT_ID_OR_TYPE',
      message: 'Either reportId or reportType is required',
    });
  }

  const result = await pdfReportService.generateAndEmail(
    reportId,
    req.body.recipientEmails,
    {
      subject: req.body.subject,
      message: req.body.message,
      userId: req.user.id,
    }
  );

  res.json({
    success: true,
    data: result,
  });
}));

// ============================================
// POST /api/v1/reports/schedule — 创建定时邮件报告
// ============================================
/**
 * @openapi
 * /reports/schedule:
 *   post:
 *     summary: 创建定时邮件报告调度
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reportType
 *               - recipients
 *               - cronExpression
 *             properties:
 *               reportType:
 *                 type: string
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: email
 *               cronExpression:
 *                 type: string
 *                 example: "0 9 * * 1"
 *                 description: Cron表达式
 *               name:
 *                 type: string
 *               dataFilters:
 *                 type: object
 *               enabled:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: 定时任务已创建
 */
router.post('/schedule', [
  body('reportType').trim().notEmpty().withMessage('reportType is required'),
  body('recipients').isArray({ min: 1 }).withMessage('Recipients are required'),
  body('cronExpression').trim().notEmpty().withMessage('cronExpression is required'),
], validateRequest, asyncHandler(async (req, res) => {
  const result = await pdfReportService.scheduleEmailReport({
    ...req.body,
    createdBy: req.user.id,
  });

  res.status(201).json(result);
}));

module.exports = router;
