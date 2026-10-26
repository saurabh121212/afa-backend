// A question + answer in the Help Centre (Figma CMS -> FAQs). Soft delete.
module.exports = (sequelize, DataTypes) => {
  const Faq = sequelize.define(
    'Faq',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      categoryId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      question: { type: DataTypes.STRING(300), allowNull: false },
      answer: { type: DataTypes.TEXT, allowNull: false },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      viewCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'faqs', paranoid: true }
  );

  Faq.associate = (models) => {
    Faq.belongsTo(models.FaqCategory, { as: 'category', foreignKey: 'categoryId' });
  };

  return Faq;
};
