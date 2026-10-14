// Link table: which regions a financial institution serves (Step 2 "Coverage").
module.exports = (sequelize, DataTypes) => {
  const FiCoverageRegion = sequelize.define(
    'FiCoverageRegion',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      fiProfileId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    {
      tableName: 'fi_coverage_regions',
      indexes: [
        { unique: true, fields: ['fi_profile_id', 'region_id'], name: 'fi_coverage_profile_region_unique' },
      ],
    }
  );

  return FiCoverageRegion;
};
