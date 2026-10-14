// KYC documents uploaded by users (table "user_documents").
module.exports = (sequelize, DataTypes) => {
  const UserDocument = sequelize.define(
    'UserDocument',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      documentType: { type: DataTypes.STRING(50), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: false },
      filePath: { type: DataTypes.STRING(500), allowNull: false }, // relative to UPLOAD_DIR
      mimeType: { type: DataTypes.STRING(100), allowNull: false },
      sizeBytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      rejectionReason: { type: DataTypes.TEXT, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      reviewedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    {
      tableName: 'user_documents',
      indexes: [
        { unique: true, fields: ['user_id', 'document_type'], name: 'user_documents_user_type_unique' },
      ],
    }
  );

  UserDocument.associate = (models) => {
    UserDocument.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    UserDocument.belongsTo(models.Admin, { as: 'reviewer', foreignKey: 'reviewedBy' });
  };

  // Never expose the server folder path to the client
  UserDocument.prototype.toJSON = function toJSON() {
    const values = { ...this.get() };
    delete values.filePath;
    return values;
  };

  return UserDocument;
};
