const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { analyticsService } = require('../services/analyticsService');

router.get('/overview', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, campaignId } = req.query;
    const filters = { startDate, endDate, campaignId };
    const analytics = await analyticsService.getEmailAnalytics(req.user.id, filters);
    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('[Analytics] Overview error:', error);
    res.status(500).json({ success: false, error: 'ANALYTICS_OVERVIEW_FAILED', message: error.message });
  }
});

router.get('/campaigns', verifyToken, async (req, res) => {
  try {
    const analytics = await analyticsService.getCampaignAnalytics(req.user.id);
    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('[Analytics] Campaigns error:', error);
    res.status(500).json({ success: false, error: 'ANALYTICS_CAMPAIGNS_FAILED', message: error.message });
  }
});

router.get('/trend', verifyToken, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const trend = await analyticsService.getDailyTrend(req.user.id, parseInt(days, 10));
    res.json({ success: true, data: trend });
  } catch (error) {
    console.error('[Analytics] Trend error:', error);
    res.status(500).json({ success: false, error: 'ANALYTICS_TREND_FAILED', message: error.message });
  }
});

router.get('/platforms', verifyToken, async (req, res) => {
  try {
    const analytics = await analyticsService.getPlatformAnalytics(req.user.id);
    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('[Analytics] Platforms error:', error);
    res.status(500).json({ success: false, error: 'ANALYTICS_PLATFORMS_FAILED', message: error.message });
  }
});

router.get('/top-performers', verifyToken, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const performers = await analyticsService.getTopPerformers(req.user.id, parseInt(limit, 10));
    res.json({ success: true, data: performers });
  } catch (error) {
    console.error('[Analytics] Top performers error:', error);
    res.status(500).json({ success: false, error: 'ANALYTICS_PERFORMERS_FAILED', message: error.message });
  }
});

module.exports = router;