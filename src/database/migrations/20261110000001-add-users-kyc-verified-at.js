'use strict';

// Verified badge. ADD-ONLY: users.kyc_verified_at = when the account AND every KYC document were approved
// (null = not fully verified). Filled in by the credit score refresh: run "Recalculate all" in
// admin Credit Scores after migrating, or wait for the background check (200 users a minute).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'kyc_verified_at', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'kyc_verified_at');
  },
};
