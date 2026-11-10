// The current credit score of a farmer / trader / logistics provider (one row per user).
// Worked out by services/creditScore.service.js; every change is logged in CreditScoreChange.
module.exports = (sequelize, DataTypes) => {
  // a NEW object for every column: Sequelize changes the object it is given, so one object shared by
  // several columns would map them all to the first column's name
  const part = () => ({ type: DataTypes.DECIMAL(4, 1), allowNull: false, defaultValue: 0 });
  const CreditScore = sequelize.define(
    'CreditScore',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      score: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      grade: { type: DataTypes.STRING(20), allowNull: false },
      kycPoints: part(),
      salesPoints: part(),
      loanPoints: part(),
      insurancePoints: part(),
      ratingPoints: part(),
      details: { type: DataTypes.JSON, allowNull: true },
      formulaVersion: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      calculatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: 'credit_scores' }
  );

  CreditScore.associate = (models) => {
    CreditScore.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
  };

  return CreditScore;
};
