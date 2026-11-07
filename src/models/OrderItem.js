// One product line of an order: a COPY of the listing at ordering time
// (later listing edits never change an order).
module.exports = (sequelize, DataTypes) => {
  const money = () => ({ type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
  const OrderItem = sequelize.define(
    'OrderItem',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      listingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      photoUrl: { type: DataTypes.STRING(255), allowNull: true },
      categoryName: { type: DataTypes.STRING(100), allowNull: true },
      subCategoryName: { type: DataTypes.STRING(100), allowNull: true },
      unit: { type: DataTypes.STRING(30), allowNull: true },
      unitLabel: { type: DataTypes.STRING(50), allowNull: true },
      unitPrice: money(),
      quantity: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      lineTotal: money(),
      isVatApplicable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      vatAmount: money(),
      refundPolicy: { type: DataTypes.STRING(30), allowNull: true },
      nonReturnable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      pickupLocation: { type: DataTypes.JSON, allowNull: true },
    },
    { tableName: 'order_items' }
  );

  OrderItem.associate = (models) => {
    OrderItem.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    OrderItem.belongsTo(models.SellerOrder, { as: 'sellerOrder', foreignKey: 'sellerOrderId' });
    OrderItem.belongsTo(models.Listing, { as: 'listing', foreignKey: 'listingId' });
  };

  return OrderItem;
};
