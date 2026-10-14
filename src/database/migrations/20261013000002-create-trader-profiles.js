'use strict';

// Trader details from the Figma "Trader Registration" screens:
//   Step 1 (Business Information)        -> mandatory
//   Step 2 (Business Address & License)  -> optional, can be filled later

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

    await queryInterface.createTable('trader_profiles', {
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
      // "Business Registration Number / TIN" (unique among traders, can be used to log in)
      registration_number_tin: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      business_type: {
        type: Sequelize.ENUM('sole_proprietor', 'partnership', 'company', 'cooperative'),
        allowNull: false,
      },
      business_category: {
        type: Sequelize.ENUM('produce', 'fertilizers_inputs', 'equipment', 'mixed'),
        allowNull: false,
      },
      contact_first_name: { type: Sequelize.STRING(60), allowNull: false },
      contact_last_name: { type: Sequelize.STRING(60), allowNull: false },
      designation: {
        type: Sequelize.ENUM('owner', 'director', 'manager', 'partner', 'authorized_representative', 'other'),
        allowNull: false,
      },

      // ---- Step 2: Business Address & License (all optional) ----
      business_address: { type: Sequelize.STRING(255), allowNull: true },
      region_id: optionalLocationRef(),
      inkhundla_id: optionalLocationRef(),
      umphakatsi_id: optionalLocationRef(),
      trading_license_number: { type: Sequelize.STRING(50), allowNull: true },
      license_issuing_authority: {
        type: Sequelize.ENUM('ministry_of_commerce', 'ers', 'local_council'),
        allowNull: true,
      },
      license_expiry_date: { type: Sequelize.DATEONLY, allowNull: true },
      years_in_operation: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true },
      website: { type: Sequelize.STRING(255), allowNull: true },

      // ---- Step 4: "I confirm that I am authorized to register and represent this business" ----
      authorization_confirmed_at: { type: Sequelize.DATE, allowNull: true },

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
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('trader_profiles');
  },
};
