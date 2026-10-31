'use strict';

// Blog (Admin "Content Management" -> Blog & Resources, website /blog and /blog/<slug>).
//   status            -> draft | published | archived (config/blog.js)
//   show_on_homepage  -> published posts with this on are listed on the homepage
//   slug              -> the post's web address, unique (deleted posts keep theirs)
//   content           -> HTML from the admin's editor, cleaned on save
// Soft delete (deleted_at).

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

    await queryInterface.createTable('blogs', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      title: { type: Sequelize.STRING(200), allowNull: false },
      slug: { type: Sequelize.STRING(200), allowNull: false },
      excerpt: { type: Sequelize.STRING(300), allowNull: true }, // empty = taken from the start of the post
      content: { type: Sequelize.TEXT('medium'), allowNull: false },
      category: { type: Sequelize.STRING(50), allowNull: true }, // e.g. "Guide", "Finance"
      author_name: { type: Sequelize.STRING(100), allowNull: true }, // empty = "AFA Editorial"
      cover_image_path: { type: Sequelize.STRING(255), allowNull: true }, // relative to UPLOAD_DIR
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'draft' },
      show_on_homepage: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      published_at: { type: Sequelize.DATE, allowNull: true }, // first time it was published
      created_by: adminFk,
      updated_by: adminFk,
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('blogs', ['slug'], { unique: true, name: 'blogs_slug_unique' });
    await queryInterface.addIndex('blogs', ['status', 'show_on_homepage', 'published_at'], { name: 'blogs_public_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('blogs');
  },
};
