'use strict';

// Phase 1 - VAT registration of sellers (farmer, trader, logistics). ADD-ONLY.
// Stored on "users" so it works the same for every seller type.
//
// In Eswatini the VAT reference is the seller's TIN (already saved at registration);
// the proof is the ERS "VAT Registration Certificate" (new optional KYC document).
//
//   vat_status        none     -> not VAT-registered (default; every existing user)
//                     pending  -> seller says "I am VAT-registered", waiting for the admin
//                     approved -> admin checked the certificate; may list in VAT categories
//                     rejected -> admin rejected (reason in vat_status_reason)
//   vat_status_reason -> admin's reason (reject / remove)
//   vat_requested_at  -> when the seller asked
//   vat_reviewed_at / vat_reviewed_by -> last admin decision

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'vat_status', {
      type: Sequelize.ENUM('none', 'pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'none',
    });
    await queryInterface.addColumn('users', 'vat_status_reason', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('users', 'vat_requested_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('users', 'vat_reviewed_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('users', 'vat_reviewed_by', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'admins', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('users', ['vat_status'], { name: 'users_vat_status_idx' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_vat_status_idx');
    await queryInterface.removeColumn('users', 'vat_reviewed_by');
    await queryInterface.removeColumn('users', 'vat_reviewed_at');
    await queryInterface.removeColumn('users', 'vat_requested_at');
    await queryInterface.removeColumn('users', 'vat_status_reason');
    await queryInterface.removeColumn('users', 'vat_status');
  },
};
