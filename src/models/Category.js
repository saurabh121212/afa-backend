// Product / service categories: Main category -> Sub-category (one table, linked by parentId).
//
//   appliesTo -> main categories only: 'product' | 'service' | 'both'
//   isActive  -> false = hidden from sellers and the website
//   deletedAt -> soft delete (paranoid): row kept in the database
const { APPLIES_TO } = require('../config/categories');

module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define(
    'Category',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      parentId: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: { notEmpty: true },
      },
      slug: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      appliesTo: {
        type: DataTypes.ENUM(...APPLIES_TO),
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      iconPath: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'categories',
      paranoid: true, // destroy() only sets deleted_at (no hard delete)
    }
  );

  Category.associate = (models) => {
    Category.belongsTo(models.Category, { as: 'parent', foreignKey: 'parentId' });
    Category.hasMany(models.Category, { as: 'subCategories', foreignKey: 'parentId' });
  };

  return Category;
};
