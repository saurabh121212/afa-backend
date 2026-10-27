// An answer the admin sent (by email) to a Contact Us message.
module.exports = (sequelize, DataTypes) => {
  const ContactReply = sequelize.define(
    'ContactReply',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      contactMessageId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      adminId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      emailSent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      emailError: { type: DataTypes.STRING(255), allowNull: true },
    },
    { tableName: 'contact_replies' }
  );

  ContactReply.associate = (models) => {
    ContactReply.belongsTo(models.ContactMessage, { as: 'contactMessage', foreignKey: 'contactMessageId' });
    ContactReply.belongsTo(models.Admin, { as: 'admin', foreignKey: 'adminId' });
  };

  return ContactReply;
};
