// A user reporting a review (one report per user per review). The admin resolves it: hide the review or keep it.
const { REPORT_REASONS, REPORT_STATUS } = require('../config/reviews');

module.exports = (sequelize, DataTypes) => {
  const ReviewReport = sequelize.define(
    'ReviewReport',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      reviewId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      reporterId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      reason: { type: DataTypes.ENUM(...Object.keys(REPORT_REASONS)), allowNull: false },
      note: { type: DataTypes.STRING(500), allowNull: true },
      status: { type: DataTypes.ENUM(...Object.values(REPORT_STATUS)), allowNull: false, defaultValue: REPORT_STATUS.OPEN },
      resolution: { type: DataTypes.STRING(30), allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
      resolvedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'review_reports' }
  );

  ReviewReport.associate = (models) => {
    ReviewReport.belongsTo(models.Review, { as: 'review', foreignKey: 'reviewId' });
    ReviewReport.belongsTo(models.User, { as: 'reporter', foreignKey: 'reporterId' });
  };

  return ReviewReport;
};
