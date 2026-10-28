'use strict';

// Phase 1 - listings. ADD-ONLY: existing listings keep working.
//
// Pickup / delivery already exists: delivery_type = pickup | delivery | both.
//
//   delivery_fees  -> seller's delivery fee per region (Emalangeni), JSON:
//                     [{ "regionId": 1, "fee": 50.00 }, { "regionId": 2, "fee": 80.00 }]
//                     A region that is not in the list = no delivery to that region.
//                     NULL for pickup-only listings and services.
//   non_returnable -> seller ticked "Custom order / non-returnable" (only a faulty item can be claimed)
//   vat_hold       -> true = hidden from the website because it is in a VAT category and the
//                     seller is not VAT-approved. The listing's own status is NOT changed, so when
//                     the seller gets approved (or the category stops being VAT) it shows again.
//   vat_hold_at    -> when it was hidden

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('listings', 'delivery_fees', {
      type: Sequelize.JSON,
      allowNull: true,
      after: 'logistics_by',
    });
    await queryInterface.addColumn('listings', 'non_returnable', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'delivery_fees',
    });
    await queryInterface.addColumn('listings', 'vat_hold', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'status',
    });
    await queryInterface.addColumn('listings', 'vat_hold_at', {
      type: Sequelize.DATE,
      allowNull: true,
      after: 'vat_hold',
    });
    await queryInterface.addIndex('listings', ['status', 'vat_hold'], { name: 'listings_status_vat_hold_idx' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('listings', 'listings_status_vat_hold_idx');
    await queryInterface.removeColumn('listings', 'vat_hold_at');
    await queryInterface.removeColumn('listings', 'vat_hold');
    await queryInterface.removeColumn('listings', 'non_returnable');
    await queryInterface.removeColumn('listings', 'delivery_fees');
  },
};
