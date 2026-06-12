const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { maintenanceService } = require('../services/maintenanceService');
const { asyncHandler } = require('../middleware/errorHandler');

const isAdmin = requireRole('admin');

router.post('/errors/log', asyncHandler(async (req, res) => {
  const errorData = {
    userId: req.user?.id,
    ...req.body,
  };
  await maintenanceService.logError(errorData);
  res.json({ success: true, message: 'Error logged successfully' });
}));

router.get('/errors', verifyToken, isAdmin, asyncHandler(async (req, res) => {
  const { errorType, statusCode, startDate, endDate, limit, offset } = req.query;
  const filters = { errorType, statusCode, startDate, endDate, limit: parseInt(limit), offset: parseInt(offset) };
  const results = await maintenanceService.getErrorLogs(null, filters);
  res.json({ success: true, data: results });
}));

router.get('/errors/stats', verifyToken, isAdmin, asyncHandler(async (req, res) => {
  const stats = await maintenanceService.getErrorStats(null);
  res.json({ success: true, data: stats });
}));

router.post('/feedback', verifyToken, asyncHandler(async (req, res) => {
  const { type, title, message, rating, metadata } = req.body;
  const feedback = await maintenanceService.createFeedback(req.user.id, {
    type,
    title,
    message,
    rating,
    metadata,
  });
  res.status(201).json({ success: true, data: feedback });
}));

router.get('/feedback', verifyToken, asyncHandler(async (req, res) => {
  const { type, rating, limit, offset } = req.query;
  const filters = { type, rating, limit: parseInt(limit), offset: parseInt(offset) };
  const results = await maintenanceService.getFeedback(req.user.id, filters);
  res.json({ success: true, data: results });
}));

router.get('/feedback/stats', verifyToken, isAdmin, asyncHandler(async (req, res) => {
  const stats = await maintenanceService.getFeedbackStats();
  res.json({ success: true, data: stats });
}));

router.get('/health', verifyToken, isAdmin, asyncHandler(async (req, res) => {
  const health = await maintenanceService.getSystemHealth();
  res.json({ success: true, data: health });
}));

router.get('/logs', verifyToken, isAdmin, asyncHandler(async (req, res) => {
  const logs = await maintenanceService.getMaintenanceLog();
  res.json({ success: true, data: logs });
}));

router.post('/logs/event', verifyToken, isAdmin, asyncHandler(async (req, res) => {
  const { eventType, message, details } = req.body;
  await maintenanceService.logMaintenanceEvent(eventType, message, details);
  res.json({ success: true, message: 'Event logged successfully' });
}));

router.get('/system-info', verifyToken, isAdmin, asyncHandler(async (req, res) => {
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
}));

module.exports = router;
