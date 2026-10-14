// Farmer details: Step 1 (Personal Information) + Step 2 (Farm Information).
const {
  GENDERS,
  LAND_OWNERSHIP_TYPES,
  FARMING_ACTIVITIES,
} = require('../utils/constants');

module.exports = (sequelize, DataTypes) => {
  const FarmerProfile = sequelize.define(
    'FarmerProfile',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },

      // ---- Step 1 ----
      farmerIdTin: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      firstName: { type: DataTypes.STRING(60), allowNull: false },
      middleName: { type: DataTypes.STRING(60), allowNull: true },
      lastName: { type: DataTypes.STRING(60), allowNull: false },
      gender: { type: DataTypes.ENUM(...GENDERS), allowNull: false },
      dateOfBirth: { type: DataTypes.DATEONLY, allowNull: false },
      residentAddress: { type: DataTypes.STRING(255), allowNull: false },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      inkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      umphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

      // ---- Step 2 (optional) ----
      farmName: { type: DataTypes.STRING(150), allowNull: true },
      farmAddress: { type: DataTypes.STRING(255), allowNull: true },
      farmRegionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      farmInkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      farmUmphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      farmSizeHa: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      landOwnershipType: { type: DataTypes.ENUM(...LAND_OWNERSHIP_TYPES), allowNull: true },
      farmingActivity: { type: DataTypes.ENUM(...FARMING_ACTIVITIES), allowNull: true },
      mainCrops: { type: DataTypes.JSON, allowNull: true },
      otherCrops: { type: DataTypes.STRING(255), allowNull: true },
      productionCapacityKg: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      farmingSeasons: { type: DataTypes.JSON, allowNull: true },
    },
    { tableName: 'farmer_profiles' }
  );

  FarmerProfile.associate = (models) => {
    FarmerProfile.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });

    const loc = (as, foreignKey) =>
      FarmerProfile.belongsTo(models.Location, { as, foreignKey });
    loc('region', 'regionId');
    loc('inkhundla', 'inkhundlaId');
    loc('umphakatsi', 'umphakatsiId');
    loc('farmRegion', 'farmRegionId');
    loc('farmInkhundla', 'farmInkhundlaId');
    loc('farmUmphakatsi', 'farmUmphakatsiId');
  };

  return FarmerProfile;
};
