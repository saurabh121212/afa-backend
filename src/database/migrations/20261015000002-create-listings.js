'use strict';

// Marketplace listings (Figma "Create New Listing", "Add New Product", "Add New Service").
//   kind = product -> farmers and traders (price per unit, stock, delivery)
//   kind = service -> logistics providers (rate, capacity, booking, coverage regions)
// Only status "active" (approved by the admin) is shown on the website.
//
//   listings        -> one row per listing (soft delete: deleted_at)
//   listing_photos  -> up to 5 photos per listing, sort_order 0 = cover photo (soft delete)

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ts = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    };
    const fk = (table, nullable = true) => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: nullable,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    await queryInterface.createTable('listings', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      user_id: fk('users', false),
      kind: { type: Sequelize.ENUM('product', 'service'), allowNull: false },
      status: {
        type: Sequelize.ENUM('draft', 'pending', 'active', 'rejected', 'paused', 'flagged', 'disabled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      category_id: fk('categories'),
      sub_category_id: fk('categories'),

      // Details
      name: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      brand: { type: Sequelize.STRING(100), allowNull: true }, // product (trader)
      sku: { type: Sequelize.STRING(60), allowNull: true }, // product (trader)
      vehicle_registration: { type: Sequelize.STRING(30), allowNull: true }, // service
      make_model: { type: Sequelize.STRING(100), allowNull: true }, // service

      // Price (product: price per unit, service: rate) - always Emalangeni
      price: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      price_unit: { type: Sequelize.STRING(30), allowNull: true },
      currency: { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'SZL' },

      // Product: stock + minimum order
      quantity: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      quantity_unit: { type: Sequelize.STRING(30), allowNull: true },
      min_order_quantity: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      min_order_unit: { type: Sequelize.STRING(30), allowNull: true },

      // Service: capacity + minimum booking
      capacity: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      capacity_unit: { type: Sequelize.STRING(30), allowNull: true },
      min_booking: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      min_booking_unit: { type: Sequelize.STRING(30), allowNull: true },

      // Availability (product: in_stock | pre_order, service: available | booked | maintenance)
      availability: { type: Sequelize.STRING(20), allowNull: true },
      available_from: { type: Sequelize.DATEONLY, allowNull: true }, // pre-order date

      // Product delivery
      delivery_type: { type: Sequelize.STRING(20), allowNull: true },
      delivery_duration: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      delivery_duration_unit: { type: Sequelize.STRING(20), allowNull: true },
      logistics_by: { type: Sequelize.STRING(10), allowNull: true },

      // Service booking + coverage
      advance_notice: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      advance_notice_unit: { type: Sequelize.STRING(20), allowNull: true },
      coverage_region_ids: { type: Sequelize.JSON, allowNull: true },

      // Pickup / delivery / service location
      use_registered_address: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      address: { type: Sequelize.STRING(255), allowNull: true },
      region_id: fk('locations'),
      inkhundla_id: fk('locations'),
      umphakatsi_id: fk('locations'),

      // Review by the admin
      submitted_at: { type: Sequelize.DATE, allowNull: true },
      published_at: { type: Sequelize.DATE, allowNull: true }, // first approval
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      reviewed_by: fk('admins'),
      status_reason: { type: Sequelize.TEXT, allowNull: true }, // reject / flag / disable reason

      ...ts,
    });

    await queryInterface.addIndex('listings', ['status', 'kind'], { name: 'listings_status_kind_idx' });
    await queryInterface.addIndex('listings', ['user_id', 'status'], { name: 'listings_user_status_idx' });
    await queryInterface.addIndex('listings', ['category_id'], { name: 'listings_category_idx' });
    await queryInterface.addIndex('listings', ['sub_category_id'], { name: 'listings_sub_category_idx' });
    await queryInterface.addIndex('listings', ['region_id'], { name: 'listings_region_idx' });
    await queryInterface.addIndex('listings', ['price'], { name: 'listings_price_idx' });

    await queryInterface.createTable('listing_photos', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      listing_id: fk('listings', false),
      file_path: { type: Sequelize.STRING(255), allowNull: false }, // relative to UPLOAD_DIR
      original_name: { type: Sequelize.STRING(255), allowNull: true },
      mime_type: { type: Sequelize.STRING(50), allowNull: false },
      size_bytes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      sort_order: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 }, // 0 = cover
      ...ts,
    });
    await queryInterface.addIndex('listing_photos', ['listing_id', 'sort_order'], { name: 'listing_photos_order_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('listing_photos');
    await queryInterface.dropTable('listings');
  },
};
