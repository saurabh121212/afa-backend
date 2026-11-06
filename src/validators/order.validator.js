// Validation for checkout, payments and the buyer / seller / admin order screens.
const { body, param, query, header } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { ORDER_STATUS, SELLER_ORDER_STATUS, PAYMENT_METHODS, ORDER_KINDS } = require('../config/orders');
const { normalizeEswatiniMobile } = require('./common');

const METHODS = Object.keys(PAYMENT_METHODS);
const ORDER_STATUSES = Object.values(ORDER_STATUS);
const SELLER_STATUSES = Object.values(SELLER_ORDER_STATUS).filter((s) => s !== SELLER_ORDER_STATUS.AWAITING_PAYMENT);
// What a seller can SET (the rest are set by payments / the system)
// in_progress: service bookings only ("In Progress"); "delivered" on a booking = "Service Done"
const SELLER_SETTABLE = ['confirmed', 'in_progress', 'packed', 'dispatched', 'ready_for_pickup', 'delivered', 'collected'];
const PAYMENT_STATUSES = ['pending', 'under_review', 'succeeded', 'failed', 'rejected', 'expired'];

const id = (name, label) => param(name).isInt({ min: 1 }).withMessage(`${label} must be a positive number`).toInt();
const idParam = id('id', 'Order id');
const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
const search = query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long');
const sort = query('sort').optional({ values: 'falsy' }).trim().isIn(['newest', 'oldest']).withMessage('sort must be newest or oldest');
const oneOf = (chain, label, list) =>
  chain.optional({ values: 'falsy' }).trim().toLowerCase().isIn(list).withMessage(`${label} must be one of: ${list.join(', ')}`);
const dateQuery = (field, endOfDay) =>
  query(field)
    .optional({ values: 'falsy' })
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${field} must be a date in YYYY-MM-DD format`)
    .bail()
    .customSanitizer((v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00` : v));
const reasonField = (field, label, required) => {
  const chain = body(field);
  return (required ? chain.trim().notEmpty().withMessage(`${label} is required`).bail() : chain.optional({ values: 'falsy' }).trim())
    .isLength({ min: required ? 3 : 0, max: 500 })
    .withMessage(`${label} must be ${required ? '3-' : 'at most '}500 characters`);
};

// ======================= BUYER =======================

// POST /me/orders   header Idempotency-Key (optional, recommended)
const placeOrder = [
  header('idempotency-key')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[A-Za-z0-9_.:-]{8,100}$/)
    .withMessage('Idempotency-Key must be 8-100 letters, digits or - _ . :'),
  body('paymentMethod')
    .trim()
    .notEmpty()
    .withMessage('Choose a payment method')
    .bail()
    .toLowerCase()
    .isIn(METHODS)
    .withMessage(`paymentMethod must be one of: ${METHODS.join(', ')}`),
  body('addressId').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('addressId must be a positive number').toInt(),
  body('acceptTerms')
    .custom((v) => v === true || v === 'true')
    .withMessage('Please accept the Terms & Conditions to place the order')
    .customSanitizer(() => true),
  body('expectedTotal').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('expectedTotal must be a number').toFloat(),
  body('sellerNotes').optional({ values: 'null' }).isArray({ max: 50 }).withMessage('sellerNotes must be a list of { sellerId, note }'),
  body('sellerNotes.*.sellerId').isInt({ min: 1 }).withMessage('Each seller note needs a sellerId').toInt(),
  body('sellerNotes.*.note').trim().isLength({ min: 1, max: 500 }).withMessage('A note to the seller must be 1-500 characters'),
];

// GET /me/orders
const KINDS = Object.keys(ORDER_KINDS);
const myList = [oneOf(query('status'), 'status', ORDER_STATUSES), oneOf(query('kind'), 'kind', KINDS), search, ...paging];

const byId = [idParam];

// PATCH /me/orders/:id/payment-method
const paymentMethod = [
  idParam,
  body('paymentMethod').trim().notEmpty().withMessage('paymentMethod is required').bail().toLowerCase()
    .isIn(METHODS).withMessage(`paymentMethod must be one of: ${METHODS.join(', ')}`),
];

