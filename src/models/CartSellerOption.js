// The buyer's Pickup / Delivery choice for one seller group in the cart.
// No soft delete needed: it is a setting that is simply overwritten.
module.exports = (sequelize, DataTypes) => {
  const CartSellerOption = sequelize.define(
    'CartSellerOption',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      fulfilment: { type: DataTypes.ENUM('pickup', 'delivery'), allowNull: false },
    },
    { tableName: 'cart_seller_options' }
  );
  return CartSellerOption;
};
