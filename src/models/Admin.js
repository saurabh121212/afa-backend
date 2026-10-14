// Sequelize model for the "admins" table (the single AFA system admin).
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

module.exports = (sequelize, DataTypes) => {
  const Admin = sequelize.define(
    'Admin',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: { notEmpty: true, len: [2, 100] },
      },
      email: {
        type: DataTypes.STRING(150),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
        set(value) {
          this.setDataValue('email', String(value).trim().toLowerCase());
        },
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'admins',

      // Never send the password hash back by accident.
      defaultScope: {
        attributes: { exclude: ['password'] },
      },
      scopes: {
        withPassword: { attributes: { include: ['password'] } },
      },

      hooks: {
        // Hash the password whenever it is set or changed.
        async beforeSave(admin) {
          if (admin.changed('password')) {
            admin.password = await bcrypt.hash(admin.password, SALT_ROUNDS);
          }
        },
      },
    }
  );

  // Check a plain password against the stored hash (used at login).
  Admin.prototype.comparePassword = function comparePassword(plain) {
    return bcrypt.compare(plain, this.password);
  };

  // Remove the hash from JSON output even if it was loaded.
  Admin.prototype.toJSON = function toJSON() {
    const values = { ...this.get() };
    delete values.password;
    return values;
  };

  return Admin;
};
