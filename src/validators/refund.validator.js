// Validation for cancellations, claims and refunds (Phase 4).
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { CLAIM_REASONS, CLAIM_STATUS, CANCEL_REQUEST_STATUS, REFUND_STATUS, REFUND_SOURCES } = require('../config/refunds');

const REASONS = Object.keys(CLAIM_REASONS);
const CLAIM_STATUSES = Object.values(CLAIM_STATUS);
const REQUEST_STATUSES = Object.values(CANCEL_REQUEST_STATUS);
const REFUND_STATUSES = Object.values(REFUND_STATUS);
const SOURCES = Object.keys(REFUND_SOURCES);

// ---------- building blocks ----------
const id = (name, label) => param(name).isInt({ min: 1 }).withMessage(`${label} must be a positive number`).toInt();
const orderId = id('id', 'Order id');
const sellerOrderId = id('sellerOrderId', 'Seller order id');
const claimId = id('id', 'Claim id');
const refundId = id('id', 'Refund id');
const salesId = id('id', 'Order id');
const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
const search = query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long');
const sort = query('sort').optional({ values: 'falsy' }).trim().isIn(['newest', 'oldest']).withMessage('sort must be newest or oldest');
const oneOf = (chain, label, list) =>
  chain.optional({ values: 'falsy' }).trim().toLowerCase().isIn(list).withMessage(`${label} must be one of: ${list.join(', ')}`);
const boolQuery = (field) =>
  query(field)
    .optional({ values: 'falsy' })
    .isIn(['true', 'false'])
    .withMessage(`${field} must be true or false`)
    .bail()
    .customSanitizer((v) => v === 'true');
const dateQuery = (field, endOfDay) =>
  query(field)
    .optional({ values: 'falsy' })
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${field} must be a date in YYYY-MM-DD format`)
    .bail()
    .customSanitizer((v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00` : v));
const text = (field, label, { required = false, min = 3, max = 500 } = {}) => {
  const chain = body(field);
  return (required ? chain.trim().notEmpty().withMessage(`${label} is required`).bail() : chain.optional({ values: 'falsy' }).trim())
    .isLength({ min: required ? min : 0, max })
    .withMessage(`${label} must be ${required ? `${min}-` : 'at most '}${max} characters`);
};
const amount = (field, label, { required = false, min = 0.01 } = {}) => {
  const chain = required
    ? body(field).notEmpty().withMessage(`${label} is required`).bail()
    : body(field).optional({ values: 'null' });
  return chain
    .custom((v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim()))
    .withMessage(`${label} must be a number with up to 2 decimals`)
    .bail()
    .isFloat({ min, max: 100000000 })
    .withMessage(`${label} must be ${min === 0 ? '0 or more' : 'more than 0'}`)
    .toFloat();
};
const boolBody = (field) =>
  body(field).optional({ values: 'null' }).isBoolean().withMessage(`${field} must be true or false`).toBoolean();
