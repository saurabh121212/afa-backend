// Internal notes the admin writes about a user (never shown to the user).
module.exports = (sequelize, DataTypes) => {
  const AdminNote = sequelize.define(
    'AdminNote',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      adminId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      note: { type: DataTypes.TEXT, allowNull: false },
    },
    { tableName: 'admin_notes' }
  );

  AdminNote.associate = (models) => {
    AdminNote.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    AdminNote.belongsTo(models.Admin, { as: 'admin', foreignKey: 'adminId' });
  };

  return AdminNote;
};
