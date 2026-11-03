'use strict';

// Invoices, credit notes and receipts. ADD-ONLY: two new tables.
//
//   invoices           -> every document AFA issues, with a FROZEN copy of everything printed on it
//                         (later changes to the seller, the buyer or the settings never change it):
//                           invoice      AFA-INV-000001  one per seller order, when the order is paid
//                                                        ("Tax Invoice" when the seller is VAT-registered)
//                           credit_note  AFA-CN-000001   one per refund on an invoiced seller order
//                           receipt      AFA-RCT-000001  one per paid checkout (the payment)
//                         The proforma invoice (unpaid bank transfer) is NOT stored: it is made on request.
//   document_counters  -> the last number used per document type (one running series each)
//
// Documents are never deleted or edited.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const fk = (table, nullable = false) => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: nullable,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    const now = { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    await queryInterface.createTable('invoices', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      type: { type: Sequelize.ENUM('invoice', 'credit_note', 'receipt'), allowNull: false },
      number: { type: Sequelize.STRING(30), allowNull: false },
      is_tax_invoice: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      order_id: fk('orders'),
      seller_order_id: fk('seller_orders', true), // invoice / credit note
      refund_id: fk('refunds', true), // credit note
      payment_id: fk('payments', true), // receipt
      related_invoice_id: fk('invoices', true), // credit note -> the invoice it reduces
      buyer_id: fk('users'),
      seller_id: fk('users', true),
      issued_at: { type: Sequelize.DATE, allowNull: false }, // the document date
      subtotal: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      vat_total: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      total: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'SZL' },
      data: { type: Sequelize.JSON, allowNull: false }, // frozen copy of what is printed
      created_at: now,
      updated_at: now,
    });
    await queryInterface.addIndex('invoices', ['number'], { unique: true, name: 'invoices_number_unique' });
    await queryInterface.addIndex('invoices', ['type', 'seller_order_id'], { name: 'invoices_type_seller_order_idx' });
    await queryInterface.addIndex('invoices', ['refund_id'], { name: 'invoices_refund_idx' });
    await queryInterface.addIndex('invoices', ['order_id'], { name: 'invoices_order_idx' });
    await queryInterface.addIndex('invoices', ['buyer_id', 'issued_at'], { name: 'invoices_buyer_idx' });
    await queryInterface.addIndex('invoices', ['seller_id', 'issued_at'], { name: 'invoices_seller_idx' });

    await queryInterface.createTable('document_counters', {
      name: { type: Sequelize.STRING(30), primaryKey: true, allowNull: false }, // invoice | credit_note | receipt
      last_value: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      updated_at: now,
    });
    await queryInterface.bulkInsert('document_counters', [
      { name: 'invoice', last_value: 0 },
      { name: 'credit_note', last_value: 0 },
      { name: 'receipt', last_value: 0 },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('document_counters');
    await queryInterface.dropTable('invoices');
  },
};
