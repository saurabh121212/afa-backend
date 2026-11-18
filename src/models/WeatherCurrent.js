// Latest weather observation of one inkhundla (one row each, overwritten every hour by the weather job).
// approximate = true: the inkhundla has no coordinates yet, so its region's weather is used.
module.exports = (sequelize, DataTypes) => {
  // a NEW object for every column: Sequelize changes the object it is given
  const dec = (p, s) => ({ type: DataTypes.DECIMAL(p, s), allowNull: true });
  const WeatherCurrent = sequelize.define(
    'WeatherCurrent',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      locationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
      latitude: dec(9, 6),
      longitude: dec(9, 6),
      approximate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      observedAt: { type: DataTypes.DATE, allowNull: true },
      temp: dec(5, 2),
      feelsLike: dec(5, 2),
      tempMin: dec(5, 2),
      tempMax: dec(5, 2),
      humidity: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      pressure: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      windSpeed: dec(5, 2), // m/s
      windDeg: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      windGust: dec(5, 2),
      clouds: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      rain1h: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'rain_1h' },
      visibility: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      conditionId: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      conditionMain: { type: DataTypes.STRING(40), allowNull: true },
      description: { type: DataTypes.STRING(100), allowNull: true },
      icon: { type: DataTypes.STRING(10), allowNull: true },
      sunrise: { type: DataTypes.DATE, allowNull: true },
      sunset: { type: DataTypes.DATE, allowNull: true },
      fetchedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: 'weather_current', freezeTableName: true }
  );

  WeatherCurrent.associate = (models) => {
    WeatherCurrent.belongsTo(models.Location, { as: 'location', foreignKey: 'locationId' });
  };

  return WeatherCurrent;
};
