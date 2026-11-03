// A photo attached to a claim message. Private file: only the buyer, the seller and AFA can open it.
module.exports = (sequelize, DataTypes) => {
  const ClaimPhoto = sequelize.define(
    'ClaimPhoto',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      claimId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      messageId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      path: { type: DataTypes.STRING(255), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: true },
      mimeType: { type: DataTypes.STRING(50), allowNull: false },
      sizeBytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'claim_photos', updatedAt: false }
  );

  ClaimPhoto.associate = (models) => {
    ClaimPhoto.belongsTo(models.Claim, { as: 'claim', foreignKey: 'claimId' });
    ClaimPhoto.belongsTo(models.ClaimMessage, { as: 'message', foreignKey: 'messageId' });
  };

  return ClaimPhoto;
};
