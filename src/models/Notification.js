// One notification for one recipient: a user, or one admin (admin bell).
// Never removed by the system. A user "deleting" it only hides it (paranoid -> deleted_at).
const { CATEGORIES, PUSH_STATUS } = require('../config/notifications');

module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    'Notification',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      recipientType: { type: DataTypes.ENUM('user', 'admin'), allowNull: false },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      adminId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      category: { type: DataTypes.ENUM(...Object.keys(CATEGORIES)), allowNull: false },
      type: { type: DataTypes.STRING(50), allowNull: false },
      title: { type: DataTypes.STRING(150), allowNull: false },
      body: { type: DataTypes.STRING(1000), allowNull: false },
      data: { type: DataTypes.JSON, allowNull: true },
      broadcastId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      readAt: { type: DataTypes.DATE, allowNull: true },
      pushStatus: { type: DataTypes.ENUM(...Object.values(PUSH_STATUS)), allowNull: false, defaultValue: PUSH_STATUS.PENDING },
      pushedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'notifications', paranoid: true }
  );

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    Notification.belongsTo(models.Broadcast, { as: 'broadcast', foreignKey: 'broadcastId' });
  };

  return Notification;
};
