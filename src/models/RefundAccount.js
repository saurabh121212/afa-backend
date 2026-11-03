// The buyer's saved bank account for refunds ("save for next time"). One live row per buyer.
// Removing it only sets deleted_at.
module.exports = (sequelize, DataTypes) => {
  const RefundAccount = sequelize.define(
    'RefundAccount',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      bankName: { type: DataTypes.STRING(100), allowNull: false },
      accountName: { type: DataTypes.STRING(150), allowNull: false },
      accountNumber: { type: DataTypes.STRING(30), allowNull: false },
      branchCode: { type: DataTypes.STRING(20), allowNull: true },
    },
    { tableName: 'refund_accounts', paranoid: true }
  );

  RefundAccount.associate = (models) => {
    RefundAccount.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
  };

  return RefundAccount;
};
