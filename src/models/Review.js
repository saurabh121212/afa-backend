// A buyer's review of a completed seller order (or service booking): 1-5 stars + comment.
// Counts for the seller and every listing in that order (ReviewListing). Never deleted (soft delete only).
const { REVIEW_STATUS } = require('../config/reviews');

module.exports = (sequelize, DataTypes) => {
  const Review = sequelize.define(
    'Review',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      buyerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      isBooking: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      rating: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
      comment: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM(...Object.values(REVIEW_STATUS)), allowNull: false, defaultValue: REVIEW_STATUS.PUBLISHED },
      holdReasons: { type: DataTypes.JSON, allowNull: true },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
      editCount: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      editedAt: { type: DataTypes.DATE, allowNull: true },
      reply: { type: DataTypes.TEXT, allowNull: true },
      repliedAt: { type: DataTypes.DATE, allowNull: true },
      hiddenReason: { type: DataTypes.STRING(500), allowNull: true },
      hiddenAt: { type: DataTypes.DATE, allowNull: true },
      hiddenBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      openReports: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      lastReportedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'reviews', paranoid: true }
  );

  Review.associate = (models) => {
    Review.belongsTo(models.SellerOrder, { as: 'sellerOrder', foreignKey: 'sellerOrderId' });
    Review.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    Review.belongsTo(models.User, { as: 'buyer', foreignKey: 'buyerId' });
    Review.belongsTo(models.User, { as: 'seller', foreignKey: 'sellerId' });
    Review.hasMany(models.ReviewListing, { as: 'listings', foreignKey: 'reviewId' });
    Review.hasMany(models.ReviewReport, { as: 'reports', foreignKey: 'reviewId' });
  };

  return Review;
};
