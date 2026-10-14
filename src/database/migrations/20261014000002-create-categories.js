'use strict';

// Product / service categories (one table, two levels):
//   Main category (parent_id = NULL)  ->  Sub-category (parent_id = main category)
//
//   applies_to -> only for main categories: product | service | both
//   is_active  -> false = hidden from sellers and the website
//   deleted_at -> soft delete (rows are never removed)

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('categories', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      parent_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      slug: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      applies_to: {
        type: Sequelize.ENUM('product', 'service', 'both'),
        allowNull: true, // NULL for sub-categories (they use the main category's value)
      },
      description: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      icon_path: {
        type: Sequelize.STRING(255),
        allowNull: true, // relative to UPLOAD_DIR, e.g. public/categories/cat-3-....png
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex('categories', ['slug'], { unique: true, name: 'categories_slug_unique' });
    await queryInterface.addIndex('categories', ['parent_id', 'name'], { name: 'categories_parent_name_idx' });
    await queryInterface.addIndex('categories', ['applies_to', 'is_active'], { name: 'categories_applies_active_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('categories');
  },
};
