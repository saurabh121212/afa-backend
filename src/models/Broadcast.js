// An admin advisory / announcement sent to many users (in-app + push, no email).
//   scheduled -> sending -> sent      (or cancelled while still scheduled)
const { BROADCAST_CATEGORIES, BROADCAST_STATUS } = require('../config/notifications');

module.exports = (sequelize, DataTypes) => {
  const Broadcast = sequelize.define(
    'Broadcast',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      category: { type: DataTypes.ENUM(...Object.keys(BROADCAST_CATEGORIES)), allowNull: false },
      title: { type: DataTypes.STRING(120), allowNull: false },
      body: { type: DataTypes.STRING(1000), allowNull: false },
      linkUrl: { type: DataTypes.STRING(500), allowNull: true },
      audience: { type: DataTypes.JSON, allowNull: false },
      status: { type: DataTypes.ENUM(...Object.values(BROADCAST_STATUS)), allowNull: false, defaultValue: BROADCAST_STATUS.SCHEDULED },
      scheduledAt: { type: DataTypes.DATE, allowNull: false },
      startedAt: { type: DataTypes.DATE, allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      recipientCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      pushSentCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      pushFailedCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      cancelledBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'broadcasts' }
  );

  Broadcast.associate = (models) => {
    Broadcast.hasMany(models.Notification, { as: 'notifications', foreignKey: 'broadcastId' });
  };

  return Broadcast;
};
