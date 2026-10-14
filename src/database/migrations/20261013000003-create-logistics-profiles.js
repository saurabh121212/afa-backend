'use strict';

// Logistics Provider details from the Figma "Logistics Provider Registration" screens:
//   Step 1 (Business Information)                 -> mandatory   -> logistics_profiles
//   Step 2 (Service Details & Coverage Area)      -> optional    -> logistics_profiles (location)
//                                                                  + logistics_coverage_regions
//
// logistics_coverage_regions = the regions the provider serves (one row per region).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const optionalLocationRef = () => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'locations', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    const timestamps = {
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
    };

    await queryInterface.createTable('logistics_profiles', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      // ---- Step 1: Business Information ----
      business_name: { type: Sequelize.STRING(150), allowNull: false },
      // Unique among logistics providers, can be used to log in
      registration_number_tin: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      business_type: {
        type: Sequelize.ENUM('sole_proprietor', 'partnership', 'company', 'cooperative'),
        allowNull: false,
      },
      service_type: {
        type: Sequelize.ENUM('transport', 'warehousing', 'equipment_rental', 'mixed'),
        allowNull: false,
      },
      contact_first_name: { type: Sequelize.STRING(60), allowNull: false },
      contact_last_name: { type: Sequelize.STRING(60), allowNull: false },
      designation: {
        type: Sequelize.ENUM(
          'owner',
          'director',
          'fleet_manager',
          'manager',
          'partner',
          'authorized_representative',
          'other'
        ),
        allowNull: false,
      },

      // ---- Step 2: Business Location (optional) ----
      business_address: { type: Sequelize.STRING(255), allowNull: true },
      region_id: optionalLocationRef(),
      inkhundla_id: optionalLocationRef(),
      umphakatsi_id: optionalLocationRef(),

      // ---- Step 4: "authorized to register and represent this business" ----
      authorization_confirmed_at: { type: Sequelize.DATE, allowNull: true },

      ...timestamps,
    });

    await queryInterface.createTable('logistics_coverage_regions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      logistics_profile_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'logistics_profiles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      region_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'locations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ...timestamps,
    });

    await queryInterface.addIndex('logistics_coverage_regions', ['logistics_profile_id', 'region_id'], {
      unique: true,
      name: 'logistics_coverage_profile_region_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('logistics_coverage_regions');
    await queryInterface.dropTable('logistics_profiles');
  },
};
