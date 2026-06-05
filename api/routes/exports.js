const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { exportService } = require('../services/exportService');

router.get('/emails/csv', verifyToken, async (req, res) => {
  try {
    const { campaignId, startDate, endDate } = req.query;
    const filters = { campaignId, startDate, endDate };
    const result = await exportService.exportEmailsCSV(req.user.id, filters);
    
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    console.error('[Export] Emails CSV error:', error);
    res.status(500).json({ success: false, error: 'EXPORT_EMAILS_CSV_FAILED', message: error.message });
  }
});

router.get('/emails/excel', verifyToken, async (req, res) => {
  try {
    const { campaignId, startDate, endDate } = req.query;
    const filters = { campaignId, startDate, endDate };
    const result = await exportService.exportEmailsExcel(req.user.id, filters);
    
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    console.error('[Export] Emails Excel error:', error);
    res.status(500).json({ success: false, error: 'EXPORT_EMAILS_EXCEL_FAILED', message: error.message });
  }
});

router.get('/campaigns/csv', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const filters = { status };
    const result = await exportService.exportCampaignsCSV(req.user.id, filters);
    
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    console.error('[Export] Campaigns CSV error:', error);
    res.status(500).json({ success: false, error: 'EXPORT_CAMPAIGNS_CSV_FAILED', message: error.message });
  }
});

router.get('/analytics/pdf', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filters = { startDate, endDate };
    const result = await exportService.exportAnalyticsPDF(req.user.id, filters);
    
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    console.error('[Export] Analytics PDF error:', error);
    res.status(500).json({ success: false, error: 'EXPORT_ANALYTICS_PDF_FAILED', message: error.message });
  }
});

module.exports = router;