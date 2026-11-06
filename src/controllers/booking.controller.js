// SERVICE BOOKINGS. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const bookingService = require('../services/booking.service');
const orderNotify = require('../services/orderNotify.service');

const v = (req) => req.validated;

// GET /listings/:id/booking-form   (public)
const bookingForm = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.bookingForm(v(req).id, v(req)) });
});

// POST /me/bookings/quote
const quote = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.quote(req.user, v(req)) });
});

// POST /me/bookings
const place = asyncHandler(async (req, res) => {
  const key = (req.get('idempotency-key') || '').trim() || null;
  const { bookingId, orderId, created } = await bookingService.place(req.user, v(req), { idempotencyKey: key });
  if (created) orderNotify.orderPlaced(orderId);
  const data = await bookingService.getMine(req.user, bookingId);
  res.status(created ? 201 : 200).json({
    success: true,
    message: created
      ? `Booking ${data.bookingNumber} placed. Please complete the payment.`
      : `Booking ${data.bookingNumber} was already placed`,
    data,
  });
});

// GET /me/bookings
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.listMine(req.user, v(req)) });
});

// GET /me/bookings/:id
const getOne = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.getMine(req.user, v(req).id) });
});

// POST /me/bookings/:id/confirm-done
const confirmDone = asyncHandler(async (req, res) => {
  const data = await bookingService.confirmDone(req.user, v(req).id);
  res.json({ success: true, message: 'Thank you. The booking is completed.', data });
});

module.exports = { bookingForm, quote, place, list, getOne, confirmDone };
