'use strict';

// One row per registered user (Farmer, Buyer, Trader, Logistics, Financial Institution).
// Login details and registration status live here.
// Each user type's own details live in its profile table (e.g. farmer_profiles).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      user_type: {
        type: Sequelize.ENUM('farmer', 'buyer', 'trader', 'logistics', 'financial_institution'),
        allowNull: false,
      },
      email: {
        type: Sequelize.STRING(150),
        allowNull: false,
        unique: true,
      },
      mobile: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true,
      },
      password: {
        type: Sequelize.STRING(255), // bcrypt hash
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(
          'pending_verification',
          'pending_approval',
          'approved',
          'rejected',
          'suspended'
        ),
        allowNull: false,
        defaultValue: 'pending_verification',
      },
      // Next registration step the user has to complete (1-4). 4 = Account Security.
      registration_step: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 1,
      },
      email_verified_at: { type: Sequelize.DATE, allowNull: true },
      terms_accepted_at: { type: Sequelize.DATE, allowNull: true },
      privacy_accepted_at: { type: Sequelize.DATE, allowNull: true },
      accuracy_confirmed_at: { type: Sequelize.DATE, allowNull: true },
      submitted_at: { type: Sequelize.DATE, allowNull: true },
      rejection_reason: { type: Sequelize.TEXT, allowNull: true },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      // Tokens issued before this time stop working (set when the password changes).
      password_changed_at: { type: Sequelize.DATE, allowNull: true },
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
      // "Disable" from the scope: row is kept for audit, hidden from normal queries.
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('users', ['user_type', 'status'], {
      name: 'users_type_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
