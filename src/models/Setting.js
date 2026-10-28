// One System Setting changed by the admin (defaults live in config/settings.js).
// Never deleted: "reset" saves the default value again.
module.exports = (sequelize, DataTypes) => {
  const Setting = sequelize.define(
    'Setting',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      settingKey: { type: DataTypes.STRING(60), allowNull: false, unique: true },
      value: { type: DataTypes.JSON, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }, // admin id
    },
    { tableName: 'settings' }
  );

  Setting.associate = (models) => {
    Setting.belongsTo(models.Admin, { as: 'updatedByAdmin', foreignKey: 'updatedBy' });
  };

  return Setting;
};
