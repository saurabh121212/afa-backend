// A message sent with the website / app Contact Us form. Soft delete (deleted_at).
const { CONTACT_STATUSES } = require('../config/contact');

module.exports = (sequelize, DataTypes) => {
  const ContactMessage = sequelize.define(
    'ContactMessage',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      fullName: { type: DataTypes.STRING(150), allowNull: false },
      email: { type: DataTypes.STRING(150), allowNull: false },
      phone: { type: DataTypes.STRING(20), allowNull: true },
      senderType: { type: DataTypes.STRING(30), allowNull: false },
      subject: { type: DataTypes.STRING(30), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.ENUM(...Object.keys(CONTACT_STATUSES)), allowNull: false, defaultValue: 'new' },
      ipAddress: { type: DataTypes.STRING(45), allowNull: true },
      userAgent: { type: DataTypes.STRING(255), allowNull: true },
      readAt: { type: DataTypes.DATE, allowNull: true },
      readBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      repliedAt: { type: DataTypes.DATE, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'contact_messages', paranoid: true }
  );

  ContactMessage.associate = (models) => {
    ContactMessage.hasMany(models.ContactReply, { as: 'replies', foreignKey: 'contactMessageId' });
  };

  return ContactMessage;
};