const pastDate = (field, label) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${label} must be YYYY-MM-DD`)
    .bail()
    .custom((v) => v <= new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10)) // Eswatini time
    .withMessage(`${label} cannot be in the future`);
const note = text('note', 'Note');

// ======================= CANCELLATIONS =======================

// POST /me/orders/:id/seller-orders/:sellerOrderId/cancel   { reason }
const buyerCancel = [orderId, sellerOrderId, text('reason', 'Reason', { required: true })];
// DELETE /me/orders/:id/seller-orders/:sellerOrderId/cancel-request
// GET    /me/orders/:id/seller-orders/:sellerOrderId/claim-options
const sellerOrderParams = [orderId, sellerOrderId];

// POST /me/sales/:id/cancel   { reason }
const sellerCancel = [salesId, text('reason', 'Reason', { required: true })];
// POST /me/sales/:id/cancel-request/accept   { note? }
const acceptRequest = [salesId, note];
// POST /me/sales/:id/cancel-request/decline   { reason }
const declineRequest = [salesId, text('reason', 'Reason', { required: true })];

// POST /admin/orders/:id/seller-orders/:sellerOrderId/cancel   { reason, refundAmount? }  (no refundAmount = full refund)
const adminCancel = [orderId, sellerOrderId, text('reason', 'Reason', { required: true }), amount('refundAmount', 'Refund amount', { min: 0 })];
// POST /admin/orders/:id/seller-orders/:sellerOrderId/refund   { amount, reason }
const adminRefund = [orderId, sellerOrderId, amount('amount', 'Amount', { required: true }), text('reason', 'Reason', { required: true })];

// GET /admin/orders/cancellation-requests
const requestList = [oneOf(query('status'), 'status', REQUEST_STATUSES), ...paging];
// POST /admin/orders/cancellation-requests/:requestId/decide   { decision, note? (required to reject) }
const decideRequest = [
  id('requestId', 'Request id'),
  body('decision').trim().notEmpty().withMessage('decision is required').bail().toLowerCase()
    .isIn(['approve', 'reject']).withMessage('decision must be approve or reject'),
  body('note')
    .if((value, { req }) => String((req.body && req.body.decision) || '').trim().toLowerCase() === 'reject')
    .trim()
    .notEmpty()
    .withMessage('Please give a reason for rejecting the request'),
  text('note', 'Note'),
];

// ======================= CLAIMS =======================

// "items" arrives as JSON text in form-data: [{ "orderItemId": 12, "quantity": 2 }]
const claimItems = body('items')
  .customSanitizer((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch (err) {
      return null;
    }
  })
  .custom((v) => Array.isArray(v) && v.length >= 1 && v.length <= 50)
  .withMessage('items must be a list of { orderItemId, quantity } (1-50 items, as JSON text in form-data)')
  .bail()
  .custom((list) =>
    list.every(
      (l) =>
        l &&
        Number.isInteger(Number(l.orderItemId)) &&
        Number(l.orderItemId) > 0 &&
        /^\d+(\.\d{1,2})?$/.test(String(l.quantity)) &&
        Number(l.quantity) > 0
    )
  )
  .withMessage('Each item needs an orderItemId and a quantity more than 0 (up to 2 decimals)')
  .bail()
  .customSanitizer((list) => list.map((l) => ({ orderItemId: Number(l.orderItemId), quantity: Number(l.quantity) })));

// POST /me/claims   (form-data, checked AFTER the photos upload)
const openClaim = [
  body('sellerOrderId').notEmpty().withMessage('sellerOrderId is required').bail().isInt({ min: 1 }).withMessage('sellerOrderId must be a positive number').toInt(),
  body('reason').trim().notEmpty().withMessage('Choose what went wrong').bail().toLowerCase()
    .isIn(REASONS).withMessage(`reason must be one of: ${REASONS.join(', ')}`),
  text('description', 'Description', { required: true, min: 10, max: 1000 }),
  claimItems,
];

const claimById = [claimId];
const claimPhoto = [claimId, id('photoId', 'Photo id')];
// POST .../claims/:id/messages   (form-data: message?, photos[]?)
const claimMessage = [claimId, text('message', 'Message', { max: 2000 })];
// POST /me/claims/:id/escalate | withdraw | returned  and  .../return-received   { note? }
const claimNote = [claimId, note];

// GET /me/claims, /me/sales/claims
const claimList = [
  oneOf(query('status'), 'status', CLAIM_STATUSES),
  boolQuery('active'),
  oneOf(query('reason'), 'reason', REASONS),
  search,
  sort,
  ...paging,
];
// GET /admin/claims
const adminClaimList = [
  ...claimList,
  query('sellerId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('sellerId must be a positive number').toInt(),
  query('buyerId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('buyerId must be a positive number').toInt(),
  dateQuery('from', false),
  dateQuery('to', true),
];

// POST /me/sales/claims/:id/accept   { refundAmount?, returnRequired?, note? }  (no refundAmount = everything claimed)
const claimAccept = [claimId, amount('refundAmount', 'Refund amount'), boolBody('returnRequired'), note];
// POST /me/sales/claims/:id/reject   { reason }
const claimReject = [claimId, text('reason', 'Reason', { required: true })];
// POST /admin/claims/:id/decide   { decision, refundAmount?, returnRequired?, note }
const claimDecide = [
  claimId,
  body('decision').trim().notEmpty().withMessage('decision is required').bail().toLowerCase()
    .isIn(['refund', 'no_refund']).withMessage('decision must be refund or no_refund'),
  amount('refundAmount', 'Refund amount'),
  boolBody('returnRequired'),
  text('note', 'Note', { required: true }),
];

// ======================= REFUNDS =======================

// Bank account for refunds (Eswatini)
const bankFields = [
  text('bankName', 'Bank name', { required: true, min: 2, max: 100 }),
  text('accountName', 'Account holder', { required: true, min: 2, max: 150 }),
  body('accountNumber').trim().notEmpty().withMessage('Account number is required').bail()
    .matches(/^[0-9]{6,20}$/).withMessage('Account number must be 6-20 digits'),
  body('branchCode').optional({ values: 'falsy' }).trim()
    .matches(/^[0-9A-Za-z]{3,20}$/).withMessage('Branch code must be 3-20 letters or digits'),
];

// GET /me/refunds
const myRefundList = [oneOf(query('status'), 'status', REFUND_STATUSES), ...paging];
const refundById = [refundId];
// PUT /me/refunds/bank-account
const saveAccount = bankFields;
// PUT /me/refunds/:id/bank-details   { ...bank, saveForNextTime? }
const bankDetails = [refundId, ...bankFields, boolBody('saveForNextTime')];

// GET /admin/refunds, /export
const adminRefundList = [
  oneOf(query('status'), 'status', REFUND_STATUSES),
  oneOf(query('source'), 'source', SOURCES),
  boolQuery('overdue'),
  boolQuery('needsBankDetails'),
  boolQuery('recoverFromSeller'),
  dateQuery('from', false),
  dateQuery('to', true),
  search,
  ...paging,
];
// POST /admin/refunds/:id/paid   (form-data: bankReference, paidOn, note?, file?)
const refundPaid = [
  text('bankReference', 'Bank reference', { required: true, min: 2, max: 100 }),
  pastDate('paidOn', 'Payment date'),
  note,
];
// POST /admin/refunds/:id/failed   { reason }
const refundFailed = [refundId, text('reason', 'Reason', { required: true })];

module.exports = {
  buyerCancel,
  sellerOrderParams,
  sellerCancel,
  acceptRequest,
  declineRequest,
  adminCancel,
  adminRefund,
  requestList,
  decideRequest,
  openClaim,
  claimById,
  claimPhoto,
  claimMessage,
  claimNote,
  claimList,
  adminClaimList,
  claimAccept,
  claimReject,
  claimDecide,
  myRefundList,
  refundById,
  saveAccount,
  bankDetails,
  adminRefundList,
  refundPaid,
  refundFailed,
};
