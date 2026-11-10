// The part of a checkout that one seller fulfils (AFA-ORD-000123-1). Has its own status.
const { SELLER_ORDER_STATUS } = require('../config/orders');

module.exports = (sequelize, DataTypes) => {
  // a NEW object for every column: Sequelize changes the object it is given, so one object shared by
  // several columns would map them all to the first column's name
  const money = () => ({ type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
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
      fulfilment: { type: DataTypes.ENUM('pickup', 'delivery', 'service'), allowNull: false }, // service = a booking
      subtotal: money(),
      deliveryFee: money(),
      deliveryVat: money(),
      vatTotal: money(),
      total: money(),
      buyerNote: { type: DataTypes.STRING(500), allowNull: true },
      sellerVatRegistered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      payoutStatus: { type: DataTypes.ENUM('not_due', 'held', 'released', 'cancelled'), allowNull: false, defaultValue: 'not_due' },
      payoutAmount: money(),
      paidAt: { type: DataTypes.DATE, allowNull: true },
      confirmBy: { type: DataTypes.DATE, allowNull: true },
      confirmedAt: { type: DataTypes.DATE, allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: true }, // bookings: "In Progress"
      packedAt: { type: DataTypes.DATE, allowNull: true },
      dispatchedAt: { type: DataTypes.DATE, allowNull: true },
      readyAt: { type: DataTypes.DATE, allowNull: true },
      deliveredAt: { type: DataTypes.DATE, allowNull: true },
      completeAfter: { type: DataTypes.DATE, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },
      // Phase 4: cancellations, claims, refunds
      cancelReason: { type: DataTypes.STRING(500), allowNull: true },
      cancelledBy: { type: DataTypes.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: true },
      refundedAmount: money(),
      claimStatus: { type: DataTypes.ENUM('none', 'active', 'closed'), allowNull: false, defaultValue: 'none' },
      openCancelRequestId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      activeClaimId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'seller_orders' }
  );

  SellerOrder.associate = (models) => {
    SellerOrder.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    SellerOrder.belongsTo(models.User, { as: 'seller', foreignKey: 'sellerId' });
    SellerOrder.hasMany(models.OrderItem, { as: 'items', foreignKey: 'sellerOrderId' });
    SellerOrder.hasMany(models.CancellationRequest, { as: 'cancelRequests', foreignKey: 'sellerOrderId' });
    SellerOrder.hasMany(models.Claim, { as: 'claims', foreignKey: 'sellerOrderId' });
    SellerOrder.hasMany(models.Refund, { as: 'refunds', foreignKey: 'sellerOrderId' });
    SellerOrder.hasOne(models.Booking, { as: 'booking', foreignKey: 'sellerOrderId' });
    SellerOrder.hasOne(models.Review, { as: 'review', foreignKey: 'sellerOrderId' });
  };

  return SellerOrder;
};
