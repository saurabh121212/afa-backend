// A weather alert written by the admin. Shown to logged-in users of the covered regions while it is active.
// regionIds null = all of Eswatini. Soft delete (deleted_at).
module.exports = (sequelize, DataTypes) => {
  const WeatherAlert = sequelize.define(
    'WeatherAlert',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      title: { type: DataTypes.STRING(150), allowNull: false },
      severity: { type: DataTypes.ENUM('advisory', 'warning', 'severe'), allowNull: false, defaultValue: 'warning' },
      message: { type: DataTypes.STRING(1000), allowNull: false },
      regionIds: { type: DataTypes.JSON, allowNull: true },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      endedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'weather_alerts', paranoid: true }
  );

  WeatherAlert.associate = (models) => {
    WeatherAlert.belongsTo(models.Admin, { as: 'createdByAdmin', foreignKey: 'createdBy' });
  };

  return WeatherAlert;
};
