// Buyer details: Step 1 (Buyer Information) + Step 3 "Order & Price Alerts" setting.
const { BUYER_TYPES } = require('../utils/constants');

module.exports = (sequelize, DataTypes) => {
  const BuyerProfile = sequelize.define(
    'BuyerProfile',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },

      buyerType: { type: DataTypes.ENUM(...BUYER_TYPES), allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false }, // full name or business name
      idNumberTin: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      deliveryAddress: { type: DataTypes.STRING(255), allowNull: false },
      regionId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      inkhundlaId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      umphakatsiId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

      orderPriceAlerts: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'buyer_profiles' }
  );

  BuyerProfile.associate = (models) => {
    BuyerProfile.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });

    // Three links to the same "locations" table, each with its own nickname
    BuyerProfile.belongsTo(models.Location, { as: 'region', foreignKey: 'regionId' });
    BuyerProfile.belongsTo(models.Location, { as: 'inkhundla', foreignKey: 'inkhundlaId' });
    BuyerProfile.belongsTo(models.Location, { as: 'umphakatsi', foreignKey: 'umphakatsiId' });
  };

  return BuyerProfile;
};
