'use strict';

// Credit score (farmers, traders, logistics providers). ADD-ONLY: two new tables + one new column.
//
//   credit_scores          the current score of each user (one row per user): total, grade, the 5 parts,
//                          the inputs used (JSON) and the formula version
//   credit_score_changes   every change of a score (old -> new, which parts, what caused it). Kept forever:
//                          it is the history lenders will look at in phase 2
//   user_documents.expires_at   expiry date of insurance documents (the user enters it, the admin can correct it)

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const id = { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false };
    const userFk = {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    };
    const part = { type: Sequelize.DECIMAL(4, 1), allowNull: false, defaultValue: 0 };
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };

    await queryInterface.addColumn('user_documents', 'expires_at', { type: Sequelize.DATEONLY, allowNull: true });

    await queryInterface.createTable('credit_scores', {
      id,
      user_id: userFk,
      score: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      grade: { type: Sequelize.STRING(20), allowNull: false },
      kyc_points: part,
      sales_points: part,
      loan_points: part,
      insurance_points: part,
      rating_points: part,
      details: { type: Sequelize.JSON, allowNull: true }, // the inputs behind each part
      formula_version: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      calculated_at: { type: Sequelize.DATE, allowNull: false },
      ...timestamps,
    });
    await queryInterface.addIndex('credit_scores', ['user_id'], { name: 'credit_scores_user_uq', unique: true });
    await queryInterface.addIndex('credit_scores', ['score'], { name: 'credit_scores_score_idx' });
    await queryInterface.addIndex('credit_scores', ['calculated_at'], { name: 'credit_scores_calculated_idx' });

    await queryInterface.createTable('credit_score_changes', {
      id,
      user_id: userFk,
      old_score: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true }, // null = first calculation
      new_score: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false },
      grade: { type: Sequelize.STRING(20), allowNull: false },
      parts: { type: Sequelize.JSON, allowNull: false }, // { kyc, sales, loans, insurance, rating } after the change
      changed_parts: { type: Sequelize.JSON, allowNull: true }, // [{ part, from, to }]
      trigger: { type: Sequelize.STRING(255), allowNull: false }, // one or more causes, comma separated
      formula_version: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('credit_score_changes', ['user_id', 'created_at'], { name: 'credit_score_changes_user_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('credit_score_changes');
    await queryInterface.dropTable('credit_scores');
    await queryInterface.removeColumn('user_documents', 'expires_at');
  },
};
