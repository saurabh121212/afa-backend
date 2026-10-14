// Creates the single Sequelize instance the whole app shares.
const { Sequelize } = require('sequelize');
const { env } = require('../config');
const dbConfig = require('../config/database')[env];

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  dbConfig
);

// Checks that MySQL is reachable and the credentials are correct.
async function connectDatabase() {
  await sequelize.authenticate();
  console.log(`✅ MySQL connected: ${dbConfig.database}@${dbConfig.host}`);
}

module.exports = { sequelize, connectDatabase };
