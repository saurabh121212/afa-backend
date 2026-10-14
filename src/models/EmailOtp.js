// One-time codes sent by email. Only the SHA-256 hash is stored.
const { OTP_PURPOSES } = require('../utils/constants');

module.exports = (sequelize, DataTypes) => {
  const EmailOtp = sequelize.define(
    'EmailOtp',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      email: { type: DataTypes.STRING(150), allowNull: false },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      purpose: { type: DataTypes.ENUM(...Object.values(OTP_PURPOSES)), allowNull: false },
      otpHash: { type: DataTypes.STRING(64), allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      consumedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'email_otps' }
  );

  return EmailOtp;
};
