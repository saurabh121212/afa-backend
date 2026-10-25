// A message in a chat conversation. type 'text' today; other types (attachments, system notes)
// keep their details in metadata. clientMsgId makes a retried send idempotent. Soft delete.
module.exports = (sequelize, DataTypes) => {
  const ChatMessage = sequelize.define(
    'ChatMessage',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      conversationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      senderType: { type: DataTypes.STRING(10), allowNull: false },
      senderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'text' },
      body: { type: DataTypes.TEXT, allowNull: true },
      metadata: { type: DataTypes.JSON, allowNull: true },
      clientMsgId: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      tableName: 'chat_messages',
      paranoid: true,
    }
  );

  ChatMessage.associate = (models) => {
    ChatMessage.belongsTo(models.ChatConversation, { as: 'conversation', foreignKey: 'conversationId' });
  };

  return ChatMessage;
};
