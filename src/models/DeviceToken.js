// A Firebase Cloud Messaging token of one user's phone or browser.
// Removed (deleted_at) on logout, or when Firebase says the token is no longer valid.
const { PLATFORMS } = require('../config/notifications');

module.exports = (sequelize, DataTypes) => {
  const DeviceToken = sequelize.define(
    'DeviceToken',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      token: { type: DataTypes.STRING(500), allowNull: false },
      platform: { type: DataTypes.ENUM(...PLATFORMS), allowNull: false },
      deviceName: { type: DataTypes.STRING(100), allowNull: true },
      appVersion: { type: DataTypes.STRING(30), allowNull: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false },
      lastError: { type: DataTypes.STRING(255), allowNull: true },
    },
    { tableName: 'device_tokens', paranoid: true }
  );

  DeviceToken.associate = (models) => {
    DeviceToken.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
  };

  return DeviceToken;
};
