const db = require('../db');
const { Op } = require('sequelize');

class SearchService {
  async searchEmails(userId, query, filters = {}) {
    const whereClause = { '$campaign.userId$': userId };

    if (query) {
      whereClause[Op.or] = [
        { to_address: { [Op.iLike]: `%${query}%` } },
        { subject: { [Op.iLike]: `%${query}%` } },
        { body: { [Op.iLike]: `%${query}%` } },
      ];
    }

    if (filters.status) {
      whereClause.status = filters.status;
    }

    if (filters.campaignId) {
      whereClause.campaignId = filters.campaignId;
    }

    if (filters.startDate) {
      whereClause.createdAt = { [Op.gte]: new Date(filters.startDate) };
    }

    if (filters.endDate) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: new Date(filters.endDate),
      };
    }

    const emails = await db.Email.findAll({
      where: whereClause,
      include: [{ model: db.Campaign, attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    });

    const total = await db.Email.count({
      where: whereClause,
      include: [{ model: db.Campaign }],
    });

    return {
      results: emails,
      total,
      page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
      pageSize: filters.limit || 50,
    };
  }

  async searchCampaigns(userId, query, filters = {}) {
    const whereClause = { userId };

    if (query) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${query}%` } },
        { description: { [Op.iLike]: `%${query}%` } },
      ];
    }

    if (filters.status) {
      whereClause.status = filters.status;
    }

    if (filters.type) {
      whereClause.type = filters.type;
    }

    const campaigns = await db.Campaign.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    });

    const total = await db.Campaign.count({ where: whereClause });

    return {
      results: campaigns,
      total,
      page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
      pageSize: filters.limit || 50,
    };
  }

  async searchClients(userId, query, filters = {}) {
    const whereClause = { userId };

    if (query) {
      whereClause[Op.or] = [
        { email: { [Op.iLike]: `%${query}%` } },
        { firstName: { [Op.iLike]: `%${query}%` } },
        { lastName: { [Op.iLike]: `%${query}%` } },
        { company: { [Op.iLike]: `%${query}%` } },
      ];
    }

    if (filters.tag) {
      whereClause.tags = { [Op.contains]: [filters.tag] };
    }

    const clients = await db.Client.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    });

    const total = await db.Client.count({ where: whereClause });

    return {
      results: clients,
      total,
      page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
      pageSize: filters.limit || 50,
    };
  }

  async searchAccounts(userId, query, filters = {}) {
    const whereClause = { userId };

    if (query) {
      whereClause[Op.or] = [
        { email: { [Op.iLike]: `%${query}%` } },
        { platform: { [Op.iLike]: `%${query}%` } },
      ];
    }

    if (filters.status) {
      whereClause.status = filters.status;
    }

    if (filters.platform) {
      whereClause.platform = filters.platform;
    }

    const accounts = await db.EmailAccount.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    });

    const total = await db.EmailAccount.count({ where: whereClause });

    return {
      results: accounts,
      total,
      page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
      pageSize: filters.limit || 50,
    };
  }

  async globalSearch(userId, query) {
    const [emails, campaigns, clients, accounts] = await Promise.all([
      this.searchEmails(userId, query, { limit: 10 }),
      this.searchCampaigns(userId, query, { limit: 10 }),
      this.searchClients(userId, query, { limit: 10 }),
      this.searchAccounts(userId, query, { limit: 10 }),
    ]);

    return {
      emails: emails.results,
      campaigns: campaigns.results,
      clients: clients.results,
      accounts: accounts.results,
      totalResults: emails.total + campaigns.total + clients.total + accounts.total,
    };
  }
}

const searchService = new SearchService();

module.exports = {
  SearchService,
  searchService,
};