/**
 * Campaigns Route — CRUD + Execute for Marketing Campaigns
 *
 * Endpoints:
 *   GET    /api/campaigns              — List campaigns (paginated, filterable)
 *   POST   /api/campaigns              — Create new campaign
 *   GET    /api/campaigns/:id          — Get single campaign detail
 *   PUT    /api/campaigns/:id          — Update campaign
 *   DELETE /api/campaigns/:id          — Delete campaign
 *
 * Campaign execution delegates to emailService.sendCampaign() (D03 pipeline).
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const db = require('../db');
const emailService = require('../services/emailService');
const { verifyToken, validateRequest, requireRole } = require('../middleware/auth');
const {
  paginationRules,
  searchRule,
  statusFilterRule,
  buildSearchPattern,
  CAMPAIGN_TYPES,
} = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(verifyToken);

// ============================================
// Literal path routes (before /:id)
// ============================================

// GET /api/campaigns — List with pagination + status filtering
router.get('/', ...paginationRules(), ...searchRule(), ...statusFilterRule(), asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const isAdmin = req.user.role === 'ADMIN';
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const { status, search } = req.query;

  const where = isAdmin ? {} : { userId };
  if (status) where.status = status.toUpperCase();
  if (search) {
    // D08: Use escaped LIKE pattern to prevent wildcard injection
    where[db.Sequelize.Op.or] = [
      { name: { [db.Sequelize.Op.iLike]: buildSearchPattern(search) } },
      { subject_template: { [db.Sequelize.Op.iLike]: buildSearchPattern(search) } },
    ];
  }

  const { count, rows } = await db.Campaign.findAndCountAll({
    where,
    limit: parseInt(pageSize),
    offset: (parseInt(page) - 1) * parseInt(pageSize),
    order: [['createdAt', 'DESC']],
    include: [{
      model: db.User,
      as: 'user',
      attributes: ['id', 'name', 'email'],
    }],
  });

  res.json({
    success: true,
    data: rows,
    count,
    page: parseInt(page),
    pageSize: parseInt(pageSize),
  });
}));

// POST /api/campaigns — Create campaign
router.post('/', [
  body('name').trim().notEmpty().isLength({ max: 100 }).escape()
    .withMessage('Campaign name required (max 100 chars)'),
  body('subject_template').optional().trim()
    .isLength({ max: 500 })
    .withMessage('Subject template too long (max 500 chars)'),
  body('body_template').optional()
    .isLength({ max: 100000 })
    .withMessage('Body template too long (max 100KB)'),
  body('type').optional().isIn(CAMPAIGN_TYPES).withMessage(
      `Invalid type. Must be one of: ${CAMPAIGN_TYPES.join(', ')}`),
], validateRequest, asyncHandler(async (req, res) => {
  const campaign = await db.Campaign.create({
    userId: req.user.id,
    name: req.body.name,
    type: req.body.type || 'COLD_OUTREACH',
    subject_template: req.body.subject_template || '',
    body_template: req.body.body_template || '',
    target_segment: req.body.targetSegment || null,
    account_ids: req.body.accountIds || [],
    schedule_config: req.body.scheduleConfig || null,
    status: 'DRAFT',
    stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 },
  });

  res.status(201).json({ success: true, data: campaign, message: 'Campaign created' });
}));

// ============================================
// Parameterized routes (/ :id)
// ============================================

// GET /api/campaigns/:id — Single campaign with stats
router.get('/:id', [param('id').isUUID()], validateRequest, asyncHandler(async (req, res) => {
  const campaign = await db.Campaign.findByPk(req.params.id, {
    include: [
      { model: db.User, as: 'user', attributes: ['id', 'name', 'email'] },
      {
        model: db.Email,
        attributes: ['id', 'to_address', 'status', 'sent_at', 'created_at'],
        limit: 20,
        order: [['createdAt', 'DESC']],
      },
    ],
  });

  if (!campaign) {
    return res.status(404).json({ success: false, error: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found' });
  }

  // Compute progress from associated emails
  const emailStats = await db.Email.findAndCountAll({
    where: { campaignId: campaign.id },
    attributes: ['status'],
  });

  const campaignData = campaign.toJSON();
  campaignData.emailCount = emailStats.count;
  campaignData.sentCount = emailStats.rows.filter(e => e.status === 'sent').length;
  campaignData.totalCount = emailStats.count;

  res.json({ success: true, data: campaignData });
}));

// PUT /api/campaigns/:id — Update campaign
router.put('/:id', [param('id').isUUID()], validateRequest, asyncHandler(async (req, res) => {
  const campaign = await db.Campaign.findByPk(req.params.id);
  if (!campaign) {
    return res.status(404).json({ success: false, error: 'CAMPAIGN_NOT_FOUND' });
  }

  // Only owner or ADMIN can update
  if (campaign.userId !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Not your campaign' });
  }

  const allowedFields = ['name', 'subject_template', 'body_template', 'type', 'target_segment', 'account_ids', 'schedule_config'];
  const updateData = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  await campaign.update(updateData);

  res.json({ success: true, data: campaign, message: 'Campaign updated' });
}));

// DELETE /api/campaigns/:id — Delete campaign
router.delete('/:id', [param('id').isUUID()], validateRequest, asyncHandler(async (req, res) => {
  const campaign = await db.Campaign.findByPk(req.params.id);
  if (!campaign) {
    return res.status(404).json({ success: false, error: 'CAMPAIGN_NOT_FOUND' });
  }

  if (campaign.userId !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  // Also delete associated emails
  await db.Email.destroy({ where: { campaignId: campaign.id } });
  await campaign.destroy();

  res.json({ success: true, message: 'Campaign deleted' });
}));

module.exports = router;
