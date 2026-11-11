// A Video Gallery video (Admin CMS -> Videos, website /gallery). Soft delete (deleted_at).
module.exports = (sequelize, DataTypes) => {
  const Video = sequelize.define(
    'Video',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      title: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.STRING(1000), allowNull: false },
      link: { type: DataTypes.STRING(500), allowNull: false },
      youtubeId: { type: DataTypes.STRING(11), allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'videos', paranoid: true }
  );
  return Video;
};
