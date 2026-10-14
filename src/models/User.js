// Sequelize model for the "users" table (all marketplace user types).
const bcrypt = require('bcryptjs');
const { USER_TYPES, USER_STATUS } = require('../utils/constants');

const SALT_ROUNDS = 12;

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userType: {
        type: DataTypes.ENUM(...USER_TYPES),
        allowNull: false,
      },
      // Email and mobile are unique PER USER TYPE (same person can be a farmer and a buyer)
      email: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { isEmail: true },
        set(value) {
          this.setDataValue('email', String(value).trim().toLowerCase());
        },
      },
      mobile: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...Object.values(USER_STATUS)),
        allowNull: false,
        defaultValue: USER_STATUS.PENDING_VERIFICATION,
      },
      registrationStep: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 1,
      },
      emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      termsAcceptedAt: { type: DataTypes.DATE, allowNull: true },
      privacyAcceptedAt: { type: DataTypes.DATE, allowNull: true },
      accuracyConfirmedAt: { type: DataTypes.DATE, allowNull: true },
      submittedAt: { type: DataTypes.DATE, allowNull: true },
      rejectionReason: { type: DataTypes.TEXT, allowNull: true },
      // Admin approval (latest status change)
      approvedAt: { type: DataTypes.DATE, allowNull: true },
      statusReason: { type: DataTypes.TEXT, allowNull: true }, // admin's message / reason
      statusChangedAt: { type: DataTypes.DATE, allowNull: true },
      statusChangedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }, // admin id
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
      passwordChangedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'users',
      paranoid: true, // destroy() = "disable": sets deleted_at, keeps the row

      // Same as the database (migration ...000006): unique per user type
      indexes: [
        { unique: true, fields: ['user_type', 'email'], name: 'users_type_email_unique' },
        { unique: true, fields: ['user_type', 'mobile'], name: 'users_type_mobile_unique' },
      ],

      defaultScope: {
        attributes: { exclude: ['password'] },
      },
      scopes: {
        withPassword: { attributes: { include: ['password'] } },
      },

      hooks: {
        async beforeSave(user) {
          if (user.changed('password')) {
            user.password = await bcrypt.hash(user.password, SALT_ROUNDS);
            // A changed password (not the first one) logs out all old tokens.
            if (!user.isNewRecord) user.passwordChangedAt = new Date();
          }
        },
      },
    }
  );

  User.associate = (models) => {
    User.hasOne(models.FarmerProfile, { as: 'farmerProfile', foreignKey: 'userId' });
    User.hasOne(models.BuyerProfile, { as: 'buyerProfile', foreignKey: 'userId' });
    User.hasOne(models.TraderProfile, { as: 'traderProfile', foreignKey: 'userId' });
    User.hasOne(models.LogisticsProfile, { as: 'logisticsProfile', foreignKey: 'userId' });
    User.hasOne(models.FiProfile, { as: 'fiProfile', foreignKey: 'userId' });
    User.hasMany(models.UserDocument, { as: 'documents', foreignKey: 'userId' });
    User.hasMany(models.AdminNote, { as: 'adminNotes', foreignKey: 'userId' });
  };

  User.prototype.comparePassword = function comparePassword(plain) {
    return bcrypt.compare(plain, this.password);
  };

  User.prototype.toJSON = function toJSON() {
    const values = { ...this.get() };
    delete values.password;
    return values;
  };

  return User;
};
