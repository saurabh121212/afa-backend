// One day of observed weather for an inkhundla (built from the hourly current weather).
// Kept for later use: market intelligence, phase 2 loans (farm risk).
module.exports = (sequelize, DataTypes) => {
  // a NEW object for every column: Sequelize changes the object it is given
  const dec = (p, s) => ({ type: DataTypes.DECIMAL(p, s), allowNull: true });
  const WeatherDailyHistory = sequelize.define(
    'WeatherDailyHistory',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      locationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      date: { type: DataTypes.DATEONLY, allowNull: false }, // Eswatini date
      tempMin: dec(5, 2),
      tempMax: dec(5, 2),
      rainMm: { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
      humidityAvg: dec(5, 2),
      samples: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      lastObservedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'weather_daily_history', freezeTableName: true }
  );

  WeatherDailyHistory.associate = (models) => {
    WeatherDailyHistory.belongsTo(models.Location, { as: 'location', foreignKey: 'locationId' });
  };

  return WeatherDailyHistory;
};
