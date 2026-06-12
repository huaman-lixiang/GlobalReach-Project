const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { analyticsService } = require('../services/analyticsService');
const { asyncHandler } = require('../middleware/errorHandler');

// S152: 标准安全中间件链
router.use(rateLimiter);
router.use(verifyToken);

router.get('/overview', verifyToken, asyncHandler(async (req, res) => {
  const { startDate, endDate, campaignId } = req.query;
  const filters = { startDate, endDate, campaignId };
  const analytics = await analyticsService.getEmailAnalytics(req.user.id, filters);
  res.json({ success: true, data: analytics });
}));

router.get('/campaigns', verifyToken, asyncHandler(async (req, res) => {
  const analytics = await analyticsService.getCampaignAnalytics(req.user.id);
  res.json({ success: true, data: analytics });
}));

router.get('/trend', verifyToken, asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const trend = await analyticsService.getDailyTrend(req.user.id, parseInt(days, 10));
  res.json({ success: true, data: trend });
}));

router.get('/platforms', verifyToken, asyncHandler(async (req, res) => {
  const analytics = await analyticsService.getPlatformAnalytics(req.user.id);
  res.json({ success: true, data: analytics });
}));

router.get('/top-performers', verifyToken, asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const performers = await analyticsService.getTopPerformers(req.user.id, parseInt(limit, 10));
  res.json({ success: true, data: performers }));
}));

module.exports = router;