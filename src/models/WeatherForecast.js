// One 3-hour step of an inkhundla's 5-day forecast (all steps of a place are replaced every 3 hours).
module.exports = (sequelize, DataTypes) => {
  // a NEW object for every column: Sequelize changes the object it is given
  const dec = (p, s) => ({ type: DataTypes.DECIMAL(p, s), allowNull: true });
  const WeatherForecast = sequelize.define(
    'WeatherForecast',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      locationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      forecastAt: { type: DataTypes.DATE, allowNull: false },
      temp: dec(5, 2),
      feelsLike: dec(5, 2),
      tempMin: dec(5, 2),
      tempMax: dec(5, 2),
      humidity: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      windSpeed: dec(5, 2), // m/s
      windDeg: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      windGust: dec(5, 2),
      clouds: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      pop: dec(3, 2), // chance of rain 0-1
      rain3h: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'rain_3h' },
      conditionId: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      conditionMain: { type: DataTypes.STRING(40), allowNull: true },
      description: { type: DataTypes.STRING(100), allowNull: true },
      icon: { type: DataTypes.STRING(10), allowNull: true },
      fetchedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: 'weather_forecasts' }
  );

  WeatherForecast.associate = (models) => {
    WeatherForecast.belongsTo(models.Location, { as: 'location', foreignKey: 'locationId' });
  };

  return WeatherForecast;
};
