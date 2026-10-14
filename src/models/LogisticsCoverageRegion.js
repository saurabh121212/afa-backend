// Link table: which regions a logistics provider serves (Step 2 "Coverage Area").
module.exports = (sequelize, DataTypes) => {
  const LogisticsCoverageRegion = sequelize.define(
    'LogisticsCoverageRegion',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      logisticsProfileId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    {
      tableName: 'logistics_coverage_regions',
      indexes: [
        {
          unique: true,
          fields: ['logistics_profile_id', 'region_id'],
          name: 'logistics_coverage_profile_region_unique',
        },
      ],
    }
  );

  return LogisticsCoverageRegion;
};
