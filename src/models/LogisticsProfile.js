// Logistics Provider details: Step 1 (Business Information) + Step 2 (Business Location),
// plus the regions served (coverage area) through LogisticsCoverageRegion.
const { BUSINESS_TYPES, LOGISTICS_SERVICE_TYPES, LOGISTICS_DESIGNATIONS } = require('../utils/constants');

module.exports = (sequelize, DataTypes) => {
  const LogisticsProfile = sequelize.define(
    'LogisticsProfile',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },

      // ---- Step 1 ----
      businessName: { type: DataTypes.STRING(150), allowNull: false },
      registrationNumberTin: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      businessType: { type: DataTypes.ENUM(...BUSINESS_TYPES), allowNull: false },
      serviceType: { type: DataTypes.ENUM(...LOGISTICS_SERVICE_TYPES), allowNull: false },
      contactFirstName: { type: DataTypes.STRING(60), allowNull: false },
      contactLastName: { type: DataTypes.STRING(60), allowNull: false },
      designation: { type: DataTypes.ENUM(...LOGISTICS_DESIGNATIONS), allowNull: false },

      // ---- Step 2 (optional) ----
      businessAddress: { type: DataTypes.STRING(255), allowNull: true },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      inkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      umphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

      // ---- Step 4 ----
      authorizationConfirmedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'logistics_profiles' }
  );

  LogisticsProfile.associate = (models) => {
    LogisticsProfile.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    LogisticsProfile.belongsTo(models.Location, { as: 'region', foreignKey: 'regionId' });
    LogisticsProfile.belongsTo(models.Location, { as: 'inkhundla', foreignKey: 'inkhundlaId' });
    LogisticsProfile.belongsTo(models.Location, { as: 'umphakatsi', foreignKey: 'umphakatsiId' });

    // Regions served: many-to-many with "locations" through logistics_coverage_regions
    LogisticsProfile.belongsToMany(models.Location, {
      through: models.LogisticsCoverageRegion,
      as: 'coverageRegions',
      foreignKey: 'logisticsProfileId',
      otherKey: 'regionId',
    });
  };

  return LogisticsProfile;
};
