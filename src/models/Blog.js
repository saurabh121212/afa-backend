// A blog post (Admin CMS -> Blog & Resources, website /blog/<slug>). Soft delete (deleted_at).
module.exports = (sequelize, DataTypes) => {
  const Blog = sequelize.define(
    'Blog',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      title: { type: DataTypes.STRING(200), allowNull: false },
      slug: { type: DataTypes.STRING(200), allowNull: false, unique: true },
      excerpt: { type: DataTypes.STRING(300), allowNull: true },
      content: { type: DataTypes.TEXT('medium'), allowNull: false },
      category: { type: DataTypes.STRING(50), allowNull: true },
      authorName: { type: DataTypes.STRING(100), allowNull: true },
      coverImagePath: { type: DataTypes.STRING(255), allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
      showOnHomepage: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'blogs', paranoid: true }
  );
  return Blog;
};
