// Loads every model file in this folder (and in its module sub-folders, e.g. chat/) and links them together.
// Anywhere in the app:  const { Admin } = require('../models');
const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const db = {};

// Sub-folders holding one module's models (kept apart from the core models)
const MODULE_FOLDERS = ['chat'];

const loadFolder = (dir) =>
  fs
    .readdirSync(dir)
    .filter((file) => file !== 'index.js' && file.endsWith('.js'))
    .forEach((file) => {
      const model = require(path.join(dir, file))(sequelize, DataTypes);
      db[model.name] = model;
    });

loadFolder(__dirname);
MODULE_FOLDERS.forEach((folder) => loadFolder(path.join(__dirname, folder)));

// Set up relationships (hasMany, belongsTo...) once all models are loaded.
Object.values(db).forEach((model) => {
  if (typeof model.associate === 'function') model.associate(db);
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
