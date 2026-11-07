// One checkout: everything the buyer paid for in one go (AFA-ORD-000123).
// Split into one SellerOrder per seller. Never deleted.
const { ORDER_STATUS, PAYMENT_METHODS, ORDER_KINDS } = require('../config/orders');

module.exports = (sequelize, DataTypes) => {
  const money = () => ({ type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
  const Order = sequelize.define(
    'Order',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      orderNumber: { type: DataTypes.STRING(30), allowNull: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      kind: { type: DataTypes.ENUM(...Object.keys(ORDER_KINDS)), allowNull: false, defaultValue: 'product' }, // product | booking
      status: { type: DataTypes.ENUM(...Object.values(ORDER_STATUS)), allowNull: false, defaultValue: ORDER_STATUS.AWAITING_PAYMENT },
      paymentMethod: { type: DataTypes.ENUM(...Object.keys(PAYMENT_METHODS)), allowNull: false },
      paymentDeadline: { type: DataTypes.DATE, allowNull: true },
      deliveryAddress: { type: DataTypes.JSON, allowNull: true },
      subtotal: money(),
      deliveryTotal: money(),
      vatTotal: money(),
      total: money(),
      vatRate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'SZL' },
      idempotencyKey: { type: DataTypes.STRING(100), allowNull: true },
      termsAcceptedAt: { type: DataTypes.DATE, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },
      cancelReason: { type: DataTypes.STRING(500), allowNull: true },
      cancelledBy: { type: DataTypes.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: true },
    },
    { tableName: 'orders' }
  );

  Order.associate = (models) => {
    Order.belongsTo(models.User, { as: 'buyer', foreignKey: 'userId' });
    Order.hasMany(models.SellerOrder, { as: 'sellerOrders', foreignKey: 'orderId' });
    Order.hasMany(models.OrderItem, { as: 'items', foreignKey: 'orderId' });
    Order.hasMany(models.Payment, { as: 'payments', foreignKey: 'orderId' });
    Order.hasMany(models.OrderStatusHistory, { as: 'history', foreignKey: 'orderId' });
    Order.hasMany(models.Refund, { as: 'refunds', foreignKey: 'orderId' });
    Order.hasOne(models.Booking, { as: 'booking', foreignKey: 'orderId' });
  };

  return Order;
};
