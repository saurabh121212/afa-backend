'use strict';

// Phase 4 - Cancelling paid orders, claims and refunds. ADD-ONLY: new tables + new columns.
//
//   seller_orders (+ columns)  -> who cancelled and why, refunded amount, open request / claim pointers
//   cancellation_requests      -> buyer asks to cancel after the seller confirmed (seller / admin decides)
//   claims                     -> a problem reported after delivery (AFA-CLM-000001)
//   claim_items                -> which items and how many
//   claim_messages             -> conversation buyer / seller / AFA + system events
//   claim_photos               -> photos (private files) attached to a message
//   refunds                    -> money AFA pays back to the buyer (AFA-REF-000001), paid manually for now
//   refund_accounts            -> the buyer's saved bank account for refunds (soft delete)
//
// Claims, requests and refunds are never deleted.

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
    const text500 = { type: Sequelize.STRING(500), allowNull: true };
    const actor = { type: Sequelize.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: true };
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };

    // ---------- seller_orders: new columns ----------
    await queryInterface.addColumn('seller_orders', 'cancel_reason', text500);
    await queryInterface.addColumn('seller_orders', 'cancelled_by', actor);
    await queryInterface.addColumn('seller_orders', 'refunded_amount', money());
    // none -> active (a claim is open: payout held, not completed) -> closed
    await queryInterface.addColumn('seller_orders', 'claim_status', {
      type: Sequelize.ENUM('none', 'active', 'closed'),
      allowNull: false,
      defaultValue: 'none',
    });
    // Plain ids (no FK: the tables below point back at seller_orders)
    await queryInterface.addColumn('seller_orders', 'open_cancel_request_id', { type: Sequelize.INTEGER.UNSIGNED, allowNull: true });
    await queryInterface.addColumn('seller_orders', 'active_claim_id', { type: Sequelize.INTEGER.UNSIGNED, allowNull: true });
    await queryInterface.addIndex('seller_orders', ['status', 'paid_at'], { name: 'seller_orders_status_paid_idx' });

    // ---------- cancellation_requests ----------
    await queryInterface.createTable('cancellation_requests', {
      id,
      order_id: fk('orders'),
      seller_order_id: fk('seller_orders'),
      buyer_id: fk('users'),
      seller_id: fk('users'),
      reason: { type: Sequelize.STRING(500), allowNull: false },
      status: {
        type: Sequelize.ENUM('pending', 'accepted', 'declined', 'escalated', 'approved', 'rejected', 'withdrawn', 'closed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      respond_by: date, // seller should answer before this, then it goes to the admin
      responded_at: date,
      response_note: text500, // seller's note / reason for declining
      escalated_at: date,
      decided_by: fk('admins', true, 'SET NULL'),
      decided_at: date,
      decision_note: text500,
      ...ts,
    });
    await queryInterface.addIndex('cancellation_requests', ['seller_order_id'], { name: 'cancel_requests_seller_order_idx' });
    await queryInterface.addIndex('cancellation_requests', ['status', 'respond_by'], { name: 'cancel_requests_status_due_idx' });

    // ---------- claims ----------
    await queryInterface.createTable('claims', {
      id,
      claim_number: { type: Sequelize.STRING(30), allowNull: true }, // set right after insert
      order_id: fk('orders'),
      seller_order_id: fk('seller_orders'),
      buyer_id: fk('users'),
      seller_id: fk('users'),
      reason: { type: Sequelize.ENUM('damaged', 'wrong_item', 'missing_items', 'poor_quality', 'not_received'), allowNull: false },
      description: { type: Sequelize.STRING(1000), allowNull: false },
      status: {
        type: Sequelize.ENUM('open', 'rejected', 'escalated', 'awaiting_return', 'resolved', 'closed'),
        allowNull: false,
        defaultValue: 'open',
      },
      // Money: the most that can be refunded for the claimed items, and the amount agreed / decided
      items_amount: money(),
      delivery_amount: money(),
      vat_amount: money(),
      max_refund: money(),
      refund_amount: money(true),
      return_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // Deadlines
      seller_respond_by: date, // open / awaiting_return: after this -> escalated
      escalate_by: date, // rejected: the buyer can escalate until this, then closed
      // Seller
      seller_responded_at: date,
      seller_note: text500,
      // Escalation + AFA decision (final)
      escalated_at: date,
      escalated_by: actor,
      escalation_note: text500,
      decision: { type: Sequelize.ENUM('refund', 'no_refund'), allowNull: true },
      decided_by: fk('admins', true, 'SET NULL'),
      decided_at: date,
      decision_note: text500,
      // Return of the goods
      buyer_returned_at: date,
      return_note: text500,
      return_received_at: date,
      // End
      resolved_at: date,
      closed_at: date,
      close_reason: text500,
      refund_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('claims', ['claim_number'], { unique: true, name: 'claims_number_unique' });
    await queryInterface.addIndex('claims', ['seller_order_id'], { name: 'claims_seller_order_idx' });
    await queryInterface.addIndex('claims', ['buyer_id', 'created_at'], { name: 'claims_buyer_idx' });
    await queryInterface.addIndex('claims', ['seller_id', 'status'], { name: 'claims_seller_status_idx' });
    await queryInterface.addIndex('claims', ['status', 'seller_respond_by'], { name: 'claims_status_due_idx' });

    // ---------- claim_items ----------
    await queryInterface.createTable('claim_items', {
      id,
      claim_id: fk('claims', false, 'CASCADE'),
      order_item_id: fk('order_items'),
      name: { type: Sequelize.STRING(150), allowNull: false },
      unit_label: { type: Sequelize.STRING(50), allowNull: true },
      unit_price: money(),
      quantity: { type: Sequelize.DECIMAL(14, 2), allowNull: false }, // claimed quantity
      amount: money(), // unit price x quantity (without VAT)
      vat_amount: money(),
      ...ts,
    });
    await queryInterface.addIndex('claim_items', ['claim_id'], { name: 'claim_items_claim_idx' });

    // ---------- claim_messages ----------
    await queryInterface.createTable('claim_messages', {
      id,
      claim_id: fk('claims', false, 'CASCADE'),
      sender_type: { type: Sequelize.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: false },
      sender_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true }, // user id or admin id
      event: { type: Sequelize.STRING(30), allowNull: true }, // opened / accepted / rejected / escalated ... (null = plain message)
      message: { type: Sequelize.STRING(2000), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('claim_messages', ['claim_id', 'created_at'], { name: 'claim_messages_claim_idx' });

    // ---------- claim_photos ----------
    await queryInterface.createTable('claim_photos', {
      id,
      claim_id: fk('claims', false, 'CASCADE'),
      message_id: fk('claim_messages', false, 'CASCADE'),
      path: { type: Sequelize.STRING(255), allowNull: false }, // private file (relative to UPLOAD_DIR)
      original_name: { type: Sequelize.STRING(255), allowNull: true },
      mime_type: { type: Sequelize.STRING(50), allowNull: false },
      size_bytes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('claim_photos', ['claim_id'], { name: 'claim_photos_claim_idx' });

    // ---------- refunds ----------
    await queryInterface.createTable('refunds', {
      id,
      refund_number: { type: Sequelize.STRING(30), allowNull: true }, // set right after insert
      order_id: fk('orders'),
      seller_order_id: fk('seller_orders', true), // null = the whole checkout (payment after cancellation)
      claim_id: fk('claims', true),
      cancellation_request_id: fk('cancellation_requests', true),
      buyer_id: fk('users'),
      source: {
        type: Sequelize.ENUM('buyer_cancel', 'seller_cancel', 'system_cancel', 'cancel_request', 'admin_cancel', 'admin_refund', 'claim', 'paid_after_cancel'),
        allowNull: false,
      },
      reason: text500,
      amount: money(),
      items_amount: money(),
      delivery_amount: money(),
      vat_amount: money(),
      status: { type: Sequelize.ENUM('pending', 'paid', 'failed'), allowNull: false, defaultValue: 'pending' },
      method: { type: Sequelize.ENUM('bank_transfer'), allowNull: false, defaultValue: 'bank_transfer' },
      bank_details: { type: Sequelize.JSON, allowNull: true }, // copy of the buyer's account (null = buyer must add it)
      due_by: date, // target date for AFA to pay
      // The seller was already paid (refund after completion): AFA must recover it from the seller
      recover_from_seller: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_by_type: { type: Sequelize.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: false },
      created_by_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      // Paid by the admin
      paid_at: date,
      paid_on: { type: Sequelize.DATEONLY, allowNull: true },
      paid_by: fk('admins', true, 'SET NULL'),
      bank_reference: { type: Sequelize.STRING(100), allowNull: true },
      admin_note: text500,
      proof_path: { type: Sequelize.STRING(255), allowNull: true },
      proof_original_name: { type: Sequelize.STRING(255), allowNull: true },
      proof_mime_type: { type: Sequelize.STRING(50), allowNull: true },
      proof_size_bytes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      failed_at: date,
      failed_reason: text500,
      ...ts,
    });
    await queryInterface.addIndex('refunds', ['refund_number'], { unique: true, name: 'refunds_number_unique' });
    await queryInterface.addIndex('refunds', ['order_id'], { name: 'refunds_order_idx' });
    await queryInterface.addIndex('refunds', ['buyer_id', 'created_at'], { name: 'refunds_buyer_idx' });
    await queryInterface.addIndex('refunds', ['status', 'due_by'], { name: 'refunds_status_due_idx' });

    // ---------- refund_accounts ----------
    await queryInterface.createTable('refund_accounts', {
      id,
      user_id: fk('users', false, 'CASCADE'),
      bank_name: { type: Sequelize.STRING(100), allowNull: false },
      account_name: { type: Sequelize.STRING(150), allowNull: false },
      account_number: { type: Sequelize.STRING(30), allowNull: false },
      branch_code: { type: Sequelize.STRING(20), allowNull: true },
      ...ts,
      deleted_at: date,
    });
    await queryInterface.addIndex('refund_accounts', ['user_id'], { name: 'refund_accounts_user_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('refund_accounts');
    await queryInterface.dropTable('refunds');
    await queryInterface.dropTable('claim_photos');
    await queryInterface.dropTable('claim_messages');
    await queryInterface.dropTable('claim_items');
    await queryInterface.dropTable('claims');
    await queryInterface.dropTable('cancellation_requests');
    await queryInterface.removeIndex('seller_orders', 'seller_orders_status_paid_idx');
    for (const col of ['active_claim_id', 'open_cancel_request_id', 'claim_status', 'refunded_amount', 'cancelled_by', 'cancel_reason']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn('seller_orders', col);
    }
  },
};
