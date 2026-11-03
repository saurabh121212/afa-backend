// Buyer asks to cancel a seller order after the seller confirmed it (before dispatch).
//   pending -> accepted (seller) | declined (seller) | withdrawn (buyer)
//           -> escalated (seller did not answer in time) -> approved | rejected (admin)
// accepted / approved = the seller order is cancelled and the buyer gets a full refund.
const { CANCEL_REQUEST_STATUS } = require('../config/refunds');

module.exports = (sequelize, DataTypes) => {
  const CancellationRequest = sequelize.define(
    'CancellationRequest',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      buyerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(CANCEL_REQUEST_STATUS)),
        allowNull: false,
        defaultValue: CANCEL_REQUEST_STATUS.PENDING,
      },
      respondBy: { type: DataTypes.DATE, allowNull: true },
      respondedAt: { type: DataTypes.DATE, allowNull: true },
      responseNote: { type: DataTypes.STRING(500), allowNull: true },
      escalatedAt: { type: DataTypes.DATE, allowNull: true },
      decidedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      decisionNote: { type: DataTypes.STRING(500), allowNull: true },
    },
    { tableName: 'cancellation_requests' }
  );

  CancellationRequest.associate = (models) => {
    CancellationRequest.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    CancellationRequest.belongsTo(models.SellerOrder, { as: 'sellerOrder', foreignKey: 'sellerOrderId' });
  };

  return CancellationRequest;
};
