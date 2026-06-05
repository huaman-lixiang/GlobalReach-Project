const { Sequelize } = require('sequelize');
const config = require('./config')[process.env.NODE_ENV || 'sqlite'];

let sequelize;

if (process.env.NODE_ENV === 'sqlite' || !config.host) {
  sequelize = new Sequelize({
    storage: config.storage || './data/globalreach.db',
    dialect: 'sqlite',
    logging: config.logging,
    pool: config.pool,
    define: config.define
  });
} else {
  sequelize = new Sequelize(
    config.database,
    config.username,
    config.password,
    {
      host: config.host,
      port: config.port,
      dialect: config.dialect,
      logging: config.logging,
      pool: config.pool,
      dialectOptions: config.dialectOptions,
      define: config.define
    }
  );
}

async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to database:', error.message);
    return false;
  }
}

async function syncDatabase(options = { force: false, alter: false }) {
  try {
    if (options.force) {
      console.log('⚠️  Force sync enabled - dropping existing tables');
    }
    
    await sequelize.sync(options);
    console.log('✅ Database synchronized successfully');
    return true;
  } catch (error) {
    console.error('❌ Database sync failed:', error.message);
    throw error;
  }
}

async function closeConnection() {
  try {
    await sequelize.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error closing connection:', error.message);
  }
}

module.exports = {
  sequelize,
  testConnection,
  syncDatabase,
  closeConnection
};
