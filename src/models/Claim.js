// A problem the buyer reports after delivery / collection, within the claim window (AFA-CLM-000001).
//   open -> (seller accepts) resolved | awaiting_return -> resolved
//        -> (seller rejects) rejected -> (buyer escalates) escalated | (too late) closed
//        -> (seller does not reply) escalated -> (admin) resolved | closed
// While a claim is active the seller order is not completed and the payout stays held.
const { CLAIM_STATUS, CLAIM_REASONS } = require('../config/refunds');

module.exports = (sequelize, DataTypes) => {
  const money = { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 };
  const Claim = sequelize.define(
    'Claim',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      claimNumber: { type: DataTypes.STRING(30), allowNull: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      buyerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      reason: { type: DataTypes.ENUM(...Object.keys(CLAIM_REASONS)), allowNull: false },
      description: { type: DataTypes.STRING(1000), allowNull: false },
      status: { type: DataTypes.ENUM(...Object.values(CLAIM_STATUS)), allowNull: false, defaultValue: CLAIM_STATUS.OPEN },
      itemsAmount: money,
      deliveryAmount: money,
      vatAmount: money,
      maxRefund: money,
      refundAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      returnRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      sellerRespondBy: { type: DataTypes.DATE, allowNull: true },
      escalateBy: { type: DataTypes.DATE, allowNull: true },
      sellerRespondedAt: { type: DataTypes.DATE, allowNull: true },
      sellerNote: { type: DataTypes.STRING(500), allowNull: true },
      escalatedAt: { type: DataTypes.DATE, allowNull: true },
      escalatedBy: { type: DataTypes.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: true },
      escalationNote: { type: DataTypes.STRING(500), allowNull: true },
      decision: { type: DataTypes.ENUM('refund', 'no_refund'), allowNull: true },
      decidedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      decisionNote: { type: DataTypes.STRING(500), allowNull: true },
      buyerReturnedAt: { type: DataTypes.DATE, allowNull: true },
      returnNote: { type: DataTypes.STRING(500), allowNull: true },
      returnReceivedAt: { type: DataTypes.DATE, allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true },
      closeReason: { type: DataTypes.STRING(500), allowNull: true },
      refundId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'claims' }
  );

  Claim.associate = (models) => {
    Claim.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    Claim.belongsTo(models.SellerOrder, { as: 'sellerOrder', foreignKey: 'sellerOrderId' });
    Claim.hasMany(models.ClaimItem, { as: 'items', foreignKey: 'claimId' });
    Claim.hasMany(models.ClaimMessage, { as: 'messages', foreignKey: 'claimId' });
    Claim.hasMany(models.ClaimPhoto, { as: 'photos', foreignKey: 'claimId' });
  };

  return Claim;
};
