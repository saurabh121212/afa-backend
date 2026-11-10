// Money AFA pays back to the buyer (AFA-REF-000001). Paid manually by the admin for now:
//   pending -> paid (admin enters the bank reference, optional proof)
//           -> failed (e.g. wrong account) -> the buyer fixes the bank details -> pending again
// bankDetails = copy of the buyer's account; null = the buyer still has to add it.
const { REFUND_STATUS, REFUND_SOURCES } = require('../config/refunds');

module.exports = (sequelize, DataTypes) => {
  // a NEW object for every column: Sequelize changes the object it is given, so one object shared by
  // several columns would map them all to the first column's name
  const money = () => ({ type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
  const Refund = sequelize.define(
    'Refund',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      refundNumber: { type: DataTypes.STRING(30), allowNull: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      claimId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      cancellationRequestId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      buyerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      source: { type: DataTypes.ENUM(...Object.keys(REFUND_SOURCES)), allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: true },
      amount: money(),
      itemsAmount: money(),
      deliveryAmount: money(),
      vatAmount: money(),
      status: { type: DataTypes.ENUM(...Object.values(REFUND_STATUS)), allowNull: false, defaultValue: REFUND_STATUS.PENDING },
      method: { type: DataTypes.ENUM('bank_transfer'), allowNull: false, defaultValue: 'bank_transfer' },
      bankDetails: { type: DataTypes.JSON, allowNull: true },
      dueBy: { type: DataTypes.DATE, allowNull: true },
      recoverFromSeller: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      createdByType: { type: DataTypes.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: false },
      createdById: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      paidOn: { type: DataTypes.DATEONLY, allowNull: true },
      paidBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      bankReference: { type: DataTypes.STRING(100), allowNull: true },
      adminNote: { type: DataTypes.STRING(500), allowNull: true },
      proofPath: { type: DataTypes.STRING(255), allowNull: true },
      proofOriginalName: { type: DataTypes.STRING(255), allowNull: true },
      proofMimeType: { type: DataTypes.STRING(50), allowNull: true },
      proofSizeBytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      failedAt: { type: DataTypes.DATE, allowNull: true },
      failedReason: { type: DataTypes.STRING(500), allowNull: true },
    },
    { tableName: 'refunds' }
  );

  Refund.associate = (models) => {
    Refund.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    Refund.belongsTo(models.SellerOrder, { as: 'sellerOrder', foreignKey: 'sellerOrderId' });
    Refund.belongsTo(models.Claim, { as: 'claim', foreignKey: 'claimId' });
  };

  return Refund;
};
