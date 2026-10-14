'use strict';

// Eswatini locations used by the Region -> Inkhundla -> Umphakatsi dropdowns.
// One table, linked by parent_id:
//   Region (parent_id = NULL) -> Inkhundla (parent = region) -> Umphakatsi (parent = inkhundla)

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('locations', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      type: {
        type: Sequelize.ENUM('region', 'inkhundla', 'umphakatsi'),
        allowNull: false,
      },
      parent_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'locations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      is_active: {
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

    // The same name can't appear twice under the same parent.
    await queryInterface.addIndex('locations', ['type', 'parent_id', 'name'], {
      unique: true,
      name: 'locations_type_parent_name_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('locations');
  },
};
