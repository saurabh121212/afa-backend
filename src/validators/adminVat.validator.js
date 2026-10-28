// Validation for the admin VAT registration screens.
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { VAT_STATUS, VAT_SELLER_TYPES } = require('../config/vat');

const STATUSES = Object.values(VAT_STATUS).filter((s) => s !== VAT_STATUS.NONE); // pending, approved, rejected

const userIdParam = param('userId').isInt({ min: 1 }).withMessage('User id must be a positive number').toInt();

const reasonField = body('reason')
  .trim()
  .notEmpty()
  .withMessage('Please give a reason (the seller will see it)')
  .bail()
  .isLength({ min: 3, max: 500 })
  .withMessage('Reason must be 3-500 characters');

// GET /admin/vat-registrations
const list = [
  query('status').optional({ values: 'falsy' }).trim().toLowerCase().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  query('userType').optional({ values: 'falsy' }).trim().toLowerCase().isIn(VAT_SELLER_TYPES).withMessage(`userType must be one of: ${VAT_SELLER_TYPES.join(', ')}`),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long'),
  query('sort').optional({ values: 'falsy' }).trim().isIn(['oldest', 'newest']).withMessage('sort must be oldest or newest'),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];

const approve = [userIdParam];
const withReason = [userIdParam, reasonField];

module.exports = { list, approve, withReason };
