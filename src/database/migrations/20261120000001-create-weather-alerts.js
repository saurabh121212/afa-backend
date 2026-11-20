'use strict';

// Weather alerts written by the admin (Admin › Settings › Weather › Alerts), e.g. copied from the
// Eswatini Meteorological Service. Shown as a warning box to logged-in users while they are active.
//   weather_alerts -> title, severity, message (what to expect / what to do), the regions it covers
//                     (null = all of Eswatini), from / to. ended_at is set when the admin ends it early.
// Soft delete (deleted_at), like banners and videos.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const adminFk = {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'admins', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    };

    await queryInterface.createTable('weather_alerts', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      title: { type: Sequelize.STRING(150), allowNull: false }, // e.g. "Heavy rain warning"
      severity: { type: Sequelize.ENUM('advisory', 'warning', 'severe'), allowNull: false, defaultValue: 'warning' },
      message: { type: Sequelize.STRING(1000), allowNull: false },
      region_ids: { type: Sequelize.JSON, allowNull: true }, // [1, 4] ; null = all of Eswatini
      starts_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: { type: Sequelize.DATE, allowNull: true }, // ended early by the admin
      created_by: adminFk,
      updated_by: adminFk,
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('weather_alerts', ['starts_at', 'ends_at'], { name: 'weather_alerts_window_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('weather_alerts');
  },
};
