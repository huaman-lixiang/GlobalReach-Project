const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { searchService } = require('../services/searchService');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/emails', verifyToken, asyncHandler(async (req, res) => {
  const { q, status, campaignId, startDate, endDate, limit, offset } = req.query;
  const filters = { status, campaignId, startDate, endDate, limit: parseInt(limit), offset: parseInt(offset) };
  const results = await searchService.searchEmails(req.user.id, q, filters);
  res.json({ success: true, data: results });
}));

router.get('/campaigns', verifyToken, asyncHandler(async (req, res) => {
  const { q, status, type, limit, offset } = req.query;
  const filters = { status, type, limit: parseInt(limit), offset: parseInt(offset) };
  const results = await searchService.searchCampaigns(req.user.id, q, filters);
  res.json({ success: true, data: results });
}));

router.get('/clients', verifyToken, asyncHandler(async (req, res) => {
  const { q, tag, limit, offset } = req.query;
  const filters = { tag, limit: parseInt(limit), offset: parseInt(offset) };
  const results = await searchService.searchClients(req.user.id, q, filters);
  res.json({ success: true, data: results });
}));

router.get('/accounts', verifyToken, asyncHandler(async (req, res) => {
  const { q, status, platform, limit, offset } = req.query;
  const filters = { status, platform, limit: parseInt(limit), offset: parseInt(offset) };
  const results = await searchService.searchAccounts(req.user.id, q, filters);
  res.json({ success: true, data: results });
}));

router.get('/global', verifyToken, asyncHandler(async (req, res) => {
  const { q } = req.query;
  const results = await searchService.globalSearch(req.user.id, q);
  res.json({ success: true, data: results });
}));

module.exports = router;
