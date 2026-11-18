// Region / Inkhundla / Umphakatsi (one table, linked by parentId).
// Regions and tinkhundla also have coordinates for the weather (see services/weather.service.js).
//
//   isActive  -> false = "disabled": hidden from dropdowns, existing users keep it
//   deletedAt -> soft delete (paranoid): hidden everywhere, row kept in the database
const { LOCATION_TYPES } = require('../utils/constants');

module.exports = (sequelize, DataTypes) => {
  const Location = sequelize.define(
    'Location',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: { notEmpty: true },
      },
      type: {
        type: DataTypes.ENUM(...LOCATION_TYPES),
        allowNull: false,
      },
      parentId: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Weather: coordinates (regions and tinkhundla). null = not known yet.
      // MySQL returns DECIMAL as text ("-26.316667"); weather.service turns them into numbers.
      latitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
      longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
      coordinatesSource: { type: DataTypes.ENUM('seed', 'geocoded', 'manual'), allowNull: true },
      coordinatesCheckedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'locations',
      paranoid: true, // destroy() only sets deleted_at (no hard delete)
    }
  );

  Location.associate = (models) => {
    Location.belongsTo(models.Location, { as: 'parent', foreignKey: 'parentId' });
    Location.hasMany(models.Location, { as: 'children', foreignKey: 'parentId' });
  };

  return Location;
};
