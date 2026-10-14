'use strict';

// One-time codes sent by email (registration verification, password reset).
// Only a SHA-256 hash of the code is stored, never the code itself.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('email_otps', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      email: { type: Sequelize.STRING(150), allowNull: false },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      purpose: {
        type: Sequelize.ENUM('registration', 'password_reset'),
        allowNull: false,
      },
      otp_hash: { type: Sequelize.STRING(64), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      attempts: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      consumed_at: { type: Sequelize.DATE, allowNull: true },
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

    await queryInterface.addIndex('email_otps', ['email', 'purpose'], {
      name: 'email_otps_email_purpose_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('email_otps');
  },
};
