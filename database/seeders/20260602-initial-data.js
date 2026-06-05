'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');

    const adminPasswordHash = await bcrypt.hash('Admin@123456', 12);

    await queryInterface.bulkInsert('users', [
      {
        id: uuidv4(),
        email: 'admin@globalreach.com',
        passwordHash: adminPasswordHash,
        name: 'System Administrator',
        role: 'admin',
        status: 'active',
        loginCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: uuidv4(),
        email: 'demo@globalreach.com',
        passwordHash: await bcrypt.hash('Demo@123456', 12),
        name: 'Demo User',
        role: 'user',
        status: 'active',
        loginCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    const defaultTenantId = uuidv4();
    
    await queryInterface.bulkInsert('tenants', [
      {
        id: defaultTenantId,
        name: 'Default Organization',
        slug: 'default-org',
        plan: 'enterprise',
        status: 'active',
        config: { maxEmailsPerDay: 10000, enableTracking: true },
        maxAccounts: 100,
        maxDailySends: 5000,
        customDomain: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    console.log('✅ Seed data inserted successfully');
    console.log('   Admin user: admin@globalreach.com / Admin@123456');
    console.log('   Demo user: demo@globalreach.com / Demo@123456');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('tenants', null, {});
    await queryInterface.bulkDelete('users', null, {});
    console.log('⏪ Seed data removed');
  }
};