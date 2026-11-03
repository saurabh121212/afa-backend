// Last number used per document type (invoice, credit_note, receipt): one running series each.
// Read with a row lock inside the transaction that issues the document, so numbers never repeat.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'DocumentCounter',
    {
      name: { type: DataTypes.STRING(30), primaryKey: true },
      lastValue: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    { tableName: 'document_counters', createdAt: false }
  );
