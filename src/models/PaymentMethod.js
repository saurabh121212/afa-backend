// A user's bank account or mobile money account (Figma "Bank & Payment Details").
// The bank account number is stored encrypted; see utils/encryption.js.
const { PAYMENT_METHOD_TYPES, BANK_ACCOUNT_TYPES } = require('../config/paymentMethods');

module.exports = (sequelize, DataTypes) => {
  const PaymentMethod = sequelize.define(
    'PaymentMethod',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      methodType: { type: DataTypes.ENUM(...PAYMENT_METHOD_TYPES), allowNull: false },
      isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      accountHolderName: { type: DataTypes.STRING(150), allowNull: false },
      // Bank account
      bankName: { type: DataTypes.STRING(100), allowNull: true },
      accountNumberEncrypted: { type: DataTypes.STRING(255), allowNull: true },
      accountNumberLast4: { type: DataTypes.STRING(4), allowNull: true },
      accountNumberHash: { type: DataTypes.STRING(64), allowNull: true },
      accountType: { type: DataTypes.ENUM(...BANK_ACCOUNT_TYPES), allowNull: true },
      branchCode: { type: DataTypes.STRING(10), allowNull: true },
      // Mobile money
      provider: { type: DataTypes.STRING(50), allowNull: true },
      mobileNumber: { type: DataTypes.STRING(20), allowNull: true },
    },
    {
      tableName: 'payment_methods',
      paranoid: true, // destroy() only sets deleted_at (no hard delete)
    }
  );

  PaymentMethod.associate = (models) => {
    PaymentMethod.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
  };

  return PaymentMethod;
};
