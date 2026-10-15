// A photo of a listing. sortOrder 0 = cover photo. Files are public:
// uploads/public/listings/<listingId>/<file>  ->  /uploads/listings/<listingId>/<file>
module.exports = (sequelize, DataTypes) => {
  const ListingPhoto = sequelize.define(
    'ListingPhoto',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      listingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      filePath: { type: DataTypes.STRING(255), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: true },
      mimeType: { type: DataTypes.STRING(50), allowNull: false },
      sizeBytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sortOrder: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'listing_photos',
      paranoid: true, // removing a photo only sets deleted_at
    }
  );

  ListingPhoto.associate = (models) => {
    ListingPhoto.belongsTo(models.Listing, { as: 'listing', foreignKey: 'listingId' });
  };

  return ListingPhoto;
};
