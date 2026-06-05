const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { pushNotificationService } = require('../services/pushNotificationService');
const db = require('../db');

router.post('/devices/register', verifyToken, async (req, res) => {
  try {
    const { deviceToken, platform, deviceId } = req.body;
    const device = await pushNotificationService.registerDevice(
      req.user.id, deviceToken, platform, deviceId
    );
    res.status(201).json({ success: true, data: device });
  } catch (error) {
    console.error('[Mobile] Register device error:', error);
    res.status(500).json({ success: false, error: 'DEVICE_REGISTER_FAILED', message: error.message });
  }
});

router.post('/devices/unregister', verifyToken, async (req, res) => {
  try {
    const { deviceId } = req.body;
    await pushNotificationService.unregisterDevice(req.user.id, deviceId);
    res.json({ success: true, message: 'Device unregistered successfully' });
  } catch (error) {
    console.error('[Mobile] Unregister device error:', error);
    res.status(500).json({ success: false, error: 'DEVICE_UNREGISTER_FAILED', message: error.message });
  }
});

router.get('/devices', verifyToken, async (req, res) => {
  try {
    const devices = await pushNotificationService.getDevices(req.user.id);
    res.json({ success: true, data: devices });
  } catch (error) {
    console.error('[Mobile] Get devices error:', error);
    res.status(500).json({ success: false, error: 'DEVICE_LIST_FAILED', message: error.message });
  }
});

router.get('/dashboard', verifyToken, async (req, res) => {
  try {
    const [campaignCount, emailCount, todayEmails, openRate] = await Promise.all([
      db.Campaign.count({ where: { userId: req.user.id } }),
      db.Email.count({ where: { '$campaign.userId$': req.user.id }, include: [{ model: db.Campaign }] }),
      db.Email.count({
        where: {
          '$campaign.userId$': req.user.id,
          createdAt: {
            [db.Sequelize.Op.gte]: new Date(new Date().toDateString()),
          },
        },
        include: [{ model: db.Campaign }],
      }),
      db.Email.findOne({
        attributes: [
          [db.Sequelize.fn('AVG', db.Sequelize.literal('CASE WHEN opened = true THEN 100 ELSE 0 END')), 'openRate'],
        ],
        where: { '$campaign.userId$': req.user.id },
        include: [{ model: db.Campaign }],
        raw: true,
      }),
    ]);

    const recentCampaigns = await db.Campaign.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 5,
      attributes: ['id', 'name', 'status', 'emailCount', 'createdAt'],
    });

    res.json({
      success: true,
      data: {
        overview: {
          campaignCount,
          emailCount,
          todayEmails,
          openRate: parseFloat(openRate?.openRate) || 0,
        },
        recentCampaigns,
      },
    });
  } catch (error) {
    console.error('[Mobile] Dashboard error:', error);
    res.status(500).json({ success: false, error: 'DASHBOARD_FAILED', message: error.message });
  }
});

router.get('/campaigns', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const campaigns = await db.Campaign.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: ['id', 'name', 'type', 'status', 'emailCount', 'createdAt'],
    });

    const total = await db.Campaign.count({ where: { userId: req.user.id } });

    res.json({
      success: true,
      data: {
        items: campaigns,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('[Mobile] Campaigns error:', error);
    res.status(500).json({ success: false, error: 'CAMPAIGNS_FAILED', message: error.message });
  }
});

router.get('/campaigns/:id/overview', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await db.Campaign.findOne({
      where: { id, userId: req.user.id },
      include: [{ model: db.Email }],
    });

    if (!campaign) {
      return res.status(404).json({ success: false, error: 'CAMPAIGN_NOT_FOUND' });
    }

    const emails = campaign.Emails || [];
    const total = emails.length;
    const delivered = emails.filter(e => e.status === 'delivered').length;
    const opened = emails.filter(e => e.opened).length;
    const clicked = emails.filter(e => e.clicked).length;
    const bounced = emails.filter(e => e.status === 'bounced').length;

    res.json({
      success: true,
      data: {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        createdAt: campaign.createdAt,
        statistics: {
          total,
          delivered,
          opened,
          clicked,
          bounced,
          deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(1) : '0',
          openRate: delivered > 0 ? ((opened / delivered) * 100).toFixed(1) : '0',
          clickRate: opened > 0 ? ((clicked / opened) * 100).toFixed(1) : '0',
          bounceRate: total > 0 ? ((bounced / total) * 100).toFixed(1) : '0',
        },
      },
    });
  } catch (error) {
    console.error('[Mobile] Campaign overview error:', error);
    res.status(500).json({ success: false, error: 'CAMPAIGN_OVERVIEW_FAILED', message: error.message });
  }
});

router.get('/quick-stats', verifyToken, async (req, res) => {
  try {
    const [totalEmails, deliveredEmails, openedEmails, clickedEmails, campaignCount] = await Promise.all([
      db.Email.count({ where: { '$campaign.userId$': req.user.id }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { '$campaign.userId$': req.user.id, status: 'delivered' }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { '$campaign.userId$': req.user.id, opened: true }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { '$campaign.userId$': req.user.id, clicked: true }, include: [{ model: db.Campaign }] }),
      db.Campaign.count({ where: { userId: req.user.id } }),
    ]);

    res.json({
      success: true,
      data: {
        totalEmails,
        deliveredEmails,
        openedEmails,
        clickedEmails,
        campaignCount,
        deliveryRate: totalEmails > 0 ? ((deliveredEmails / totalEmails) * 100).toFixed(1) : '0',
        openRate: deliveredEmails > 0 ? ((openedEmails / deliveredEmails) * 100).toFixed(1) : '0',
        clickRate: openedEmails > 0 ? ((clickedEmails / openedEmails) * 100).toFixed(1) : '0',
      },
    });
  } catch (error) {
    console.error('[Mobile] Quick stats error:', error);
    res.status(500).json({ success: false, error: 'QUICK_STATS_FAILED', message: error.message });
  }
});

module.exports = router;