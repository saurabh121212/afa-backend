// BUYER service bookings, mounted at /api/v1/me/bookings. Buyers only.
// Booking needs an APPROVED buyer account. (Public booking form: GET /listings/:id/booking-form)
//
//   POST /me/bookings/quote             price + availability for the details (nothing saved)
//   POST /me/bookings                   book: { listingId, startDate, endDate?, startTime?, distanceKm?, loadAmount?,
//                                       spaceAmount?, quantity?, hours?, pickupAddress?, dropoffAddress?, serviceAddress?,
//                                       note?, paymentMethod, acceptTerms: true, expectedTotal? }
//                                       header Idempotency-Key: <unique per click> (recommended)
//   GET  /me/bookings                   My Bookings (?status=&search=&page=&limit=)
//   GET  /me/bookings/:id               one booking + its order (payment, status, timeline, invoice, claims)
//   POST /me/bookings/:id/confirm-done  "Service Done" -> Completed (provider paid)
//
// Paying, cancelling and problems use the order endpoints with the booking's orderId / sellerOrderId:
//   /me/orders/:orderId/pay/online, /payment-proof, /payment-method, /cancel (unpaid),
//   /me/orders/:orderId/seller-orders/:sellerOrderId/cancel, /claim-options, POST /me/claims
const express = require('express');
const controller = require('../controllers/booking.controller');
const rules = require('../validators/booking.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType, requireApprovedAccount } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('buyer'));

router.post('/quote', rules.quote, validate, controller.quote);
router.post('/', requireApprovedAccount, rules.place, validate, controller.place);
router.get('/', rules.myList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getOne);
router.post('/:id/confirm-done', rules.byId, validate, controller.confirmDone);

module.exports = router;
