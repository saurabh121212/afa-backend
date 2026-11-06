'use strict';

// Notifications module. ADD-ONLY: three new tables.
//
//   notifications  -> one row per recipient (a user, or one admin): the bell + the push that went with it.
//                     Kept for good (never removed by the system); a user "deleting" one only hides it (deleted_at).
//   device_tokens  -> Firebase Cloud Messaging tokens of the users' phones / browsers (one row per device)
//   broadcasts     -> admin advisories / announcements: audience, send now or later, delivery counts

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const id = { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false };
    const fk = (table, nullable = true, onDelete = 'CASCADE') => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: nullable,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete,
    });
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };

    // ---------- broadcasts (first: notifications point to it) ----------
    await queryInterface.createTable('broadcasts', {
      id,
      category: { type: Sequelize.ENUM('advisory', 'announcement'), allowNull: false },
      title: { type: Sequelize.STRING(120), allowNull: false },
      body: { type: Sequelize.STRING(1000), allowNull: false },
      link_url: { type: Sequelize.STRING(500), allowNull: true }, // optional "Read more" link
      // { type: 'all' | 'filter' | 'users', userTypes: [], regionIds: [], userIds: [] }
      audience: { type: Sequelize.JSON, allowNull: false },
      status: { type: Sequelize.ENUM('scheduled', 'sending', 'sent', 'cancelled'), allowNull: false, defaultValue: 'scheduled' },
      scheduled_at: { type: Sequelize.DATE, allowNull: false }, // when to send (now = the creation time)
      started_at: { type: Sequelize.DATE, allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      recipient_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      push_sent_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      push_failed_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_by: fk('admins', true, 'SET NULL'),
      updated_by: fk('admins', true, 'SET NULL'),
      cancelled_by: fk('admins', true, 'SET NULL'),
      cancelled_at: { type: Sequelize.DATE, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('broadcasts', ['status', 'scheduled_at'], { name: 'broadcasts_status_due_idx' });

    // ---------- notifications ----------
    await queryInterface.createTable('notifications', {
      id,
      recipient_type: { type: Sequelize.ENUM('user', 'admin'), allowNull: false },
      user_id: fk('users'),
      admin_id: fk('admins'),
      category: {
        type: Sequelize.ENUM('orders', 'payments', 'refunds', 'listings', 'account', 'advisories', 'announcements', 'admin'),
        allowNull: false,
      },
      type: { type: Sequelize.STRING(50), allowNull: false }, // e.g. order.new, refund.paid
      title: { type: Sequelize.STRING(150), allowNull: false },
      body: { type: Sequelize.STRING(1000), allowNull: false },
      data: { type: Sequelize.JSON, allowNull: true }, // { screen, orderId, sellerOrderId, claimId, ... } for the app
      broadcast_id: fk('broadcasts', true, 'SET NULL'),
      read_at: { type: Sequelize.DATE, allowNull: true },
      push_status: {
        type: Sequelize.ENUM('pending', 'sent', 'failed', 'no_device', 'off'),
        allowNull: false,
        defaultValue: 'pending',
      },
      pushed_at: { type: Sequelize.DATE, allowNull: true },
      ...ts,
      deleted_at: { type: Sequelize.DATE, allowNull: true }, // hidden by the user
    });
    await queryInterface.addIndex('notifications', ['user_id', 'deleted_at', 'read_at'], { name: 'notifications_user_idx' });
    await queryInterface.addIndex('notifications', ['admin_id', 'deleted_at', 'read_at'], { name: 'notifications_admin_idx' });
    await queryInterface.addIndex('notifications', ['user_id', 'created_at'], { name: 'notifications_user_created_idx' });
    await queryInterface.addIndex('notifications', ['broadcast_id'], { name: 'notifications_broadcast_idx' });

    // ---------- device_tokens ----------
    await queryInterface.createTable('device_tokens', {
      id,
      user_id: fk('users', false),
      token: { type: Sequelize.STRING(500), allowNull: false },
      platform: { type: Sequelize.ENUM('android', 'ios', 'web'), allowNull: false },
      device_name: { type: Sequelize.STRING(100), allowNull: true },
      app_version: { type: Sequelize.STRING(30), allowNull: true },
      last_seen_at: { type: Sequelize.DATE, allowNull: false },
      last_error: { type: Sequelize.STRING(255), allowNull: true },
      ...ts,
      deleted_at: { type: Sequelize.DATE, allowNull: true }, // logged out / token no longer valid
    });
    await queryInterface.addIndex('device_tokens', ['token'], { unique: true, name: 'device_tokens_token_unique' });
    await queryInterface.addIndex('device_tokens', ['user_id', 'deleted_at'], { name: 'device_tokens_user_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('device_tokens');
    await queryInterface.dropTable('notifications');
    await queryInterface.dropTable('broadcasts');
  },
};
