const Sequelize = require('sequelize');
const config = require('../config/config')[process.env.NODE_ENV || 'sqlite'];

const sequelize = new Sequelize(
  config.database || './data/globalreach.db',
  config.username || null,
  config.password || null,
  {
    host: config.host,
    port: config.port,
    dialect: config.dialect || 'sqlite',
    storage: config.storage,
    logging: config.logging || false,
    pool: config.pool || { max: 5, min: 0 },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  }
);

const db = {};

db.User = require('./User')(sequelize);
db.Account = require('./Account')(sequelize);
db.Tenant = require('./Tenant')(sequelize);
db.Campaign = require('./Campaign')(sequelize);
db.EmailLog = require('./EmailLog')(sequelize);
db.Statistic = require('./Statistics')(sequelize);

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;