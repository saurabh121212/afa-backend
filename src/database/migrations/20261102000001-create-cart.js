'use strict';

// Phase 2 - Cart (buyers only). New tables, nothing existing is changed.
//
//   cart_items          -> one row per buyer + listing. quantity is in the listing's PRICE unit.
//                          saved_for_later = moved out of the order summary ("Save for later").
//                          price_at_add    = price when added, to show "price changed" in the cart.
//                          Removing = soft delete; adding the same listing again restores the row.
//   cart_seller_options -> the buyer's Pickup / Delivery choice per seller group in the cart.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const fk = (table) => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };

    await queryInterface.createTable('cart_items', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      user_id: fk('users'),
      listing_id: fk('listings'),
      quantity: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      saved_for_later: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      price_at_add: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      ...ts,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('cart_items', ['user_id', 'listing_id'], { unique: true, name: 'cart_items_user_listing_unique' });
    await queryInterface.addIndex('cart_items', ['listing_id'], { name: 'cart_items_listing_idx' });

    await queryInterface.createTable('cart_seller_options', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      user_id: fk('users'), // the buyer
      seller_id: fk('users'),
      fulfilment: { type: Sequelize.ENUM('pickup', 'delivery'), allowNull: false },
      ...ts,
    });
    await queryInterface.addIndex('cart_seller_options', ['user_id', 'seller_id'], {
      unique: true,
      name: 'cart_seller_options_user_seller_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cart_seller_options');
    await queryInterface.dropTable('cart_items');
  },
};
