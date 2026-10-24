// A saved delivery address of a user (Figma "Saved Addresses"). Soft delete (deleted_at).
module.exports = (sequelize, DataTypes) => {
  const Address = sequelize.define(
    'Address',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      label: { type: DataTypes.STRING(30), allowNull: false },
      contactName: { type: DataTypes.STRING(150), allowNull: false },
      phone: { type: DataTypes.STRING(20), allowNull: false },
      addressLine: { type: DataTypes.STRING(255), allowNull: false },
      landmark: { type: DataTypes.STRING(255), allowNull: true },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      inkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      umphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'addresses',
      paranoid: true,
    }
  );

  Address.associate = (models) => {
    Address.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    Address.belongsTo(models.Location, { as: 'region', foreignKey: 'regionId' });
    Address.belongsTo(models.Location, { as: 'inkhundla', foreignKey: 'inkhundlaId' });
    Address.belongsTo(models.Location, { as: 'umphakatsi', foreignKey: 'umphakatsiId' });
  };

  return Address;
};
