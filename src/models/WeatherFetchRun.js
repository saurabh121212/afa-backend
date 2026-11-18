// One run of the weather job (or an admin refresh): what was fetched, calls used, errors.
module.exports = (sequelize, DataTypes) => {
  const count = () => ({ type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
  const WeatherFetchRun = sequelize.define(
    'WeatherFetchRun',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      kind: { type: DataTypes.ENUM('current', 'forecast', 'geocode', 'location'), allowNull: false },
      triggeredBy: { type: DataTypes.ENUM('schedule', 'admin', 'coordinates'), allowNull: false, defaultValue: 'schedule' }, // column triggered_by
      status: { type: DataTypes.ENUM('running', 'success', 'partial', 'failed'), allowNull: false, defaultValue: 'running' },
      points: count(),
      succeeded: count(),
      failed: count(),
      calls: count(),
      error: { type: DataTypes.STRING(1000), allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: false },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'weather_fetch_runs' }
  );
  return WeatherFetchRun;
};
