'use strict';

// Bank & payment details of a user (Figma "Bank & Payment Details": Primary / Secondary).
//   method_type = bank_account -> bank_name, account_holder_name, account_number_*, account_type, branch_code
//   method_type = mobile_money -> provider, mobile_number, account_holder_name
//
// The full bank account number is stored ENCRYPTED (account_number_encrypted).
// account_number_last4 is kept for display ("•••• 4821") and account_number_hash to spot duplicates.
// deleted_at -> soft delete (rows are never removed).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('payment_methods', {
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
        onDelete: 'RESTRICT',
      },
      method_type: {
        type: Sequelize.ENUM('bank_account', 'mobile_money'),
        allowNull: false,
      },
      is_primary: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      account_holder_name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      // Bank account
      bank_name: { type: Sequelize.STRING(100), allowNull: true },
      account_number_encrypted: { type: Sequelize.STRING(255), allowNull: true },
      account_number_last4: { type: Sequelize.STRING(4), allowNull: true },
      account_number_hash: { type: Sequelize.STRING(64), allowNull: true },
      account_type: { type: Sequelize.ENUM('savings', 'current'), allowNull: true },
      branch_code: { type: Sequelize.STRING(10), allowNull: true },
      // Mobile money
      provider: { type: Sequelize.STRING(50), allowNull: true },
      mobile_number: { type: Sequelize.STRING(20), allowNull: true },

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
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('payment_methods', ['user_id', 'is_primary'], {
      name: 'payment_methods_user_primary_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_methods');
  },
};
