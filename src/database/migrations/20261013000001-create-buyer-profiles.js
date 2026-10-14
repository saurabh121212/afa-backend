'use strict';

// Buyer details from the Figma "Buyer Registration - Step 1 (Buyer Information)" screen.
// All Step 1 fields are mandatory.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const locationRef = () => ({
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      references: { model: 'locations', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    await queryInterface.createTable('buyer_profiles', {
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

      // "I am registering as"
      buyer_type: {
        type: Sequelize.ENUM('individual', 'business'),
        allowNull: false,
      },
      // "Full Name / Business Name"
      name: { type: Sequelize.STRING(150), allowNull: false },
      // "ID Number / Business TIN" (unique among buyers, can be used to log in)
      id_number_tin: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      delivery_address: { type: Sequelize.STRING(255), allowNull: false },
      region_id: locationRef(),
      inkhundla_id: locationRef(),
      umphakatsi_id: locationRef(),

      // Step 3 "Order & Price Alerts" toggle (on by default, as in Figma)
      order_price_alerts: {
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
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('buyer_profiles');
  },
};
