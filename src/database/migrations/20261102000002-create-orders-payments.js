'use strict';

// Phase 3 - Checkout, orders and payments. New tables only (nothing existing changes).
//
//   orders               -> one per checkout (one payment for everything). AFA-ORD-000123
//   seller_orders        -> one per seller in that checkout.                AFA-ORD-000123-1, -2 ...
//   order_items          -> what was bought: a COPY of the listing at the time of ordering
//   order_status_history -> timeline (who changed what, when)
//   payments             -> every payment attempt: bank transfer (proof upload + admin review)
//                           or online (payment gateway), "test" in development
//
// Orders are never deleted (no delete API); cancelled orders keep their rows.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const id = { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false };
    const fk = (table, nullable = false, onDelete = 'RESTRICT') => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: nullable,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete,
    });
    const money = (nullable = false) => ({ type: Sequelize.DECIMAL(14, 2), allowNull: nullable, ...(nullable ? {} : { defaultValue: 0 }) });
    const date = { type: Sequelize.DATE, allowNull: true };
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };

    // ---------- orders ----------
    await queryInterface.createTable('orders', {
      id,
      order_number: { type: Sequelize.STRING(30), allowNull: true }, // set right after insert (from the id)
      user_id: fk('users'), // the buyer
      status: {
        // awaiting_payment -> under_review (bank proof sent) -> paid ; or cancelled
        type: Sequelize.ENUM('awaiting_payment', 'under_review', 'paid', 'cancelled'),
        allowNull: false,
        defaultValue: 'awaiting_payment',
      },
      payment_method: { type: Sequelize.ENUM('bank_transfer', 'online'), allowNull: false },
      payment_deadline: date, // unpaid after this -> cancelled, stock returned
      delivery_address: { type: Sequelize.JSON, allowNull: true }, // copy of the address (null = pickup only)
      subtotal: money(),
      delivery_total: money(),
      vat_total: money(),
      total: money(),
      vat_rate: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'SZL' },
      idempotency_key: { type: Sequelize.STRING(100), allowNull: true }, // stops double "Place order"
      terms_accepted_at: date,
      paid_at: date,
      cancelled_at: date,
      cancel_reason: { type: Sequelize.STRING(500), allowNull: true },
      cancelled_by: { type: Sequelize.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('orders', ['order_number'], { unique: true, name: 'orders_number_unique' });
    await queryInterface.addIndex('orders', ['user_id', 'idempotency_key'], { unique: true, name: 'orders_user_idempotency_unique' });
    await queryInterface.addIndex('orders', ['user_id', 'created_at'], { name: 'orders_user_created_idx' });
    await queryInterface.addIndex('orders', ['status', 'payment_deadline'], { name: 'orders_status_deadline_idx' });

    // ---------- seller_orders ----------
    await queryInterface.createTable('seller_orders', {
      id,
      order_id: fk('orders'),
      seller_id: fk('users'),
      seller_order_number: { type: Sequelize.STRING(40), allowNull: false },
      status: {
        type: Sequelize.ENUM(
          'awaiting_payment', 'paid', 'confirmed', 'packed', 'dispatched', 'ready_for_pickup',
          'delivered', 'collected', 'completed', 'cancelled'
        ),
        allowNull: false,
        defaultValue: 'awaiting_payment',
      },
      fulfilment: { type: Sequelize.ENUM('pickup', 'delivery'), allowNull: false },
      subtotal: money(),
      delivery_fee: money(),
      delivery_vat: money(),
      vat_total: money(), // items VAT + delivery VAT
      total: money(),
      buyer_note: { type: Sequelize.STRING(500), allowNull: true },
      seller_vat_registered: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // Seller payout: held while the order runs, released when Completed (reverse factoring later)
      payout_status: { type: Sequelize.ENUM('not_due', 'held', 'released', 'cancelled'), allowNull: false, defaultValue: 'not_due' },
      payout_amount: money(),
      paid_at: date,
      confirm_by: date, // seller should confirm before this ("Late" after)
      confirmed_at: date,
      packed_at: date,
      dispatched_at: date,
      ready_at: date,
      delivered_at: date, // delivered or collected
      complete_after: date, // end of the claim window
      completed_at: date,
      cancelled_at: date,
      ...ts,
    });
    await queryInterface.addIndex('seller_orders', ['seller_order_number'], { unique: true, name: 'seller_orders_number_unique' });
    await queryInterface.addIndex('seller_orders', ['order_id'], { name: 'seller_orders_order_idx' });
    await queryInterface.addIndex('seller_orders', ['seller_id', 'status'], { name: 'seller_orders_seller_status_idx' });
    await queryInterface.addIndex('seller_orders', ['status', 'complete_after'], { name: 'seller_orders_status_complete_idx' });

    // ---------- order_items ----------
    await queryInterface.createTable('order_items', {
      id,
      order_id: fk('orders'),
      seller_order_id: fk('seller_orders'),
      listing_id: fk('listings'),
      name: { type: Sequelize.STRING(150), allowNull: false },
      photo_url: { type: Sequelize.STRING(255), allowNull: true },
      category_name: { type: Sequelize.STRING(100), allowNull: true },
      sub_category_name: { type: Sequelize.STRING(100), allowNull: true },
      unit: { type: Sequelize.STRING(30), allowNull: true }, // price unit code, e.g. kg
      unit_label: { type: Sequelize.STRING(50), allowNull: true },
      unit_price: money(),
      quantity: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      line_total: money(),
      is_vat_applicable: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      vat_amount: money(),
      refund_policy: { type: Sequelize.STRING(30), allowNull: true }, // farm_produce | farming_products ...
      non_returnable: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      pickup_location: { type: Sequelize.JSON, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('order_items', ['order_id'], { name: 'order_items_order_idx' });
    await queryInterface.addIndex('order_items', ['seller_order_id'], { name: 'order_items_seller_order_idx' });
    await queryInterface.addIndex('order_items', ['listing_id'], { name: 'order_items_listing_idx' });

    // ---------- order_status_history ----------
    await queryInterface.createTable('order_status_history', {
      id,
      order_id: fk('orders'),
      seller_order_id: fk('seller_orders', true),
      from_status: { type: Sequelize.STRING(30), allowNull: true },
      to_status: { type: Sequelize.STRING(30), allowNull: false },
      actor_type: { type: Sequelize.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: false },
      actor_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true }, // user id or admin id
      note: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('order_status_history', ['order_id', 'created_at'], { name: 'order_history_order_idx' });

    // ---------- payments ----------
    await queryInterface.createTable('payments', {
      id,
      order_id: fk('orders'),
      method: { type: Sequelize.ENUM('bank_transfer', 'online'), allowNull: false },
      provider: { type: Sequelize.STRING(30), allowNull: true }, // online: gateway name ("test" in development)
      status: {
        // online: pending -> succeeded | failed | expired
        // bank:   under_review -> succeeded (admin confirmed) | rejected
        type: Sequelize.ENUM('pending', 'under_review', 'succeeded', 'failed', 'rejected', 'expired'),
        allowNull: false,
        defaultValue: 'pending',
      },
      amount: money(), // what had to be paid (order total)
      // Bank transfer: what the buyer says they paid + the proof of payment
      amount_paid: money(true),
      paid_on: { type: Sequelize.DATEONLY, allowNull: true },
      bank_reference: { type: Sequelize.STRING(100), allowNull: true },
      buyer_note: { type: Sequelize.STRING(500), allowNull: true },
      receipt_path: { type: Sequelize.STRING(255), allowNull: true }, // private file (relative to UPLOAD_DIR)
      receipt_original_name: { type: Sequelize.STRING(255), allowNull: true },
      receipt_mime_type: { type: Sequelize.STRING(50), allowNull: true },
      receipt_size_bytes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      // Online gateway
      provider_reference: { type: Sequelize.STRING(150), allowNull: true },
      provider_payload: { type: Sequelize.JSON, allowNull: true }, // last message from the gateway
      redirect_url: { type: Sequelize.STRING(500), allowNull: true },
      // Review (bank transfer)
      reviewed_by: fk('admins', true, 'SET NULL'),
      reviewed_at: date,
      rejection_reason: { type: Sequelize.STRING(500), allowNull: true },
      completed_at: date, // succeeded / failed / rejected / expired time
      ...ts,
    });
    await queryInterface.addIndex('payments', ['order_id'], { name: 'payments_order_idx' });
    await queryInterface.addIndex('payments', ['status', 'method'], { name: 'payments_status_method_idx' });
    await queryInterface.addIndex('payments', ['provider', 'provider_reference'], { name: 'payments_provider_ref_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payments');
    await queryInterface.dropTable('order_status_history');
    await queryInterface.dropTable('order_items');
    await queryInterface.dropTable('seller_orders');
    await queryInterface.dropTable('orders');
  },
};
