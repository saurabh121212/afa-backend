// Validation for Reviews & Ratings.
const { body, param, query } = require('express-validator');
const { REVIEW_RULES, REVIEW_STATUS, REPORT_REASONS, REVIEW_SORTS } = require('../config/reviews');

const RULES = REVIEW_RULES;
const STATUSES = Object.values(REVIEW_STATUS);
const REASONS = Object.keys(REPORT_REASONS);
const PUBLIC_SORTS = Object.keys(REVIEW_SORTS);
const ADMIN_SORTS = ['newest', 'oldest', 'most_reported', 'lowest'];

const idParam = (label = 'Review') => param('id').isInt({ min: 1 }).withMessage(`${label} id must be a positive number`).toInt();
const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be a positive number').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt(),
];
const ratingQuery = query('rating').optional({ values: 'falsy' }).isInt({ min: 1, max: 5 }).withMessage('rating must be 1 to 5').toInt();
const boolQuery = (field) =>
  query(field)
    .optional({ values: 'falsy' })
    .isIn(['true', 'false'])
    .withMessage(`${field} must be true or false`)
    .customSanitizer((v) => v === 'true');
const oneOf = (field, list, where = query) =>
  where(field).optional({ values: 'falsy' }).trim().toLowerCase().isIn(list).withMessage(`${field} must be one of: ${list.join(', ')}`);
const ymd = (field) =>
  query(field).optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage(`${field} must be a date in YYYY-MM-DD format`);

const stars = (required = true) => {
  const chain = body('rating');
  return (required ? chain.notEmpty().withMessage('Choose a rating from 1 to 5 stars').bail() : chain.optional({ values: 'null' }))
    .isInt({ min: 1, max: 5 })
    .withMessage('rating must be a whole number from 1 to 5')
    .toInt();
};
const comment = body('comment')
  .optional({ values: 'null' })
  .isString()
  .withMessage('comment must be text')
  .bail()
  .trim()
  .custom((v) => v === '' || v.length >= RULES.commentMin)
  .withMessage(`comment must be at least ${RULES.commentMin} characters`)
  .isLength({ max: RULES.commentMax })
  .withMessage(`comment can be at most ${RULES.commentMax} characters`)
  .customSanitizer((v) => (v === '' ? null : v));

// ---------- public ----------
// GET /listings/:id/reviews, GET /sellers/:id/reviews
const publicList = (label) => [
  idParam(label),
  ratingQuery,
  boolQuery('withComment'),
  oneOf('sort', PUBLIC_SORTS),
  ...paging,
];

// POST /reviews/:id/report   { reason, note? }
const report = [
  idParam(),
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('Choose why you are reporting this review')
    .bail()
    .toLowerCase()
    .isIn(REASONS)
    .withMessage(`reason must be one of: ${REASONS.join(', ')}`),
  body('note')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: RULES.reportNoteMax })
    .withMessage(`note can be at most ${RULES.reportNoteMax} characters`),
  body('note')
    .if(body('reason').equals('other'))
    .trim()
    .notEmpty()
    .withMessage('Please tell us what is wrong with this review'),
];

// ---------- buyer ----------
const create = [
  body('sellerOrderId').notEmpty().withMessage('sellerOrderId is required').bail().isInt({ min: 1 }).withMessage('sellerOrderId must be a positive number').toInt(),
  stars(true),
  comment,
];
const update = [
  idParam(),
  stars(false),
  comment,
  body().custom((v) => {
    if (!v || (v.rating === undefined && v.comment === undefined)) throw new Error('Send rating and / or comment');
    return true;
  }),
];
const myList = [oneOf('status', STATUSES), ...paging];
const pending = [...paging];
const byId = [idParam()];

// ---------- seller ----------
const received = [ratingQuery, boolQuery('replied'), ...paging];
const reply = [
  idParam(),
  body('reply')
    .isString()
    .withMessage('reply must be text')
    .bail()
    .trim()
    .isLength({ min: 2, max: RULES.replyMax })
    .withMessage(`reply must be 2-${RULES.replyMax} characters`),
];

// ---------- admin ----------
const adminList = [
  oneOf('status', STATUSES),
  ratingQuery,
  boolQuery('reported'),
  query('sellerId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('sellerId must be a positive number').toInt(),
  query('buyerId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('buyerId must be a positive number').toInt(),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search can be at most 100 characters'),
  ymd('from'),
  ymd('to'),
  oneOf('sort', ADMIN_SORTS),
  ...paging,
];
const hide = [
  idParam(),
  body('reason')
    .isString()
    .withMessage('reason must be text')
    .bail()
    .trim()
    .isLength({ min: 3, max: RULES.hideReasonMax })
    .withMessage(`Give a reason (3-${RULES.hideReasonMax} characters). The buyer sees it.`),
];

module.exports = { publicList, report, create, update, myList, pending, byId, received, reply, adminList, hide };
