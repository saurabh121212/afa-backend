// Validation for invoices / credit notes / receipts, transaction history and payment status.
const { param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');

const id = (name, label) => param(name).isInt({ min: 1 }).withMessage(`${label} must be a positive number`).toInt();
const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
const oneOf = (field, list) =>
  query(field).optional({ values: 'falsy' }).trim().toLowerCase().isIn(list).withMessage(`${field} must be one of: ${list.join(', ')}`);
const positive = (field) => query(field).optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage(`${field} must be a positive number`).toInt();
const search = query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long');
const dateQuery = (field, endOfDay) =>
  query(field)
    .optional({ values: 'falsy' })
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${field} must be a date in YYYY-MM-DD format`)
    .bail()
    .customSanitizer((v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00` : v));
const status = query('status').optional({ values: 'falsy' }).trim().toLowerCase().matches(/^[a-z_]{2,30}$/).withMessage('status is not valid');
const dates = [dateQuery('from', false), dateQuery('to', true)];

const DOC_TYPES = ['invoice', 'credit_note', 'receipt'];

// GET /me/invoices
const myInvoices = [oneOf('type', DOC_TYPES), positive('orderId'), search, ...dates, ...paging];
// GET /admin/invoices
const adminInvoices = [...myInvoices, positive('sellerId'), positive('buyerId')];
// GET .../invoices/:id, /:id/pdf
const invoiceById = [id('id', 'Document id'), query('download').optional({ values: 'falsy' }).isIn(['true', 'false']).withMessage('download must be true or false')];
// GET /me/orders/:id/proforma, /me/orders/:id/payment-status
const orderById = [id('id', 'Order id')];

// GET /me/transactions, /export  (buyer: payment | refund; seller: sale | refund)
const myTransactions = [
  oneOf('type', ['payment', 'refund', 'sale']),
  status,
  oneOf('payoutStatus', ['held', 'released', 'cancelled', 'not_due']),
  ...dates,
  ...paging,
];
// GET /admin/transactions, /export, /stats
const adminTransactions = [
  oneOf('type', ['payment', 'refund', 'payout']),
  status,
  oneOf('method', ['bank_transfer', 'online']),
  positive('userId'),
  search,
  ...dates,
  ...paging,
];

module.exports = { myInvoices, adminInvoices, invoiceById, orderById, myTransactions, adminTransactions };
