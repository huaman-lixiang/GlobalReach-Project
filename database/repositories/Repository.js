const db = require('../models');

class AccountRepository {
  async findAll(options = {}) {
    const { platform, status, tenantId, limit = 50, offset = 0 } = options;
    
    const where = {};
    if (platform) where.platform = platform;
    if (status) where.status = status;
    if (tenantId) where.tenantId = tenantId;

    return await db.Account.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      include: [
        { model: db.Tenant, as: 'tenant', attributes: ['id', 'name'] },
        { model: db.User, as: 'creator', attributes: ['id', 'name'] }
      ]
    });
  }

  async findById(id) {
    return await db.Account.findByPk(id, {
      include: [
        { model: db.Tenant, as: 'tenant' },
        { model: db.User, as: 'creator' },
        { 
          model: db.EmailLog, 
          as: 'emailLogs',
          limit: 10,
          order: [['createdAt', 'DESC']]
        }
      ]);
  }

  async create(accountData) {
    return await db.Account.create(accountData);
  }

  async update(id, updateData) {
    const [rows] = await db.Account.update(updateData, { where: { id } });
    return rows > 0 ? this.findById(id) : null;
  }

  async delete(id) {
    const rows = await db.Account.destroy({ where: { id } });
    return rows > 0;
  }

  async findByPlatform(platform) {
    return await db.Account.findAll({
      where: { platform },
      attributes: { exclude: ['encryptedCredentials'] },
      order: [['createdAt', 'DESC']]
    });
  }

  async getStatsByPlatform() {
    return await db.Account.findAll({
      attributes: [
        'platform',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        [db.sequelize.fn('SUM', db.sequelize.col('sentTodayCount')), 'totalSentToday']
      ],
      group: ['platform'],
      raw: true
    });
  }

  async batchCreate(accounts) {
    return await db.Account.bulkCreate(accounts, { validate: true });
  }
}

class EmailLogRepository {
  async create(logData) {
    return await db.EmailLog.create(logData);
  }

  async findById(id) {
    return await db.EmailLog.findByPk(id, {
      include: [
        { model: db.Account, as: 'account', attributes: { exclude: ['encryptedCredentials'] } },
        { model: db.Campaign, as: 'campaign' }
      ]
    });
  }

  async findAll(options = {}) {
    const { status, accountId, campaignId, dateFrom, dateTo, limit = 50, offset = 0 } = options;
    
    const where = {};
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;
    if (campaignId) where.campaignId = campaignId;
    if (dateFrom || dateTo) {
      where.sentAt = {};
      if (dateFrom) where.sentAt[db.Sequelize.Op.gte] = dateFrom;
      if (dateTo) where.sentAt[db.Sequelize.Op.lte] = dateTo;
    }

    return await db.EmailLog.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      include: [
        { model: db.Account, as: 'account', attributes: ['id', 'platform', 'email'] }
      ]
    });
  }

  async getStatsByDateRange(dateFrom, dateTo) {
    return await db.EmailLog.findAll({
      attributes: [
        [db.sequelize.fn('DATE', db.sequelize.col('createdAt')), 'date'],
        'status',
        [db.sequelize.fn('COUNT', '*'), 'count']
      ],
      where: {
        createdAt: { [db.Sequelize.Op.between]: [dateFrom, dateTo] }
      },
      group: ['date', 'status'],
      raw: true
    });
  }

  async getPlatformStats(dateFrom, dateTo) {
    return await db.EmailLog.findAll({
      attributes: [
        'platform',
        'status',
        [db.sequelize.fn('COUNT', '*'), 'count']
      ],
      where: {
        createdAt: { [db.Sequelize.Op.between]: [dateFrom, dateTo] }
      },
      group: ['platform', 'status'],
      raw: true
    });
  }
}

class TenantRepository {
  async findAll() {
    return await db.Tenant.findAll({
      include: [{
        model: db.Account,
        as: 'accounts',
        attributes: { exclude: ['encryptedCredentials'] }
      }],
      order: [['name', 'ASC']]
    });
  }

  async findById(id) {
    return await db.Tenant.findByPk(id, {
      include: [{ model: db.Account, as: 'accounts' }]
    });
  }

  async create(tenantData) {
    return await db.Tenant.create(tenantData);
  }

  async update(id, updateData) {
    const [rows] = await db.Tenant.update(updateData, { where: { id } });
    return rows > 0 ? this.findById(id) : null;
  }

  async delete(id) {
    const rows = await db.Tenant.destroy({ where: { id } });
    return rows > 0;
  }

  async getSummary() {
    const tenants = await db.Tenant.findAndCountAll();
    const accounts = await db.Account.count();

    return {
      totalTenants: tenants.count,
      totalAccounts: accounts,
      avgAccountsPerTenant: tenants.count > 0 ? (accounts / tenants.count).toFixed(2) : 0
    };
  }
}

class UserRepository {
  async findByEmail(email) {
    return await db.User.findOne({ where: { email } });
  }

  async findById(id) {
    return await db.User.findByPk(id, {
      attributes: { exclude: ['passwordHash'] },
      include: [{
        model: db.Account,
        as: 'accounts',
        attributes: { exclude: ['encryptedCredentials'] }
      }]
    });
  }

  async create(userData) {
    return await db.User.create(userData);
  }

  async updateLoginInfo(userId) {
    return await db.User.update(
      { 
        lastLoginAt: new Date(),
        loginCount: db.sequelize.literal('login_count + 1')
      },
      { where: { id: userId } }
    );
  }
}

class StatisticsRepository {
  async recordMetric(date, platform, metricType, value, rate = null, tenantId = null) {
    return await db.Statistic.upsert(
      { date, platform, metricType, value, rate, tenantId },
      { returning: true }
    );
  }

  async getDailyStats(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return await db.Statistic.findAll({
      where: {
        date: { [db.Sequelize.Op.gte]: cutoff.toISOString().split('T')[0] }
      },
      order: [['date', 'ASC'], ['platform', 'ASC']],
      raw: true
    });
  }

  async getPlatformComparison(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return await db.Statistic.findAll({
      attributes: [
        'platform',
        'metricType',
        [db.sequelize.fn('SUM', db.sequelize.col('value')), 'totalValue'],
        [db.sequelize.fn('AVG', db.sequelize.col('rate')), 'avgRate']
      ],
      where: {
        date: { [db.Sequelize.Op.gte]: cutoff.toISOString().split('T')[0] }
      },
      group: ['platform', 'metricType'],
      raw: true
    });
  }
}

module.exports = {
  AccountRepository: new AccountRepository(),
  EmailLogRepository: new EmailLogRepository(),
  TenantRepository: new TenantRepository(),
  UserRepository: new UserRepository(),
  StatisticsRepository: new StatisticsRepository()
};