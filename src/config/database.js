// Database settings, in the format sequelize-cli expects
// (one block per environment). Used by migrations/seeders AND by our app.
const { db } = require('./index');

const base = {
  username: db.user,
  password: db.password,
  database: db.name,
  host: db.host,
  port: db.port,
  dialect: 'mysql',
  timezone: '+00:00', // store all dates in UTC
  define: {
    underscored: true, // column names like created_at instead of createdAt
    timestamps: true, // every table gets created_at / updated_at
  },
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
};

module.exports = {
  development: { ...base, logging: console.log },
  test: { ...base, database: `${db.name}_test`, logging: false },
  production: { ...base, logging: false },
};
