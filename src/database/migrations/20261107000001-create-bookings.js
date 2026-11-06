'use strict';

// Service bookings (buyers book logistics providers' services). ADD-ONLY: one new table, new columns,
// and NEW values added to two ENUM lists (existing values and rows are unchanged).
//
//   bookings                 -> the booking details of a service order (AFA-BKG-000001): dates, addresses,
//                               distance / load / space, how the price was worked out
//   orders.kind              -> 'product' (cart checkout) or 'booking'
//   seller_orders.fulfilment -> + 'service'
//   seller_orders.status     -> + 'in_progress' (the provider started the service)
//   seller_orders.started_at -> when it started
//   listings.units_available -> how many of this service can be booked on the same dates (e.g. 3 tractors)
//
// Bookings are never deleted (soft delete column only, like the rest of the new work).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const id = { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false };
    const fk = (table, nullable = false) => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: nullable,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    const dec = (p, s) => ({ type: Sequelize.DECIMAL(p, s), allowNull: true });

    // ---------- new columns / ENUM values ----------
    await queryInterface.addColumn('orders', 'kind', {
      type: Sequelize.ENUM('product', 'booking'),
      allowNull: false,
      defaultValue: 'product',
    });
    await queryInterface.addIndex('orders', ['user_id', 'kind', 'created_at'], { name: 'orders_user_kind_idx' });

    await queryInterface.changeColumn('seller_orders', 'fulfilment', {
      type: Sequelize.ENUM('pickup', 'delivery', 'service'),
      allowNull: false,
    });
    await queryInterface.changeColumn('seller_orders', 'status', {
      type: Sequelize.ENUM(
        'awaiting_payment', 'paid', 'confirmed', 'in_progress', 'packed', 'dispatched', 'ready_for_pickup',
        'delivered', 'collected', 'completed', 'cancelled'
      ),
      allowNull: false,
      defaultValue: 'awaiting_payment',
    });
    await queryInterface.addColumn('seller_orders', 'started_at', { type: Sequelize.DATE, allowNull: true });

    await queryInterface.addColumn('listings', 'units_available', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
    });

    // ---------- bookings ----------
    await queryInterface.createTable('bookings', {
      id,
      booking_number: { type: Sequelize.STRING(30), allowNull: true },
      order_id: fk('orders'),
      seller_order_id: fk('seller_orders'),
      order_item_id: fk('order_items'),
      listing_id: fk('listings'),
      buyer_id: fk('users'),
      provider_id: fk('users'),
      // copy of the rate at booking time
      booking_type: { type: Sequelize.ENUM('transport', 'time', 'storage', 'count'), allowNull: false },
      rate: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      rate_unit: { type: Sequelize.STRING(30), allowNull: false },
      // when
      start_date: { type: Sequelize.DATEONLY, allowNull: false },
      end_date: { type: Sequelize.DATEONLY, allowNull: false },
      start_time: { type: Sequelize.STRING(5), allowNull: true }, // "08:30", optional
      // what the buyer entered
      distance_km: dec(10, 2),
      load_amount: dec(12, 2),
      load_unit: { type: Sequelize.STRING(30), allowNull: true },
      space_amount: dec(12, 2),
      space_unit: { type: Sequelize.STRING(30), allowNull: true },
      quantity: dec(12, 2),
      hours: dec(8, 2),
      // how the price was worked out: [{ key, label, entered, billed, unit }], billable quantity
      breakdown: { type: Sequelize.JSON, allowNull: true },
      billable_quantity: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      minimum_applied: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // where (address snapshots)
      pickup_address: { type: Sequelize.JSON, allowNull: true },
      dropoff_address: { type: Sequelize.JSON, allowNull: true },
      service_address: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('bookings', ['seller_order_id'], { name: 'bookings_seller_order_uq', unique: true });
    await queryInterface.addIndex('bookings', ['listing_id', 'start_date', 'end_date'], { name: 'bookings_listing_dates_idx' });
    await queryInterface.addIndex('bookings', ['buyer_id', 'created_at'], { name: 'bookings_buyer_idx' });
    await queryInterface.addIndex('bookings', ['provider_id', 'start_date'], { name: 'bookings_provider_idx' });
    await queryInterface.addIndex('bookings', ['order_id'], { name: 'bookings_order_idx' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('bookings');
    await queryInterface.removeColumn('listings', 'units_available');
    await queryInterface.removeColumn('seller_orders', 'started_at');
    await queryInterface.changeColumn('seller_orders', 'status', {
      type: Sequelize.ENUM(
        'awaiting_payment', 'paid', 'confirmed', 'packed', 'dispatched', 'ready_for_pickup',
        'delivered', 'collected', 'completed', 'cancelled'
      ),
      allowNull: false,
      defaultValue: 'awaiting_payment',
    });
    await queryInterface.changeColumn('seller_orders', 'fulfilment', { type: Sequelize.ENUM('pickup', 'delivery'), allowNull: false });
    await queryInterface.removeIndex('orders', 'orders_user_kind_idx');
    await queryInterface.removeColumn('orders', 'kind');
  },
};
