'use strict';

// Phase 1 - System Settings (admin). One row per setting.
//
//   setting_key -> e.g. "vat_rate", "vat_on_delivery_fee", "payment_time_limit_minutes"
//   value       -> JSON (number, true/false, text...)
//
// The table starts EMPTY: default values live in src/config/settings.js and a row
// is only saved when the admin changes a setting. No seeder is needed.
// Settings are never deleted (no deleted_at); "reset" just saves the default again.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('settings', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      setting_key: { type: Sequelize.STRING(60), allowNull: false },
      value: { type: Sequelize.JSON, allowNull: true },
      updated_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'admins', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('settings', ['setting_key'], { unique: true, name: 'settings_key_unique' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('settings');
  },
};
