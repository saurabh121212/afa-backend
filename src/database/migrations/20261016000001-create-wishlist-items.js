'use strict';

// Wishlist (Figma heart icon on listings + "Wishlist" page).
// One row per user + listing. Removing = soft delete (deleted_at); adding it again restores the row.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wishlist_items', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      listing_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'listings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    // One row per user + listing (a removed item is restored, not added twice)
    await queryInterface.addIndex('wishlist_items', ['user_id', 'listing_id'], {
      unique: true,
      name: 'wishlist_items_user_listing_unique',
    });
    await queryInterface.addIndex('wishlist_items', ['listing_id'], { name: 'wishlist_items_listing_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wishlist_items');
  },
};