// POST /me/orders/:id/pay/online   { channel?, cellNumber? }
const payOnline = [
  idParam,
  body('channel').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('channel must be a payment option id').toInt(),
  body('cellNumber')
    .optional({ values: 'falsy' })
    .trim()
    .customSanitizer(normalizeEswatiniMobile)
    .matches(/^\+268[0-9]{8}$/)
    .withMessage('Enter a valid Eswatini mobile number, e.g. +268 7612 3456'),
];

// POST /me/orders/:id/pay/test
const testPay = [
  idParam,
  body('outcome').trim().notEmpty().withMessage('outcome is required').bail().toLowerCase()
    .isIn(['success', 'fail']).withMessage('outcome must be success or fail'),
];

// POST /me/orders/:id/payment-proof  (form-data: file + these fields; checked AFTER the upload)
const paymentProof = [
  body('amountPaid')
    .trim()
    .notEmpty()
    .withMessage('Amount paid is required')
    .bail()
    .matches(/^\d+(\.\d{1,2})?$/)
    .withMessage('Amount paid must be a number with up to 2 decimals')
    .bail()
    .isFloat({ gt: 0, max: 100000000 })
    .withMessage('Amount paid must be more than 0')
    .toFloat(),
  body('paidOn')
    .trim()
    .notEmpty()
    .withMessage('Payment date is required')
    .bail()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('Payment date must be YYYY-MM-DD')
    .bail()
    .custom((v) => v <= new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10)) // Eswatini time
    .withMessage('Payment date cannot be in the future'),
  body('bankReference').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('Bank reference can be at most 100 characters'),
  reasonField('note', 'Note', false),
];

// GET /me/orders/:id/payments/:paymentId/receipt
const receipt = [idParam, id('paymentId', 'Payment id')];

// POST /me/orders/:id/cancel
const cancel = [idParam, reasonField('reason', 'Reason', false)];

// POST /me/orders/:id/seller-orders/:sellerOrderId/received
const received = [idParam, id('sellerOrderId', 'Seller order id')];

// ======================= SELLER =======================

// GET /me/sales, /me/sales/export
const salesList = [
  oneOf(query('status'), 'status', SELLER_STATUSES),
  query('late').optional({ values: 'falsy' }).isIn(['true', 'false']).withMessage('late must be true or false').bail().customSanitizer((v) => v === 'true'),
  // Phase 4: only orders with a cancellation request waiting / an open claim
  query('cancelRequest').optional({ values: 'falsy' }).isIn(['true', 'false']).withMessage('cancelRequest must be true or false').bail().customSanitizer((v) => v === 'true'),
  query('openClaim').optional({ values: 'falsy' }).isIn(['true', 'false']).withMessage('openClaim must be true or false').bail().customSanitizer((v) => v === 'true'),
  dateQuery('from', false),
  dateQuery('to', true),
  search,
  sort,
  ...paging,
];

// PATCH /me/sales/:id/status
const salesStatus = [
  idParam,
  body('status').trim().notEmpty().withMessage('status is required').bail().toLowerCase()
    .isIn(SELLER_SETTABLE).withMessage(`status must be one of: ${SELLER_SETTABLE.join(', ')}`),
  reasonField('note', 'Note', false),
];

// ======================= ADMIN =======================

// GET /admin/orders, /export
const adminList = [
  oneOf(query('status'), 'status', ORDER_STATUSES),
  oneOf(query('kind'), 'kind', KINDS),
  oneOf(query('paymentMethod'), 'paymentMethod', METHODS),
  query('sellerId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('sellerId must be a positive number').toInt(),
  dateQuery('from', false),
  dateQuery('to', true),
  search,
  sort,
  ...paging,
];

// GET /admin/payments
const paymentList = [
  oneOf(query('status'), 'status', PAYMENT_STATUSES),
  oneOf(query('method'), 'method', METHODS),
  search,
  ...paging,
];

const paymentId = [idParam];
const confirmPayment = [idParam, reasonField('note', 'Note', false)];
const rejectPayment = [idParam, reasonField('reason', 'Reason', true)];

module.exports = {
  KINDS,
  placeOrder,
  myList,
  byId,
  paymentMethod,
  payOnline,
  testPay,
  paymentProof,
  receipt,
  cancel,
  received,
  salesList,
  salesStatus,
  adminList,
  paymentList,
  paymentId,
  confirmPayment,
  rejectPayment,
};
