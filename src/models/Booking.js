// A service booking (AFA-BKG-000001): the booking details of a service order.
// The money, status and payment live on the Order / SellerOrder / OrderItem it belongs to,
// so payments, invoices, cancellations, claims and refunds work like product orders.
// Never deleted (soft delete only).
const { BOOKING_TYPES } = require('../config/bookings');

module.exports = (sequelize, DataTypes) => {
  const dec = (p, s) => ({ type: DataTypes.DECIMAL(p, s), allowNull: true });
  const Booking = sequelize.define(
    'Booking',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      bookingNumber: { type: DataTypes.STRING(30), allowNull: true },
      orderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sellerOrderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      orderItemId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      listingId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      buyerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      providerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      bookingType: { type: DataTypes.ENUM(...Object.keys(BOOKING_TYPES)), allowNull: false },
      rate: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      rateUnit: { type: DataTypes.STRING(30), allowNull: false },
      startDate: { type: DataTypes.DATEONLY, allowNull: false },
      endDate: { type: DataTypes.DATEONLY, allowNull: false },
      startTime: { type: DataTypes.STRING(5), allowNull: true },
      distanceKm: dec(10, 2),
      loadAmount: dec(12, 2),
      loadUnit: { type: DataTypes.STRING(30), allowNull: true },
      spaceAmount: dec(12, 2),
      spaceUnit: { type: DataTypes.STRING(30), allowNull: true },
      quantity: dec(12, 2),
      hours: dec(8, 2),
      breakdown: { type: DataTypes.JSON, allowNull: true },
      billableQuantity: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      minimumApplied: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      pickupAddress: { type: DataTypes.JSON, allowNull: true },
      dropoffAddress: { type: DataTypes.JSON, allowNull: true },
      serviceAddress: { type: DataTypes.JSON, allowNull: true },
    },
    { tableName: 'bookings', paranoid: true }
  );

  Booking.associate = (models) => {
    Booking.belongsTo(models.Order, { as: 'order', foreignKey: 'orderId' });
    Booking.belongsTo(models.SellerOrder, { as: 'sellerOrder', foreignKey: 'sellerOrderId' });
    Booking.belongsTo(models.OrderItem, { as: 'orderItem', foreignKey: 'orderItemId' });
    Booking.belongsTo(models.Listing, { as: 'listing', foreignKey: 'listingId' });
    Booking.belongsTo(models.User, { as: 'buyer', foreignKey: 'buyerId' });
    Booking.belongsTo(models.User, { as: 'provider', foreignKey: 'providerId' });
  };

  return Booking;
};
