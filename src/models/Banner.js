// A website / app banner (Figma CMS -> Banners). Soft delete (deleted_at).
module.exports = (sequelize, DataTypes) => {
  const Banner = sequelize.define(
    'Banner',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      title: { type: DataTypes.STRING(150), allowNull: false },
      subtitle: { type: DataTypes.STRING(300), allowNull: true },
      buttonText: { type: DataTypes.STRING(40), allowNull: true },
      linkUrl: { type: DataTypes.STRING(500), allowNull: true },
      placement: { type: DataTypes.STRING(40), allowNull: false },
      imagePath: { type: DataTypes.STRING(255), allowNull: true },
      startsAt: { type: DataTypes.DATE, allowNull: true },
      endsAt: { type: DataTypes.DATE, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    { tableName: 'banners', paranoid: true }
  );
  return Banner;
};
