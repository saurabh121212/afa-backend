// A marketplace listing: a product (farmer / trader) or a service (logistics provider).
// Only status "active" is shown on the website. Soft delete (deleted_at).
const { LISTING_KINDS, LISTING_STATUS } = require('../config/listingOptions');

// Note: MySQL returns DECIMAL columns as text ("5.20"); listing.service.js turns them into numbers.
module.exports = (sequelize, DataTypes) => {
  const Listing = sequelize.define(
    'Listing',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      kind: { type: DataTypes.ENUM(...LISTING_KINDS), allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(LISTING_STATUS)),
        allowNull: false,
        defaultValue: LISTING_STATUS.DRAFT,
      },
      // Hidden because it is in a VAT category and the seller is not VAT-approved.
      // Status is not changed, so it shows again automatically once fixed.
      vatHold: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      vatHoldAt: { type: DataTypes.DATE, allowNull: true },
      categoryId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      subCategoryId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

      name: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      brand: { type: DataTypes.STRING(100), allowNull: true },
      sku: { type: DataTypes.STRING(60), allowNull: true },
      vehicleRegistration: { type: DataTypes.STRING(30), allowNull: true },
      makeModel: { type: DataTypes.STRING(100), allowNull: true },

      price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      priceUnit: { type: DataTypes.STRING(30), allowNull: true },
      currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'SZL' },

      quantity: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      quantityUnit: { type: DataTypes.STRING(30), allowNull: true },
      minOrderQuantity: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      minOrderUnit: { type: DataTypes.STRING(30), allowNull: true },

      capacity: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      capacityUnit: { type: DataTypes.STRING(30), allowNull: true },
      minBooking: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      minBookingUnit: { type: DataTypes.STRING(30), allowNull: true },

      availability: { type: DataTypes.STRING(20), allowNull: true },
      availableFrom: { type: DataTypes.DATEONLY, allowNull: true },

      deliveryType: { type: DataTypes.STRING(20), allowNull: true },
      deliveryDuration: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      deliveryDurationUnit: { type: DataTypes.STRING(20), allowNull: true },
      logisticsBy: { type: DataTypes.STRING(10), allowNull: true },
      // Delivery fee per region: [{ regionId, fee }]. Region not listed = no delivery there.
      deliveryFees: { type: DataTypes.JSON, allowNull: true },
      nonReturnable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      advanceNotice: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      advanceNoticeUnit: { type: DataTypes.STRING(20), allowNull: true },
      coverageRegionIds: { type: DataTypes.JSON, allowNull: true },

      useRegisteredAddress: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      address: { type: DataTypes.STRING(255), allowNull: true },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      inkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      umphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

      submittedAt: { type: DataTypes.DATE, allowNull: true },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      reviewedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      statusReason: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'listings',
      paranoid: true, // destroy() only sets deleted_at (no hard delete)
    }
  );

  Listing.associate = (models) => {
    Listing.belongsTo(models.User, { as: 'seller', foreignKey: 'userId' });
    Listing.belongsTo(models.Category, { as: 'category', foreignKey: 'categoryId' });
    Listing.belongsTo(models.Category, { as: 'subCategory', foreignKey: 'subCategoryId' });
    Listing.belongsTo(models.Location, { as: 'region', foreignKey: 'regionId' });
    Listing.belongsTo(models.Location, { as: 'inkhundla', foreignKey: 'inkhundlaId' });
    Listing.belongsTo(models.Location, { as: 'umphakatsi', foreignKey: 'umphakatsiId' });
    Listing.hasMany(models.ListingPhoto, { as: 'photos', foreignKey: 'listingId' });
  };

  return Listing;
};
