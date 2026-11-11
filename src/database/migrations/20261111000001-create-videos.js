'use strict';

// CMS: Video Gallery (Admin "Content Management" -> Videos, website /gallery).
//   videos -> a title, a description and a link (YouTube or any https video page).
//             youtube_id is worked out from the link, so the website can show YouTube's thumbnail
//             and player; null for other links.
// Only active videos are on the website. Soft delete (deleted_at), like banners and blogs.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const adminFk = {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'admins', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    };

    await queryInterface.createTable('videos', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      title: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.STRING(1000), allowNull: false },
      link: { type: Sequelize.STRING(500), allowNull: false }, // e.g. https://www.youtube.com/watch?v=...
      youtube_id: { type: Sequelize.STRING(11), allowNull: true }, // null = not a YouTube link
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }, // lower first
      created_by: adminFk,
      updated_by: adminFk,
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('videos', ['is_active', 'sort_order'], { name: 'videos_public_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('videos');
  },
};
