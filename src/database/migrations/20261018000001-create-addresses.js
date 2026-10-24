'use strict';

// Saved delivery addresses (Figma "Saved Addresses": Home / Office / Warehouse, one Default).
// Used later by checkout. Removing = soft delete (deleted_at).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const locationFk = {
      type: Sequelize.INTEGER.UNSIGNED,
      references: { model: 'locations', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    };
    await queryInterface.createTable('addresses', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      label: { type: Sequelize.STRING(30), allowNull: false }, // Home, Office, Warehouse...
      contact_name: { type: Sequelize.STRING(150), allowNull: false },
      phone: { type: Sequelize.STRING(20), allowNull: false },
      address_line: { type: Sequelize.STRING(255), allowNull: false }, // "Plot 45, Ngwane Park"
      landmark: { type: Sequelize.STRING(255), allowNull: true }, // directions for the driver (optional)
      region_id: { ...locationFk, allowNull: false },
      inkhundla_id: { ...locationFk, allowNull: false },
      umphakatsi_id: { ...locationFk, allowNull: true },
      is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('addresses', ['user_id', 'is_default'], { name: 'addresses_user_default_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('addresses');
  },
};
