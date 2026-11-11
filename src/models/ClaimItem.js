// One claimed order item and how much of it (a copy of the price at ordering time).
module.exports = (sequelize, DataTypes) => {
  const money = () => ({ type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
  const ClaimItem = sequelize.define(
    'ClaimItem',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      claimId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      orderItemId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      unitLabel: { type: DataTypes.STRING(50), allowNull: true },
      unitPrice: money(),
      quantity: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      amount: money(),
      vatAmount: money(),
    },
    { tableName: 'claim_items' }
  );

  ClaimItem.associate = (models) => {
    ClaimItem.belongsTo(models.Claim, { as: 'claim', foreignKey: 'claimId' });
    ClaimItem.belongsTo(models.OrderItem, { as: 'orderItem', foreignKey: 'orderItemId' });
  };

  return ClaimItem;
};
