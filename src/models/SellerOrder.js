// The part of a checkout that one seller fulfils (AFA-ORD-000123-1). Has its own status.
const { SELLER_ORDER_STATUS } = require('../config/orders');

module.exports = (sequelize, DataTypes) => {
  const money = { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 };
  const SellerOrder = sequelize.define(
    'SellerOrder',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderNumber: { type: DataTypes.STRING(40), allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(SELLER_ORDER_STATUS)),
        allowNull: false,
        defaultValue: SELLER_ORDER_STATUS.AWAITING_PAYMENT,
      },
      fulfilment: { type: DataTypes.ENUM('pickup', 'delivery'), allowNull: false },
      subtotal: money,
      deliveryFee: money,
      deliveryVat: money,
      vatTotal: money,
      total: money,
      buyerNote: { type: DataTypes.STRING(500), allowNull: true },
      sellerVatRegistered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      payoutStatus: { type: DataTypes.ENUM('not_due', 'held', 'released', 'cancelled'), allowNull: false, defaultValue: 'not_due' },
      payoutAmount: money,
      paidAt: { type: DataTypes.DATE, allowNull: true },
      confirmBy: { type: DataTypes.DATE, allowNull: true },
      confirmedAt: { type: DataTypes.DATE, allowNull: true },
      packedAt: { type: DataTypes.DATE, allowNull: true },
      dispatchedAt: { type: DataTypes.DATE, allowNull: true },
      readyAt: { type: DataTypes.DATE, allowNull: true },
      deliveredAt: { type: DataTypes.DATE, allowNull: true },
      completeAfter: { type: DataTypes.DATE, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'seller_orders' }
  );

  SellerOrder.associate = (models) => {
    SellerOrder.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    SellerOrder.belongsTo(models.User, { as: 'seller', foreignKey: 'sellerId' });
    SellerOrder.hasMany(models.OrderItem, { as: 'items', foreignKey: 'sellerOrderId' });
  };

  return SellerOrder;
};
