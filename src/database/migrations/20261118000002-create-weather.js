'use strict';

// Weather (OpenWeather free plan), filled by the weather job, read by the website / apps.
//   weather_current        -> latest observation, ONE row per inkhundla (overwritten every hour)
//   weather_forecasts      -> 5-day forecast in 3-hour steps per inkhundla (replaced every 3 hours)
//   weather_daily_history  -> one summary row per inkhundla per day (min / max, rain), kept for later
//                             use (market intelligence, phase 2 loans)
//   weather_fetch_runs     -> log of every job run: what, how many calls, success / errors
// These are a copy of OpenWeather data (not user content), so rows are replaced, not soft deleted.
// Temperatures in °C, wind in m/s (the API converts to km/h), rain in mm. Dates in UTC.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const locationFk = {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      references: { model: 'locations', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    };
    const dec = (p, s) => ({ type: Sequelize.DECIMAL(p, s), allowNull: true });
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };
    const condition = {
      condition_id: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      condition_main: { type: Sequelize.STRING(40), allowNull: true },
      description: { type: Sequelize.STRING(100), allowNull: true },
      icon: { type: Sequelize.STRING(10), allowNull: true },
    };

    await queryInterface.createTable('weather_current', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      location_id: locationFk,
      latitude: dec(9, 6),
      longitude: dec(9, 6),
      approximate: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, // true = region's weather used
      observed_at: { type: Sequelize.DATE, allowNull: true },
      temp: dec(5, 2),
      feels_like: dec(5, 2),
      temp_min: dec(5, 2),
      temp_max: dec(5, 2),
      humidity: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true },
      pressure: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      wind_speed: dec(5, 2),
      wind_deg: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      wind_gust: dec(5, 2),
      clouds: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true },
      rain_1h: dec(6, 2),
      visibility: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      ...condition,
      sunrise: { type: Sequelize.DATE, allowNull: true },
      sunset: { type: Sequelize.DATE, allowNull: true },
      fetched_at: { type: Sequelize.DATE, allowNull: false },
      ...timestamps,
    });
    await queryInterface.addIndex('weather_current', ['location_id'], { unique: true, name: 'weather_current_location_unique' });

    await queryInterface.createTable('weather_forecasts', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      location_id: locationFk,
      forecast_at: { type: Sequelize.DATE, allowNull: false }, // start of the 3-hour step
      temp: dec(5, 2),
      feels_like: dec(5, 2),
      temp_min: dec(5, 2),
      temp_max: dec(5, 2),
      humidity: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true },
      wind_speed: dec(5, 2),
      wind_deg: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      wind_gust: dec(5, 2),
      clouds: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true },
      pop: dec(3, 2), // chance of rain 0-1
      rain_3h: dec(6, 2),
      ...condition,
      fetched_at: { type: Sequelize.DATE, allowNull: false },
      ...timestamps,
    });
    await queryInterface.addIndex('weather_forecasts', ['location_id', 'forecast_at'], { unique: true, name: 'weather_forecasts_location_time_unique' });
    await queryInterface.addIndex('weather_forecasts', ['forecast_at'], { name: 'weather_forecasts_time_idx' });

    await queryInterface.createTable('weather_daily_history', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      location_id: locationFk,
      date: { type: Sequelize.DATEONLY, allowNull: false }, // Eswatini date
      temp_min: dec(5, 2),
      temp_max: dec(5, 2),
      rain_mm: { type: Sequelize.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
      humidity_avg: dec(5, 2),
      samples: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      last_observed_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('weather_daily_history', ['location_id', 'date'], { unique: true, name: 'weather_daily_location_date_unique' });

    await queryInterface.createTable('weather_fetch_runs', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      kind: { type: Sequelize.ENUM('current', 'forecast', 'geocode', 'location'), allowNull: false },
      triggered_by: { type: Sequelize.ENUM('schedule', 'admin', 'coordinates'), allowNull: false, defaultValue: 'schedule' },
      status: { type: Sequelize.ENUM('running', 'success', 'partial', 'failed'), allowNull: false, defaultValue: 'running' },
      points: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, // places asked for
      succeeded: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      failed: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      calls: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, // OpenWeather calls used
      error: { type: Sequelize.STRING(1000), allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: false },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('weather_fetch_runs', ['kind', 'started_at'], { name: 'weather_runs_kind_time_idx' });
    await queryInterface.addIndex('weather_fetch_runs', ['started_at'], { name: 'weather_runs_time_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('weather_fetch_runs');
    await queryInterface.dropTable('weather_daily_history');
    await queryInterface.dropTable('weather_forecasts');
    await queryInterface.dropTable('weather_current');
  },
};
