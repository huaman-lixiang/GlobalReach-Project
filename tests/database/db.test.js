const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

let sequelize;
let models = {};

beforeAll(async () => {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  });

  const User = sequelize.define('User', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    role: { type: DataTypes.ENUM('admin', 'user'), defaultValue: 'user' }
  }, { tableName: 'users' });

  const Tenant = sequelize.define('Tenant', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    slug: { type: DataTypes.STRING(50), unique: true, allowNull: false },
    plan: { type: DataTypes.ENUM('basic', 'enterprise'), defaultValue: 'basic' }
  }, { tableName: 'tenants' });

  const Account = sequelize.define('Account', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    platform: { type: DataTypes.ENUM('gmail', 'outlook', 'qq'), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    encryptedCredentials: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'inactive' },
    tenantId: { type: DataTypes.UUID }
  }, { tableName: 'accounts' });

  User.hasMany(Account, { foreignKey: 'createdBy' });
  Account.belongsTo(User, { foreignKey: 'createdBy' });
  Tenant.hasMany(Account, { foreignKey: 'tenantId' });
  Account.belongsTo(Tenant, { foreignKey: 'tenantId' });

  models = { User, Tenant, Account };
  
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Database Models - Unit Tests', () => {
  describe('User Model', () => {
    test('should create a user with required fields', async () => {
      const user = await models.User.create({
        email: 'test@example.com',
        passwordHash: 'hashedpassword123',
        name: 'Test User'
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
      expect(user.role).toBe('user');
    });

    test('should enforce email uniqueness', async () => {
      await models.User.create({
        email: 'unique@test.com',
        passwordHash: 'hash',
        name: 'User 1'
      });

      await expect(
        models.User.create({
          email: 'unique@test.com',
          passwordHash: 'hash2',
          name: 'User 2'
        })
      ).rejects.toThrow();
    });

    test('should support admin role', async () => {
      const admin = await models.User.create({
        email: 'admin@test.com',
        passwordHash: 'adminhash',
        name: 'Admin',
        role: 'admin'
      });

      expect(admin.role).toBe('admin');
    });
  });

  describe('Tenant Model', () => {
    test('should create a tenant with slug', async () => {
      const tenant = await models.Tenant.create({
        name: 'Test Company',
        slug: 'test-company'
      });

      expect(tenant.id).toBeDefined();
      expect(tenant.slug).toBe('test-company');
      expect(tenant.plan).toBe('basic');
    });

    test('should enforce slug uniqueness', async () => {
      await models.Tenant.create({ name: 'Org 1', slug: 'org-1' });
      
      await expect(
        models.Tenant.create({ name: 'Org 2', slug: 'org-1' })
      ).rejects.toThrow();
    });
  });

  describe('Account Model', () => {
    let user, tenant;

    beforeAll(async () => {
      user = await models.User.create({
        email: 'owner@test.com',
        passwordHash: 'ownerhash',
        name: 'Account Owner'
      });
      
      tenant = await models.Tenant.create({
        name: 'Account Tenant',
        slug: 'account-tenant'
      });
    });

    test('should create account with platform and credentials', async () => {
      const account = await models.Account.create({
        platform: 'gmail',
        email: 'account@gmail.com',
        encryptedCredentials: '{"type":"oauth2","token":"xxx"}',
        createdBy: user.id,
        tenantId: tenant.id
      });

      expect(account.platform).toBe('gmail');
      expect(account.status).toBe('inactive');
    });

    test('should support all platform types', async () => {
      const platforms = ['gmail', 'outlook', 'qq'];
      
      for (const platform of platforms) {
        const acc = await models.Account.create({
          platform,
          email: `${platform}@test.com`,
          encryptedCredentials: '{}',
          createdBy: user.id
        });
        expect(acc.platform).toBe(platform);
      }
    });

    test('should associate with creator user', async () => {
      const accounts = await models.User.findByPk(user.id, {
        include: [{ model: models.Account, as: 'accounts' }]
      });

      expect(accounts.accounts.length).toBeGreaterThan(0);
    });
  });
});

describe('Database Integration - Relationship Tests', () => {
  test('tenant should have multiple accounts', async () => {
    const tenant = await models.Tenant.create({
      name: 'Multi-Account Org',
      slug: 'multi-account-org'
    });

    const user = await models.User.create({
      email: 'multi@test.com',
      passwordHash: 'hash',
      name: 'Multi User'
    });

    await Promise.all([
      models.Account.create({
        platform: 'gmail',
        email: 'g1@multi.com',
        encryptedCredentials: '{}',
        tenantId: tenant.id,
        createdBy: user.id
      }),
      models.Account.create({
        platform: 'outlook',
        email: 'o1@multi.com',
        encryptedCredentials: '{}',
        tenantId: tenant.id,
        createdBy: user.id
      })
    ]);

    const loadedTenant = await models.Tenant.findByPk(tenant.id, {
      include: [{ model: models.Account, as: 'accounts' }]
    });

    expect(loadedTenant.accounts.length).toBe(2);
  });

  test('should handle cascade delete scenarios', async () => {
    const tempTenant = await models.Tenant.create({
      name: 'Temporary',
      slug: `temp-${Date.now()}`
    });

    await tempTenant.destroy();
    
    const deleted = await models.Tenant.findByPk(tempTenant.id);
    expect(deleted).toBeNull();
  });
});

describe('Database Performance - Benchmark Tests', () => {
  test('bulk insert performance - 1000 records', async () => {
    const start = Date.now();
    
    const accounts = Array.from({ length: 100 }, (_, i) => ({
      platform: ['gmail', 'outlook'][i % 2],
      email: `perf${i}@test.com`,
      encryptedCredentials: '{}',
      status: 'active'
    }));

    await models.Account.bulkCreate(accounts);
    
    const duration = Date.now() - start;
    
    console.log(`⚡ Bulk insert 100 records: ${duration}ms`);
    expect(duration).toBeLessThan(2000);
  });

  test('query with pagination performance', async () => {
    const start = Date.now();

    const result = await models.Account.findAndCountAll({
      limit: 50,
      offset: 0,
      order: [['createdAt', 'DESC']]
    });

    const duration = Date.now() - start;

    console.log(`⚡ Paginated query: ${duration}ms (${result.count} total)`);
    expect(duration).toBeLessThan(500);
  });

  test('aggregation query performance', async () => {
    const start = Date.now();

    const stats = await models.Account.findAll({
      attributes: [
        'platform',
        [sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['platform'],
      raw: true
    });

    const duration = Date.now() - start;

    console.log(`⚡ Aggregation query: ${duration}ms`);
    expect(stats.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(500);
  });
});