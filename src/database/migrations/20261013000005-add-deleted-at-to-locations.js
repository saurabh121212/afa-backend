'use strict';

// Soft delete for locations: "deleting" a location only sets deleted_at.
// The row stays in the database (AFA rule: no hard deletes).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('locations', 'deleted_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('locations', ['parent_id', 'deleted_at'], {
      name: 'locations_parent_deleted_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('locations', 'locations_parent_deleted_idx');
    await queryInterface.removeColumn('locations', 'deleted_at');
  },
};
