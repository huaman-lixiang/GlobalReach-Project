const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { searchService } = require('../services/searchService');

router.get('/emails', verifyToken, async (req, res) => {
  try {
    const { q, status, campaignId, startDate, endDate, limit, offset } = req.query;
    const filters = { status, campaignId, startDate, endDate, limit: parseInt(limit), offset: parseInt(offset) };
    const results = await searchService.searchEmails(req.user.id, q, filters);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Search] Emails error:', error);
    res.status(500).json({ success: false, error: 'SEARCH_EMAILS_FAILED', message: error.message });
  }
});

router.get('/campaigns', verifyToken, async (req, res) => {
  try {
    const { q, status, type, limit, offset } = req.query;
    const filters = { status, type, limit: parseInt(limit), offset: parseInt(offset) };
    const results = await searchService.searchCampaigns(req.user.id, q, filters);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Search] Campaigns error:', error);
    res.status(500).json({ success: false, error: 'SEARCH_CAMPAIGNS_FAILED', message: error.message });
  }
});

router.get('/clients', verifyToken, async (req, res) => {
  try {
    const { q, tag, limit, offset } = req.query;
    const filters = { tag, limit: parseInt(limit), offset: parseInt(offset) };
    const results = await searchService.searchClients(req.user.id, q, filters);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Search] Clients error:', error);
    res.status(500).json({ success: false, error: 'SEARCH_CLIENTS_FAILED', message: error.message });
  }
});

router.get('/accounts', verifyToken, async (req, res) => {
  try {
    const { q, status, platform, limit, offset } = req.query;
    const filters = { status, platform, limit: parseInt(limit), offset: parseInt(offset) };
    const results = await searchService.searchAccounts(req.user.id, q, filters);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Search] Accounts error:', error);
    res.status(500).json({ success: false, error: 'SEARCH_ACCOUNTS_FAILED', message: error.message });
  }
});

router.get('/global', verifyToken, async (req, res) => {
  try {
    const { q } = req.query;
    const results = await searchService.globalSearch(req.user.id, q);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Search] Global error:', error);
    res.status(500).json({ success: false, error: 'SEARCH_GLOBAL_FAILED', message: error.message });
  }
});

module.exports = router;