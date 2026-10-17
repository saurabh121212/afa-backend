// A listing saved to a user's wishlist (the heart icon).
// Removing it only sets deleted_at; adding it again restores the same row.
module.exports = (sequelize, DataTypes) => {
  const WishlistItem = sequelize.define(
    'WishlistItem',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      listingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    {
      tableName: 'wishlist_items',
      paranoid: true,
    }
  );

  WishlistItem.associate = (models) => {
    WishlistItem.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    WishlistItem.belongsTo(models.Listing, { as: 'listing', foreignKey: 'listingId' });
  };

  return WishlistItem;
};
