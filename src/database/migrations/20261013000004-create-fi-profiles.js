'use strict';

// Financial Institution details from the Figma "Financial Institution Registration" screens:
//   Step 1 (Institution Information)          -> mandatory -> fi_profiles
//   Step 2 (Regulatory Details & Coverage)    -> optional  -> fi_profiles + fi_coverage_regions
//
// fi_coverage_regions = the regions the institution serves (one row per region).

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

    await queryInterface.createTable('fi_profiles', {
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

      // ---- Step 1: Institution Information ----
      institution_name: { type: Sequelize.STRING(150), allowNull: false },
      // Unique among financial institutions, can be used to log in
      registration_number_tin: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      institution_type: {
        type: Sequelize.ENUM('commercial_bank', 'microfinance', 'insurance', 'sacco'),
        allowNull: false,
      },
      product_type: {
        type: Sequelize.ENUM('loans', 'insurance', 'both'),
        allowNull: false,
      },
      contact_first_name: { type: Sequelize.STRING(60), allowNull: false },
      contact_last_name: { type: Sequelize.STRING(60), allowNull: false },
      designation: {
        type: Sequelize.ENUM(
          'branch_manager',
          'credit_officer',
          'director',
          'manager',
          'authorized_representative',
          'other'
        ),
        allowNull: false,
      },

      // ---- Step 2: Institution Location + Regulatory Details (optional) ----
      institution_address: { type: Sequelize.STRING(255), allowNull: true },
      region_id: optionalLocationRef(),
      inkhundla_id: optionalLocationRef(),
      umphakatsi_id: optionalLocationRef(),
      regulatory_body: {
        type: Sequelize.ENUM('central_bank_of_eswatini', 'fsra', 'other'),
        allowNull: true,
      },
      // Name of the regulatory body when "other" is chosen
      regulatory_body_other: { type: Sequelize.STRING(150), allowNull: true },
      regulatory_license_number: { type: Sequelize.STRING(50), allowNull: true },
      license_expiry_date: { type: Sequelize.DATEONLY, allowNull: true },
      years_in_operation: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true }, // 0-200

      // ---- Step 4: "authorized to register and represent this institution" ----
      authorization_confirmed_at: { type: Sequelize.DATE, allowNull: true },

      ...timestamps,
    });

    await queryInterface.createTable('fi_coverage_regions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      fi_profile_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'fi_profiles', key: 'id' },
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

    await queryInterface.addIndex('fi_coverage_regions', ['fi_profile_id', 'region_id'], {
      unique: true,
      name: 'fi_coverage_profile_region_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('fi_coverage_regions');
    await queryInterface.dropTable('fi_profiles');
  },
};
