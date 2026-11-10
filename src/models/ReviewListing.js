// Which listings a review counts for (every listing in the reviewed seller order).
module.exports = (sequelize, DataTypes) => {
  const ReviewListing = sequelize.define(
    'ReviewListing',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      reviewId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      listingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    { tableName: 'review_listings' }
  );

  ReviewListing.associate = (models) => {
    ReviewListing.belongsTo(models.Review, { as: 'review', foreignKey: 'reviewId' });
    ReviewListing.belongsTo(models.Listing, { as: 'listing', foreignKey: 'listingId' });
  };

  return ReviewListing;
};
