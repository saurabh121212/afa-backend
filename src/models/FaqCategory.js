// FAQ category (Getting Started, Payments & Delivery, Orders, Loans & Insurance...). Soft delete.
module.exports = (sequelize, DataTypes) => {
  const FaqCategory = sequelize.define(
    'FaqCategory',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'faq_categories', paranoid: true }
  );

  FaqCategory.associate = (models) => {
    FaqCategory.hasMany(models.Faq, { as: 'faqs', foreignKey: 'categoryId' });
  };

  return FaqCategory;
};
