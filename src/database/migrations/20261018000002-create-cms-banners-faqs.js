'use strict';

// CMS: Banners + FAQs (Figma "Content Management" -> Banners / FAQs, website "Help Centre").
//   banners         -> image banners per placement, with optional start / end dates
//   faq_categories  -> Getting Started, Payments & Delivery, Orders, Loans & Insurance...
//   faqs            -> question + answer in a category; view_count feeds "Most Viewed Category"
// All three use soft delete (deleted_at).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    };
    const adminFk = {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'admins', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    };

    await queryInterface.createTable('banners', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      title: { type: Sequelize.STRING(150), allowNull: false },
      subtitle: { type: Sequelize.STRING(300), allowNull: true },
      button_text: { type: Sequelize.STRING(40), allowNull: true }, // e.g. "Register Now"
      link_url: { type: Sequelize.STRING(500), allowNull: true }, // "/marketplace" or "https://..."
      placement: { type: Sequelize.STRING(40), allowNull: false },
      image_path: { type: Sequelize.STRING(255), allowNull: true }, // relative to UPLOAD_DIR
      starts_at: { type: Sequelize.DATE, allowNull: true }, // empty = from now
      ends_at: { type: Sequelize.DATE, allowNull: true }, // empty = no end date
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_by: adminFk,
      updated_by: adminFk,
      ...ts,
    });
    await queryInterface.addIndex('banners', ['placement', 'is_active', 'sort_order'], { name: 'banners_placement_idx' });

    await queryInterface.createTable('faq_categories', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(100), allowNull: false },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...ts,
    });

    await queryInterface.createTable('faqs', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      category_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'faq_categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      question: { type: Sequelize.STRING(300), allowNull: false },
      answer: { type: Sequelize.TEXT, allowNull: false },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }, // false = hidden from the Help Centre
      view_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_by: adminFk,
      updated_by: adminFk,
      ...ts,
    });
    await queryInterface.addIndex('faqs', ['category_id', 'is_active', 'sort_order'], { name: 'faqs_category_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('faqs');
    await queryInterface.dropTable('faq_categories');
    await queryInterface.dropTable('banners');
  },
};
