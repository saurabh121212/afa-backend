'use strict';

// Reviews & Ratings. ADD-ONLY: new tables + new columns.
//
//   reviews          one per seller order: 1-5 stars + comment, status (published / held / hidden), the seller's reply
//   review_listings  which listings a review counts for (every listing in that seller order)
//   review_reports   users reporting a review (one per user per review)
//   users.rating_avg / rating_count, listings.rating_avg / rating_count
//                    averages of PUBLISHED reviews, kept up to date (used for "4.8 (42 reviews)", the rating filter and sort)

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const id = { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false };
    const fk = (table, nullable = false) => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: nullable,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };

    // ---------- averages ----------
    for (const table of ['users', 'listings']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.addColumn(table, 'rating_avg', { type: Sequelize.DECIMAL(3, 2), allowNull: true });
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.addColumn(table, 'rating_count', { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
    }
    await queryInterface.addIndex('listings', ['status', 'rating_avg'], { name: 'listings_rating_idx' });

    // ---------- reviews ----------
    await queryInterface.createTable('reviews', {
      id,
      seller_order_id: fk('seller_orders'),
      order_id: fk('orders'),
      buyer_id: fk('users'),
      seller_id: fk('users'),
      is_booking: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      rating: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false },
      comment: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.ENUM('published', 'held', 'hidden'), allowNull: false, defaultValue: 'published' },
      hold_reasons: { type: Sequelize.JSON, allowNull: true },
      published_at: { type: Sequelize.DATE, allowNull: true },
      edit_count: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      edited_at: { type: Sequelize.DATE, allowNull: true },
      // the seller's public reply (one)
      reply: { type: Sequelize.TEXT, allowNull: true },
      replied_at: { type: Sequelize.DATE, allowNull: true },
      // moderation
      hidden_reason: { type: Sequelize.STRING(500), allowNull: true },
      hidden_at: { type: Sequelize.DATE, allowNull: true },
      hidden_by: fk('admins', true),
      open_reports: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      last_reported_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('reviews', ['seller_order_id'], { name: 'reviews_seller_order_uq', unique: true });
    await queryInterface.addIndex('reviews', ['seller_id', 'status', 'created_at'], { name: 'reviews_seller_idx' });
    await queryInterface.addIndex('reviews', ['buyer_id', 'created_at'], { name: 'reviews_buyer_idx' });
    await queryInterface.addIndex('reviews', ['status', 'open_reports'], { name: 'reviews_moderation_idx' });

    await queryInterface.createTable('review_listings', {
      id,
      review_id: fk('reviews'),
      listing_id: fk('listings'),
      ...timestamps,
    });
    await queryInterface.addIndex('review_listings', ['review_id', 'listing_id'], { name: 'review_listings_uq', unique: true });
    await queryInterface.addIndex('review_listings', ['listing_id'], { name: 'review_listings_listing_idx' });

    await queryInterface.createTable('review_reports', {
      id,
      review_id: fk('reviews'),
      reporter_id: fk('users'),
      reason: {
        type: Sequelize.ENUM('offensive', 'false_info', 'spam', 'personal_info', 'not_about_order', 'other'),
        allowNull: false,
      },
      note: { type: Sequelize.STRING(500), allowNull: true },
      status: { type: Sequelize.ENUM('open', 'resolved'), allowNull: false, defaultValue: 'open' },
      resolution: { type: Sequelize.STRING(30), allowNull: true }, // hidden | kept
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      resolved_by: fk('admins', true),
      ...timestamps,
    });
    await queryInterface.addIndex('review_reports', ['review_id', 'reporter_id'], { name: 'review_reports_uq', unique: true });
    await queryInterface.addIndex('review_reports', ['status', 'created_at'], { name: 'review_reports_status_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('review_reports');
    await queryInterface.dropTable('review_listings');
    await queryInterface.dropTable('reviews');
    await queryInterface.removeIndex('listings', 'listings_rating_idx');
    for (const table of ['listings', 'users']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(table, 'rating_count');
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(table, 'rating_avg');
    }
  },
};
