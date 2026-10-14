'use strict';

// Admin approval (Module B):
//   users        -> who / when / why of the latest status change (approve, reject, suspend)
//   admin_notes  -> internal notes about a user, visible to the admin only

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'approved_at', { type: Sequelize.DATE, allowNull: true });
    // Latest reason from the admin (rejected, suspended)
    await queryInterface.addColumn('users', 'status_reason', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('users', 'status_changed_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('users', 'status_changed_by', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'admins', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('users', ['status', 'submitted_at'], { name: 'users_status_submitted_idx' });

    await queryInterface.createTable('admin_notes', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      admin_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'admins', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      note: { type: Sequelize.TEXT, allowNull: false },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('admin_notes', ['user_id', 'created_at'], { name: 'admin_notes_user_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('admin_notes');
    await queryInterface.removeIndex('users', 'users_status_submitted_idx');
    await queryInterface.removeColumn('users', 'status_changed_by');
    await queryInterface.removeColumn('users', 'status_changed_at');
    await queryInterface.removeColumn('users', 'status_reason');
    await queryInterface.removeColumn('users', 'approved_at');
  },
};
