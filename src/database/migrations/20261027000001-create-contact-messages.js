'use strict';

// Contact Us messages (public form) + the admin's replies.
//   contact_messages -> one row per message sent from the website / app (soft delete)
//   contact_replies  -> answers the admin sent by email (kept for the record)

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };
    const adminFk = {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'admins', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    };

    await queryInterface.createTable('contact_messages', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      full_name: { type: Sequelize.STRING(150), allowNull: false },
      email: { type: Sequelize.STRING(150), allowNull: false },
      phone: { type: Sequelize.STRING(20), allowNull: true },
      sender_type: { type: Sequelize.STRING(30), allowNull: false }, // farmer, buyer, trader, ..., other
      subject: { type: Sequelize.STRING(30), allowNull: false }, // general_enquiry, technical_support, ...
      message: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.ENUM('new', 'read', 'replied', 'closed'), allowNull: false, defaultValue: 'new' },
      ip_address: { type: Sequelize.STRING(45), allowNull: true },
      user_agent: { type: Sequelize.STRING(255), allowNull: true },
      read_at: { type: Sequelize.DATE, allowNull: true },
      read_by: adminFk,
      replied_at: { type: Sequelize.DATE, allowNull: true },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      ...ts,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('contact_messages', ['status', 'created_at'], { name: 'contact_messages_status_idx' });
    await queryInterface.addIndex('contact_messages', ['email'], { name: 'contact_messages_email_idx' });

    await queryInterface.createTable('contact_replies', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      contact_message_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'contact_messages', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      admin_id: adminFk,
      message: { type: Sequelize.TEXT, allowNull: false },
      email_sent: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      email_error: { type: Sequelize.STRING(255), allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('contact_replies', ['contact_message_id'], { name: 'contact_replies_message_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('contact_replies');
    await queryInterface.dropTable('contact_messages');
  },
};
