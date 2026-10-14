// Region / Inkhundla / Umphakatsi (one table, linked by parentId).
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
