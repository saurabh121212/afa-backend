'use strict';

// Weather: coordinates on locations (regions and tinkhundla).
//   latitude / longitude     -> null = not known yet
//   coordinates_source       -> seed (regions, from the seeder) | geocoded (found automatically by the
//                               weather job) | manual (set by the admin; never overwritten)
//   coordinates_checked_at   -> last time the weather job tried to find them (it retries after 7 days)
// Add-only: nothing existing changes.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('locations', 'latitude', { type: Sequelize.DECIMAL(9, 6), allowNull: true });
    await queryInterface.addColumn('locations', 'longitude', { type: Sequelize.DECIMAL(9, 6), allowNull: true });
    await queryInterface.addColumn('locations', 'coordinates_source', {
      type: Sequelize.ENUM('seed', 'geocoded', 'manual'),
      allowNull: true,
    });
    await queryInterface.addColumn('locations', 'coordinates_checked_at', { type: Sequelize.DATE, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('locations', 'coordinates_checked_at');
    await queryInterface.removeColumn('locations', 'coordinates_source');
    await queryInterface.removeColumn('locations', 'longitude');
    await queryInterface.removeColumn('locations', 'latitude');
  },
};
