// A member of a chat conversation. participantType + participantId: 'user' -> users.id today
// (other kinds, e.g. 'admin', can join later). lastReadMessageId drives the unread count.
module.exports = (sequelize, DataTypes) => {
  const ChatParticipant = sequelize.define(
    'ChatParticipant',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      conversationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      participantType: { type: DataTypes.STRING(10), allowNull: false },
      participantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      userType: { type: DataTypes.STRING(30), allowNull: true },
      role: { type: DataTypes.STRING(20), allowNull: true },
      lastReadMessageId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      lastReadAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'chat_participants',
    }
  );

  ChatParticipant.associate = (models) => {
    ChatParticipant.belongsTo(models.ChatConversation, { as: 'conversation', foreignKey: 'conversationId' });
  };

  return ChatParticipant;
};
