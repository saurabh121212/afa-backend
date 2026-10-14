// Trader details: Step 1 (Business Information) + Step 2 (Business Address & License).
const {
  BUSINESS_TYPES,
  DESIGNATIONS,
  LICENSE_ISSUING_AUTHORITIES,
  TRADER_BUSINESS_CATEGORIES,
} = require('../utils/constants');

module.exports = (sequelize, DataTypes) => {
  const TraderProfile = sequelize.define(
    'TraderProfile',
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
      businessCategory: { type: DataTypes.ENUM(...TRADER_BUSINESS_CATEGORIES), allowNull: false },
      contactFirstName: { type: DataTypes.STRING(60), allowNull: false },
      contactLastName: { type: DataTypes.STRING(60), allowNull: false },
      designation: { type: DataTypes.ENUM(...DESIGNATIONS), allowNull: false },

      // ---- Step 2 (optional) ----
      businessAddress: { type: DataTypes.STRING(255), allowNull: true },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      inkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      umphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      tradingLicenseNumber: { type: DataTypes.STRING(50), allowNull: true },
      licenseIssuingAuthority: { type: DataTypes.ENUM(...LICENSE_ISSUING_AUTHORITIES), allowNull: true },
      licenseExpiryDate: { type: DataTypes.DATEONLY, allowNull: true },
      yearsInOperation: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },

      // ---- Step 4 ----
      authorizationConfirmedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'trader_profiles' }
  );

  TraderProfile.associate = (models) => {
    TraderProfile.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    TraderProfile.belongsTo(models.Location, { as: 'region', foreignKey: 'regionId' });
    TraderProfile.belongsTo(models.Location, { as: 'inkhundla', foreignKey: 'inkhundlaId' });
    TraderProfile.belongsTo(models.Location, { as: 'umphakatsi', foreignKey: 'umphakatsiId' });
  };

  return TraderProfile;
};
