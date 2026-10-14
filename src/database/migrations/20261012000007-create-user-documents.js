'use strict';

// KYC documents uploaded by users (all user types).
// One row per user per document type: uploading again replaces the file.
// status / rejection_reason / reviewed_* are filled by the admin KYC review (next module).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_documents', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      document_type: { type: Sequelize.STRING(50), allowNull: false }, // e.g. national_id
      original_name: { type: Sequelize.STRING(255), allowNull: false }, // name on the user's device
      file_path: { type: Sequelize.STRING(500), allowNull: false }, // relative to UPLOAD_DIR
      mime_type: { type: Sequelize.STRING(100), allowNull: false },
      size_bytes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      rejection_reason: { type: Sequelize.TEXT, allowNull: true },
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      reviewed_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'admins', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.addIndex('user_documents', ['user_id', 'document_type'], {
      unique: true,
      name: 'user_documents_user_type_unique',
    });
    await queryInterface.addIndex('user_documents', ['status'], {
      name: 'user_documents_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_documents');
  },
};
