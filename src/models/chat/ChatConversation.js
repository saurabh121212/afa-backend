// A chat conversation, optionally about a subject (today: a marketplace listing).
// One per subject + set of participants (see the chat migration). Soft delete (deleted_at).
module.exports = (sequelize, DataTypes) => {
  const ChatConversation = sequelize.define(
    'ChatConversation',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      subjectType: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'none' },
      subjectId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      subjectSnapshot: { type: DataTypes.JSON, allowNull: true },
      participantsKey: { type: DataTypes.STRING(191), allowNull: false },
      createdByType: { type: DataTypes.STRING(10), allowNull: false },
      createdById: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      lastMessageId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      lastMessageAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'chat_conversations',
      paranoid: true,
    }
  );

  ChatConversation.associate = (models) => {
    ChatConversation.hasMany(models.ChatParticipant, { as: 'participants', foreignKey: 'conversationId' });
    // The same participants again, under another name, to filter "conversations I am in"
    ChatConversation.hasMany(models.ChatParticipant, { as: 'membership', foreignKey: 'conversationId' });
    ChatConversation.hasMany(models.ChatMessage, { as: 'messages', foreignKey: 'conversationId' });
  };

  return ChatConversation;
};
