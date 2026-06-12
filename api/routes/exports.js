const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { exportService } = require('../services/exportService');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/emails/csv', verifyToken, asyncHandler(async (req, res) => {
  const { campaignId, startDate, endDate } = req.query;
  const filters = { campaignId, startDate, endDate };
  const result = await exportService.exportEmailsCSV(req.user.id, filters);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.content);
}));

router.get('/emails/excel', verifyToken, asyncHandler(async (req, res) => {
  const { campaignId, startDate, endDate } = req.query;
  const filters = { campaignId, startDate, endDate };
  const result = await exportService.exportEmailsExcel(req.user.id, filters);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.content);
}));

router.get('/campaigns/csv', verifyToken, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filters = { status };
  const result = await exportService.exportCampaignsCSV(req.user.id, filters);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.content);
}));

router.get('/analytics/pdf', verifyToken, asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const filters = { startDate, endDate };
  const result = await exportService.exportAnalyticsPDF(req.user.id, filters);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.content);
}));

module.exports = router;