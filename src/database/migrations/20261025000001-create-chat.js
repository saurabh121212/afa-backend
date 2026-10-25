'use strict';

// Chat (Figma "Messages / Chat"): conversations between accounts, e.g. a buyer asking a seller
// about a listing. Kept generic so other roles / topics can be added later without schema changes:
//
//   chat_conversations  -> one row per conversation, optionally about a "subject" (today: a listing)
//   chat_participants   -> who is in it (participant_type + participant_id: 'user' today, 'admin' later)
//   chat_messages       -> the messages (type 'text' today; attachments etc. later via type + metadata)
//
// One conversation per subject + set of participants (unique key), so starting a chat about the
// same listing again re-opens the existing conversation instead of creating a duplicate.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };

    await queryInterface.createTable('chat_conversations', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      // What the conversation is about: 'listing' + listing id. 'none' + 0 = a plain conversation.
      subject_type: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'none' },
      subject_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      // Copy of the subject when the conversation started (name, price, photo), so the seller still
      // sees what was asked about after the listing changes or is deleted.
      subject_snapshot: { type: Sequelize.JSON, allowNull: true },
      // Sorted participant keys, e.g. "user:4|user:9" (part of the unique key below)
      participants_key: { type: Sequelize.STRING(191), allowNull: false },
      created_by_type: { type: Sequelize.STRING(10), allowNull: false },
      created_by_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      last_message_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
      last_message_at: { type: Sequelize.DATE, allowNull: true },
      ...ts,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('chat_conversations', ['subject_type', 'subject_id', 'participants_key'], {
      unique: true,
      name: 'chat_conversations_subject_participants_unique',
    });
    await queryInterface.addIndex('chat_conversations', ['last_message_at'], { name: 'chat_conversations_last_message_idx' });

    await queryInterface.createTable('chat_participants', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      conversation_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'chat_conversations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // 'user' -> users.id. Not a foreign key, so other participant kinds (e.g. 'admin') fit later.
      participant_type: { type: Sequelize.STRING(10), allowNull: false },
      participant_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      // The account's role when it joined (buyer, farmer...) and its part in the conversation
      // ('starter' = asked about the subject, 'owner' = owns the subject, e.g. the seller).
      user_type: { type: Sequelize.STRING(30), allowNull: true },
      role: { type: Sequelize.STRING(20), allowNull: true },
      // Everything up to this message has been read (unread count = newer messages from others)
      last_read_message_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
      last_read_at: { type: Sequelize.DATE, allowNull: true },
      ...ts,
    });
    await queryInterface.addIndex('chat_participants', ['conversation_id', 'participant_type', 'participant_id'], {
      unique: true,
      name: 'chat_participants_conversation_participant_unique',
    });
    await queryInterface.addIndex('chat_participants', ['participant_type', 'participant_id'], {
      name: 'chat_participants_participant_idx',
    });

    await queryInterface.createTable('chat_messages', {
      id: { type: Sequelize.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      conversation_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'chat_conversations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // 'user' / 'admin' / 'system' (sender_id NULL for system messages)
      sender_type: { type: Sequelize.STRING(10), allowNull: false },
      sender_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      // 'text' today. Later e.g. 'attachment' / 'system', with their details in metadata.
      type: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'text' },
      body: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: true },
      // Id made by the app for each message it sends: a retried send is saved only once.
      client_msg_id: { type: Sequelize.STRING(64), allowNull: true },
      ...ts,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('chat_messages', ['conversation_id', 'id'], { name: 'chat_messages_conversation_idx' });
    await queryInterface.addIndex('chat_messages', ['sender_type', 'sender_id', 'client_msg_id'], {
      unique: true,
      name: 'chat_messages_sender_client_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chat_messages');
    await queryInterface.dropTable('chat_participants');
    await queryInterface.dropTable('chat_conversations');
  },
};
