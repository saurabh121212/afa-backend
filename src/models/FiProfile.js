// Financial Institution details: Step 1 (Institution Information) + Step 2 (Regulatory Details),
// plus the regions served (coverage) through FiCoverageRegion.
const {
  FI_INSTITUTION_TYPES,
  FI_PRODUCT_TYPES,
  FI_DESIGNATIONS,
  FI_REGULATORY_BODIES,
} = require('../utils/constants');

module.exports = (sequelize, DataTypes) => {
  const FiProfile = sequelize.define(
    'FiProfile',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },

      // ---- Step 1 ----
      institutionName: { type: DataTypes.STRING(150), allowNull: false },
      registrationNumberTin: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      institutionType: { type: DataTypes.ENUM(...FI_INSTITUTION_TYPES), allowNull: false },
      productType: { type: DataTypes.ENUM(...FI_PRODUCT_TYPES), allowNull: false },
      contactFirstName: { type: DataTypes.STRING(60), allowNull: false },
      contactLastName: { type: DataTypes.STRING(60), allowNull: false },
      designation: { type: DataTypes.ENUM(...FI_DESIGNATIONS), allowNull: false },

      // ---- Step 2 (optional) ----
      institutionAddress: { type: DataTypes.STRING(255), allowNull: true },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      inkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      umphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      regulatoryBody: { type: DataTypes.ENUM(...FI_REGULATORY_BODIES), allowNull: true },
      regulatoryBodyOther: { type: DataTypes.STRING(150), allowNull: true },
      regulatoryLicenseNumber: { type: DataTypes.STRING(50), allowNull: true },
      licenseExpiryDate: { type: DataTypes.DATEONLY, allowNull: true },
      yearsInOperation: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },

      // ---- Step 4 ----
      authorizationConfirmedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'fi_profiles' }
  );

  FiProfile.associate = (models) => {
    FiProfile.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    FiProfile.belongsTo(models.Location, { as: 'region', foreignKey: 'regionId' });
    FiProfile.belongsTo(models.Location, { as: 'inkhundla', foreignKey: 'inkhundlaId' });
    FiProfile.belongsTo(models.Location, { as: 'umphakatsi', foreignKey: 'umphakatsiId' });

    // Regions served: many-to-many with "locations" through fi_coverage_regions
    FiProfile.belongsToMany(models.Location, {
      through: models.FiCoverageRegion,
      as: 'coverageRegions',
      foreignKey: 'fiProfileId',
      otherKey: 'regionId',
    });
  };

  return FiProfile;
};
