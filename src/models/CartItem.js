// One listing in a buyer's cart. quantity is in the listing's price unit (e.g. kg).
// Removing it only sets deleted_at; adding the same listing again restores the row.
module.exports = (sequelize, DataTypes) => {
  const CartItem = sequelize.define(
    'CartItem',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      listingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      quantity: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      savedForLater: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      priceAtAdd: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    },
    { tableName: 'cart_items', paranoid: true }
  );

  CartItem.associate = (models) => {
    CartItem.belongsTo(models.User, { as: 'buyer', foreignKey: 'userId' });
    CartItem.belongsTo(models.Listing, { as: 'listing', foreignKey: 'listingId' });
  };

  return CartItem;
};
