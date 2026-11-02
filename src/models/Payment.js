// A payment attempt for an order.
//   bank_transfer: buyer uploads proof -> under_review -> admin: succeeded | rejected
//   online:        gateway -> pending -> succeeded | failed (| expired when the order is cancelled)
module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    'Payment',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      method: { type: DataTypes.ENUM('bank_transfer', 'online'), allowNull: false },
      provider: { type: DataTypes.STRING(30), allowNull: true },
      status: {
        type: DataTypes.ENUM('pending', 'under_review', 'succeeded', 'failed', 'rejected', 'expired'),
        allowNull: false,
        defaultValue: 'pending',
      },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      amountPaid: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      paidOn: { type: DataTypes.DATEONLY, allowNull: true },
      bankReference: { type: DataTypes.STRING(100), allowNull: true },
      buyerNote: { type: DataTypes.STRING(500), allowNull: true },
      receiptPath: { type: DataTypes.STRING(255), allowNull: true },
      receiptOriginalName: { type: DataTypes.STRING(255), allowNull: true },
      receiptMimeType: { type: DataTypes.STRING(50), allowNull: true },
      receiptSizeBytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      providerReference: { type: DataTypes.STRING(150), allowNull: true },
      providerPayload: { type: DataTypes.JSON, allowNull: true },
      redirectUrl: { type: DataTypes.STRING(500), allowNull: true },
      reviewedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'payments' }
  );

  Payment.associate = (models) => {
    Payment.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    Payment.belongsTo(models.Admin, { as: 'reviewer', foreignKey: 'reviewedBy' });
  };

  return Payment;
};
