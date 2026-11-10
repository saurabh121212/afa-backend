// A document AFA issues: invoice (per seller order), credit note (per refund) or receipt
// (per paid checkout). "data" is a frozen copy of everything printed on it. Never edited or deleted.
module.exports = (sequelize, DataTypes) => {
  // a NEW object for every column: Sequelize changes the object it is given, so one object shared by
  // several columns would map them all to the first column's name
  const money = () => ({ type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
  const Invoice = sequelize.define(
    'Invoice',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      type: { type: DataTypes.ENUM('invoice', 'credit_note', 'receipt'), allowNull: false },
      number: { type: DataTypes.STRING(30), allowNull: false },
      isTaxInvoice: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      refundId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      paymentId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      relatedInvoiceId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      buyerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      issuedAt: { type: DataTypes.DATE, allowNull: false },
      subtotal: money(),
      vatTotal: money(),
      total: money(),
      currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'SZL' },
      data: { type: DataTypes.JSON, allowNull: false },
    },
    { tableName: 'invoices' }
  );

  Invoice.associate = (models) => {
    Invoice.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    Invoice.belongsTo(models.SellerOrder, { as: 'sellerOrder', foreignKey: 'sellerOrderId' });
    Invoice.belongsTo(models.Refund, { as: 'refund', foreignKey: 'refundId' });
    Invoice.belongsTo(models.Invoice, { as: 'relatedInvoice', foreignKey: 'relatedInvoiceId' });
  };

  return Invoice;
};
