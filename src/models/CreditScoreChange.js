// One change of a user's credit score (old -> new, which parts changed, what caused it). Never deleted.
module.exports = (sequelize, DataTypes) => {
  const CreditScoreChange = sequelize.define(
    'CreditScoreChange',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      oldScore: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      newScore: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
      grade: { type: DataTypes.STRING(20), allowNull: false },
      parts: { type: DataTypes.JSON, allowNull: false },
      changedParts: { type: DataTypes.JSON, allowNull: true },
      trigger: { type: DataTypes.STRING(255), allowNull: false }, // e.g. "order_cancelled,rating"
      formulaVersion: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
    },
    { tableName: 'credit_score_changes', updatedAt: false }
  );

  CreditScoreChange.associate = (models) => {
    CreditScoreChange.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
  };

  return CreditScoreChange;
};
