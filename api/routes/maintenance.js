const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { maintenanceService } = require('../services/maintenanceService');

const isAdmin = requireRole('admin');

router.post('/errors/log', async (req, res) => {
  try {
    const errorData = {
      userId: req.user?.id,
      ...req.body,
    };
    await maintenanceService.logError(errorData);
    res.json({ success: true, message: 'Error logged successfully' });
  } catch (error) {
    console.error('[Maintenance] Log error:', error);
    res.status(500).json({ success: false, error: 'ERROR_LOG_FAILED', message: error.message });
  }
});

router.get('/errors', verifyToken, isAdmin, async (req, res) => {
  try {
    const { errorType, statusCode, startDate, endDate, limit, offset } = req.query;
    const filters = { errorType, statusCode, startDate, endDate, limit: parseInt(limit), offset: parseInt(offset) };
    const results = await maintenanceService.getErrorLogs(null, filters);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Maintenance] Get errors error:', error);
    res.status(500).json({ success: false, error: 'ERROR_GET_FAILED', message: error.message });
  }
});

router.get('/errors/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const stats = await maintenanceService.getErrorStats(null);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('[Maintenance] Error stats error:', error);
    res.status(500).json({ success: false, error: 'ERROR_STATS_FAILED', message: error.message });
  }
});

router.post('/feedback', verifyToken, async (req, res) => {
  try {
    const { type, title, message, rating, metadata } = req.body;
    const feedback = await maintenanceService.createFeedback(req.user.id, {
      type,
      title,
      message,
      rating,
      metadata,
    });
    res.status(201).json({ success: true, data: feedback });
  } catch (error) {
    console.error('[Maintenance] Create feedback error:', error);
    res.status(500).json({ success: false, error: 'FEEDBACK_CREATE_FAILED', message: error.message });
  }
});

router.get('/feedback', verifyToken, async (req, res) => {
  try {
    const { type, rating, limit, offset } = req.query;
    const filters = { type, rating, limit: parseInt(limit), offset: parseInt(offset) };
    const results = await maintenanceService.getFeedback(req.user.id, filters);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Maintenance] Get feedback error:', error);
    res.status(500).json({ success: false, error: 'FEEDBACK_GET_FAILED', message: error.message });
  }
});

router.get('/feedback/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const stats = await maintenanceService.getFeedbackStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('[Maintenance] Feedback stats error:', error);
    res.status(500).json({ success: false, error: 'FEEDBACK_STATS_FAILED', message: error.message });
  }
});

router.get('/health', verifyToken, isAdmin, async (req, res) => {
  try {
    const health = await maintenanceService.getSystemHealth();
    res.json({ success: true, data: health });
  } catch (error) {
    console.error('[Maintenance] Health check error:', error);
    res.status(500).json({ success: false, error: 'HEALTH_CHECK_FAILED', message: error.message });
  }
});

router.get('/logs', verifyToken, isAdmin, async (req, res) => {
  try {
    const logs = await maintenanceService.getMaintenanceLog();
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('[Maintenance] Get logs error:', error);
    res.status(500).json({ success: false, error: 'LOGS_GET_FAILED', message: error.message });
  }
});

router.post('/logs/event', verifyToken, isAdmin, async (req, res) => {
  try {
    const { eventType, message, details } = req.body;
    await maintenanceService.logMaintenanceEvent(eventType, message, details);
    res.json({ success: true, message: 'Event logged successfully' });
  } catch (error) {
    console.error('[Maintenance] Log event error:', error);
    res.status(500).json({ success: false, error: 'EVENT_LOG_FAILED', message: error.message });
  }
});

router.get('/system-info', verifyToken, isAdmin, async (req, res) => {
  try {
    const health = await maintenanceService.getSystemHealth();
    const errorStats = await maintenanceService.getErrorStats(null);
    const feedbackStats = await maintenanceService.getFeedbackStats();

    res.json({
      success: true,
      data: {
        health,
        errorStats,
        feedbackStats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Maintenance] System info error:', error);
    res.status(500).json({ success: false, error: 'SYSTEM_INFO_FAILED', message: error.message });
  }
});

module.exports = router;