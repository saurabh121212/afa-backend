'use strict';

// Farmer details from the Figma registration screens:
//   Step 1 (Personal Information) -> mandatory
//   Step 2 (Farm Information)     -> optional, can be filled later

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const locationRef = (allowNull, onDelete) => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull,
      references: { model: 'locations', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete,
    });

    await queryInterface.createTable('farmer_profiles', {
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

      // ---- Step 1: Personal Information ----
      farmer_id_tin: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      first_name: { type: Sequelize.STRING(60), allowNull: false },
      middle_name: { type: Sequelize.STRING(60), allowNull: true },
      last_name: { type: Sequelize.STRING(60), allowNull: false },
      gender: { type: Sequelize.ENUM('male', 'female'), allowNull: false },
      date_of_birth: { type: Sequelize.DATEONLY, allowNull: false },
      resident_address: { type: Sequelize.STRING(255), allowNull: false },
      region_id: locationRef(false, 'RESTRICT'),
      inkhundla_id: locationRef(false, 'RESTRICT'),
      umphakatsi_id: locationRef(false, 'RESTRICT'),

      // ---- Step 2: Farm Information (all optional) ----
      farm_name: { type: Sequelize.STRING(150), allowNull: true },
      farm_address: { type: Sequelize.STRING(255), allowNull: true },
      farm_region_id: locationRef(true, 'SET NULL'),
      farm_inkhundla_id: locationRef(true, 'SET NULL'),
      farm_umphakatsi_id: locationRef(true, 'SET NULL'),
      farm_size_ha: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      land_ownership_type: {
        type: Sequelize.ENUM('owned', 'leased', 'community', 'other'),
        allowNull: true,
      },
      farming_activity: {
        type: Sequelize.ENUM('crop', 'livestock', 'mixed', 'other'),
        allowNull: true,
      },
      main_crops: { type: Sequelize.JSON, allowNull: true }, // e.g. ["Maize","Beans"]
      other_crops: { type: Sequelize.STRING(255), allowNull: true },
      production_capacity_kg: { type: Sequelize.DECIMAL(12, 2), allowNull: true }, // kg per year
      farming_seasons: { type: Sequelize.JSON, allowNull: true }, // e.g. ["summer"]

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
    await queryInterface.dropTable('farmer_profiles');
  },
};
