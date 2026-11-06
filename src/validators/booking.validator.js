// Validation for service bookings. Which details a service needs depends on its rate
// (see GET /listings/:id/booking-form); those rules are checked in booking.service.js.
const { body, param, query, header } = require('express-validator');
const { BUSINESS_NAME_RULE, normalizeEswatiniMobile } = require('./common');
const { PAYMENT_METHODS } = require('../config/orders');
const { BOOKING_RULES } = require('../config/bookings');
const orderRules = require('./order.validator');

const METHODS = Object.keys(PAYMENT_METHODS);
const idParam = (label) => param('id').isInt({ min: 1 }).withMessage(`${label} id must be a positive number`).toInt();

const ymd = (chain, label) =>
  chain
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${label} must be a date in YYYY-MM-DD format`)
    .bail()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage(`${label} must be a date in YYYY-MM-DD format`);

const amount = (field, label, min, max) =>
  body(field)
    .optional({ values: 'null' })
    .isFloat({ min, max })
    .withMessage(`${label} must be a number from ${min} to ${max.toLocaleString('en')}`)
    .bail()
    .customSanitizer((v) => Math.round(parseFloat(v) * 100) / 100);

// An address: { addressId } (a saved address) or { addressLine, regionId, landmark?, contactName?, phone? }
const address = (field, label) => [
  body(field)
    .optional({ values: 'null' })
    .isObject()
    .withMessage(`${label} must be { addressId } or { addressLine, regionId, landmark?, contactName?, phone? }`)
    .bail()
    .custom((v) => {
      if (v.addressId) return true;
      if (v.addressLine && v.regionId) return true;
      throw new Error(`${label}: choose a saved address (addressId) or enter addressLine and regionId`);
    }),
  body(`${field}.addressId`).optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage(`${label}: addressId must be a positive number`).toInt(),
  body(`${field}.addressLine`)
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage(`${label}: address must be 5-255 characters`),
  body(`${field}.regionId`).optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage(`${label}: choose a valid region`).toInt(),
  body(`${field}.landmark`).optional({ values: 'falsy' }).trim().isLength({ max: 255 }).withMessage(`${label}: landmark can be at most 255 characters`),
  body(`${field}.contactName`)
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage(`${label}: contact name must be 2-150 characters`)
    .bail()
    .matches(BUSINESS_NAME_RULE)
    .withMessage(`${label}: contact name can only contain letters, numbers, spaces and & . , ' ( ) / -`),
  body(`${field}.phone`)
    .optional({ values: 'falsy' })
    .trim()
    .customSanitizer(normalizeEswatiniMobile)
    .matches(/^\+268[0-9]{8}$/)
    .withMessage(`${label}: enter a valid Eswatini phone number, e.g. +268 7612 3456`),
];

// The booking details (quote and book)
const details = [
  body('listingId').notEmpty().withMessage('listingId is required').bail().isInt({ min: 1 }).withMessage('listingId must be a positive number').toInt(),
  ymd(body('startDate').notEmpty().withMessage('Start date is required').bail(), 'Start date'),
  ymd(body('endDate').optional({ values: 'falsy' }), 'End date'),
  body('startTime')
    .optional({ values: 'falsy' })
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('Start time must be HH:mm (24 hours), e.g. 08:30'),
  amount('distanceKm', 'Distance (km)', 0.1, 5000),
  amount('loadAmount', 'Load', 0.01, 1000000),
  amount('spaceAmount', 'Space', 0.01, 1000000),
  amount('quantity', 'Quantity', 0.01, 1000000),
  amount('hours', 'Hours', 0.5, 2000),
  ...address('pickupAddress', 'Pickup address'),
  ...address('dropoffAddress', 'Drop-off address'),
  ...address('serviceAddress', 'Service address'),
];

// GET /listings/:id/booking-form?from=&to=
const bookingForm = [
  idParam('Listing'),
  ymd(query('from').optional({ values: 'falsy' }), 'from'),
  ymd(query('to').optional({ values: 'falsy' }), 'to'),
];

// POST /me/bookings/quote
const quote = details;

// POST /me/bookings   header Idempotency-Key (recommended)
const place = [
  header('idempotency-key')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[A-Za-z0-9_.:-]{8,100}$/)
    .withMessage('Idempotency-Key must be 8-100 letters, digits or - _ . :'),
  ...details,
  body('note')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: BOOKING_RULES.noteMax })
    .withMessage(`Note to the provider can be at most ${BOOKING_RULES.noteMax} characters`),
  body('paymentMethod')
    .trim()
    .notEmpty()
    .withMessage('Choose a payment method')
    .bail()
    .toLowerCase()
    .isIn(METHODS)
    .withMessage(`paymentMethod must be one of: ${METHODS.join(', ')}`),
  body('acceptTerms')
    .custom((v) => v === true || v === 'true')
    .withMessage('Please accept the Terms & Conditions to book')
    .customSanitizer(() => true),
  body('expectedTotal').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('expectedTotal must be a number').toFloat(),
];

// GET /me/bookings   (same filters as My Orders: status, search, page, limit)
const myList = orderRules.myList;

// GET /me/bookings/:id, POST /me/bookings/:id/confirm-done
const byId = [idParam('Booking')];

module.exports = { bookingForm, quote, place, myList, byId };
