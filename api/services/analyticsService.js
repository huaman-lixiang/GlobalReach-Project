const db = require('../db');
const { Op } = require('sequelize');

class AnalyticsService {
  async getEmailAnalytics(userId, filters = {}) {
    const { startDate, endDate, campaignId } = filters;
    
    const whereClause = { '$campaign.userId$': userId };
    
    if (startDate) {
      whereClause.createdAt = { [Op.gte]: new Date(startDate) };
    }
    if (endDate) {
      whereClause.createdAt = { 
        ...whereClause.createdAt,
        [Op.lte]: new Date(endDate) 
      };
    }
    if (campaignId) {
      whereClause.campaignId = campaignId;
    }

    const [total, delivered, opened, clicked, bounced, converted] = await Promise.all([
      db.Email.count({ where: whereClause, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, status: 'delivered' }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, opened: true }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, clicked: true }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, status: 'bounced' }, include: [{ model: db.Campaign }] }),
      db.Email.count({ where: { ...whereClause, converted: true }, include: [{ model: db.Campaign }] }),
    ]);

    const deliveryRate = total > 0 ? ((delivered / total) * 100).toFixed(2) : 0;
    const openRate = delivered > 0 ? ((opened / delivered) * 100).toFixed(2) : 0;
    const clickRate = opened > 0 ? ((clicked / opened) * 100).toFixed(2) : 0;
    const bounceRate = total > 0 ? ((bounced / total) * 100).toFixed(2) : 0;
    const conversionRate = clicked > 0 ? ((converted / clicked) * 100).toFixed(2) : 0;

    return {
      total,
      delivered,
      opened,
      clicked,
      bounced,
      converted,
      deliveryRate: parseFloat(deliveryRate),
      openRate: parseFloat(openRate),
      clickRate: parseFloat(clickRate),
      bounceRate: parseFloat(bounceRate),
      conversionRate: parseFloat(conversionRate),
    };
  }

  async getCampaignAnalytics(userId) {
    const campaigns = await db.Campaign.findAll({
      where: { userId },
      include: [{ model: db.Email }],
      order: [['createdAt', 'DESC']],
    });

    return campaigns.map(campaign => {
      const emails = campaign.Emails || [];
      const total = emails.length;
      const delivered = emails.filter(e => e.status === 'delivered').length;
      const opened = emails.filter(e => e.opened).length;
      const clicked = emails.filter(e => e.clicked).length;
      const bounced = emails.filter(e => e.status === 'bounced').length;
      const converted = emails.filter(e => e.converted).length;

      return {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        totalEmails: total,
        delivered,
        opened,
        clicked,
        bounced,
        converted,
        deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(2) : 0,
        openRate: delivered > 0 ? ((opened / delivered) * 100).toFixed(2) : 0,
        clickRate: opened > 0 ? ((clicked / opened) * 100).toFixed(2) : 0,
        bounceRate: total > 0 ? ((bounced / total) * 100).toFixed(2) : 0,
        conversionRate: clicked > 0 ? ((converted / clicked) * 100).toFixed(2) : 0,
        createdAt: campaign.createdAt,
      };
    });
  }

  async getDailyTrend(userId, days = 30) {
    const results = [];
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));

      const [total, delivered, opened, clicked, bounced] = await Promise.all([
        db.Email.count({
          where: {
            createdAt: { [Op.between]: [startOfDay, endOfDay] },
            '$campaign.userId$': userId,
          },
          include: [{ model: db.Campaign }],
        }),
        db.Email.count({
          where: {
            status: 'delivered',
            createdAt: { [Op.between]: [startOfDay, endOfDay] },
            '$campaign.userId$': userId,
          },
          include: [{ model: db.Campaign }],
        }),
        db.Email.count({
          where: {
            opened: true,
            createdAt: { [Op.between]: [startOfDay, endOfDay] },
            '$campaign.userId$': userId,
          },
          include: [{ model: db.Campaign }],
        }),
        db.Email.count({
          where: {
            clicked: true,
            createdAt: { [Op.between]: [startOfDay, endOfDay] },
            '$campaign.userId$': userId,
          },
          include: [{ model: db.Campaign }],
        }),
        db.Email.count({
          where: {
            status: 'bounced',
            createdAt: { [Op.between]: [startOfDay, endOfDay] },
            '$campaign.userId$': userId,
          },
          include: [{ model: db.Campaign }],
        }),
      ]);

      results.push({
        date: startOfDay.toISOString().split('T')[0],
        total,
        delivered,
        opened,
        clicked,
        bounced,
        openRate: delivered > 0 ? ((opened / delivered) * 100).toFixed(2) : 0,
        clickRate: opened > 0 ? ((clicked / opened) * 100).toFixed(2) : 0,
        bounceRate: total > 0 ? ((bounced / total) * 100).toFixed(2) : 0,
      });
    }

    return results;
  }

  async getPlatformAnalytics(userId) {
    const results = await db.Email.findAll({
      attributes: [
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'total'],
        [db.sequelize.fn('SUM', db.sequelize.literal('CASE WHEN status = "delivered" THEN 1 ELSE 0 END')), 'delivered'],
        [db.sequelize.fn('SUM', db.sequelize.literal('CASE WHEN opened = true THEN 1 ELSE 0 END')), 'opened'],
        [db.sequelize.fn('SUM', db.sequelize.literal('CASE WHEN clicked = true THEN 1 ELSE 0 END')), 'clicked'],
        [db.sequelize.fn('SUM', db.sequelize.literal('CASE WHEN status = "bounced" THEN 1 ELSE 0 END')), 'bounced'],
      ],
      include: [{ model: db.EmailAccount, attributes: ['platform'] }],
      where: { '$campaign.userId$': userId },
      group: ['EmailAccount.platform'],
      raw: true,
    });

    return results.map(row => ({
      platform: row['EmailAccount.platform'],
      total: parseInt(row.total, 10),
      delivered: parseInt(row.delivered, 10),
      opened: parseInt(row.opened, 10),
      clicked: parseInt(row.clicked, 10),
      bounced: parseInt(row.bounced, 10),
      deliveryRate: row.total > 0 ? ((row.delivered / row.total) * 100).toFixed(2) : 0,
      openRate: row.delivered > 0 ? ((row.opened / row.delivered) * 100).toFixed(2) : 0,
      clickRate: row.opened > 0 ? ((row.clicked / row.opened) * 100).toFixed(2) : 0,
      bounceRate: row.total > 0 ? ((row.bounced / row.total) * 100).toFixed(2) : 0,
    }));
  }

  async getTopPerformers(userId, limit = 10) {
    const results = await db.Email.findAll({
      attributes: ['to_address', 'subject'],
      include: [{ model: db.Campaign, attributes: ['name'] }],
      where: { 
        converted: true,
        '$campaign.userId$': userId,
      },
      order: [['createdAt', 'DESC']],
      limit,
      raw: true,
    });

    return results.map(row => ({
      id: row.id,
      toAddress: row.to_address,
      subject: row.subject,
      campaignName: row['campaign.name'],
      convertedAt: row.createdAt,
    }));
  }
}

const analyticsService = new AnalyticsService();

module.exports = {
  AnalyticsService,
  analyticsService,
};