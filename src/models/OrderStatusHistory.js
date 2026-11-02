// Order timeline: one row per status change (checkout or seller order).
module.exports = (sequelize, DataTypes) => {
  const OrderStatusHistory = sequelize.define(
    'OrderStatusHistory',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      fromStatus: { type: DataTypes.STRING(30), allowNull: true },
      toStatus: { type: DataTypes.STRING(30), allowNull: false },
      actorType: { type: DataTypes.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: false },
      actorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
    },
    { tableName: 'order_status_history', updatedAt: false }
  );
  return OrderStatusHistory;
};
