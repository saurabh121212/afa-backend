'use strict';

// Phase 1 (VAT + refund rules) - categories. ADD-ONLY: existing rows and data are kept.
//
//   vat_applicable -> main category: true / false (existing rows become false = no VAT)
//                     sub-category : NULL = same as its main category, true / false = override
//   refund_policy  -> main categories only: which cancellation / refund rules apply
//                     NULL = automatic (farmer listing -> farm_produce, trader -> farming_products,
//                     logistics -> services). Sub-categories always use the main category's value.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('categories', 'vat_applicable', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      after: 'applies_to',
    });
    await queryInterface.addColumn('categories', 'refund_policy', {
      type: Sequelize.ENUM('farm_produce', 'farming_products', 'leasing', 'services'),
      allowNull: true,
      after: 'vat_applicable',
    });

    // Existing MAIN categories start as "no VAT"; sub-categories stay NULL (= inherit)
    await queryInterface.sequelize.query(
      'UPDATE categories SET vat_applicable = 0 WHERE parent_id IS NULL AND vat_applicable IS NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('categories', 'refund_policy');
    await queryInterface.removeColumn('categories', 'vat_applicable');
  },
};
