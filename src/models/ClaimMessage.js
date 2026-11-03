// Claim conversation: messages from the buyer, the seller and AFA, plus system events
// (event = opened / accepted / rejected / escalated / decided / returned / return_received / withdrawn / closed).
module.exports = (sequelize, DataTypes) => {
  const ClaimMessage = sequelize.define(
    'ClaimMessage',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      claimId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      senderType: { type: DataTypes.ENUM('buyer', 'seller', 'admin', 'system'), allowNull: false },
      senderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      event: { type: DataTypes.STRING(30), allowNull: true },
      message: { type: DataTypes.STRING(2000), allowNull: true },
    },
    { tableName: 'claim_messages', updatedAt: false }
  );

  ClaimMessage.associate = (models) => {
    ClaimMessage.belongsTo(models.Claim, { as: 'claim', foreignKey: 'claimId' });
    ClaimMessage.hasMany(models.ClaimPhoto, { as: 'photos', foreignKey: 'messageId' });
  };

  return ClaimMessage;
};
