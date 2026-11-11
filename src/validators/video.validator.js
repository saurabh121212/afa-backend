// Validation for the CMS Video Gallery (admin + public).
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');

const LIMITS = { title: { min: 3, max: 150 }, description: { min: 5, max: 1000 }, link: { max: 500 } };

const idParam = param('id').isInt({ min: 1 }).withMessage('Id must be a positive number').toInt();
const byId = [idParam];

const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
const searchQuery = query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long');

const text = (chain, label, { min, max }) =>
  chain
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ min, max })
    .withMessage(`${label} must be ${min}-${max} characters`);

// A full web address (no javascript: or other schemes). YouTube links also get the thumbnail.
const link = (chain) =>
  chain
    .isString()
    .withMessage('Link must be text')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Link is required')
    .bail()
    .isLength({ max: LIMITS.link.max })
    .withMessage(`Link can be at most ${LIMITS.link.max} characters`)
    .bail()
    .custom((v) => {
      let url;
      try {
        url = new URL(v);
      } catch {
        throw new Error('Paste the full video link, e.g. https://www.youtube.com/watch?v=...');
      }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The link must start with https://');
      return true;
    });

const isActiveBody = (required) => {
  const chain = required ? body('isActive').exists({ values: 'null' }).withMessage('isActive is required').bail() : body('isActive').optional({ values: 'null' });
  return chain.isBoolean({ strict: false }).withMessage('isActive must be true or false').toBoolean(true);
};
const sortOrder = body('sortOrder').optional({ values: 'null' }).isInt({ min: 0, max: 9999 }).withMessage('sortOrder must be 0-9999').toInt();

const FIELDS = ['title', 'description', 'link', 'isActive', 'sortOrder'];
const atLeastOne = body().custom((value) => {
  if (!value || !FIELDS.some((f) => value[f] !== undefined)) throw new Error(`Send at least one of: ${FIELDS.join(', ')}`);
  return true;
});

// ======================= ADMIN =======================

// GET /admin/videos?isActive=&search=&page=&limit=
const adminList = [
  query('isActive')
    .optional({ values: 'falsy' })
    .isIn(['true', 'false'])
    .withMessage('isActive must be true or false')
    .bail()
    .customSanitizer((v) => v === 'true'),
  searchQuery,
  ...paging,
];

// POST /admin/videos
const required = (field, label) => body(field).exists({ values: 'null' }).withMessage(`${label} is required`).bail();
const create = [
  text(required('title', 'Title'), 'Title', LIMITS.title),
  text(required('description', 'Description'), 'Description', LIMITS.description),
  link(required('link', 'Link')),
  isActiveBody(false),
  sortOrder,
];

// PUT /admin/videos/:id   (send only what changes)
const update = [
  idParam,
  text(body('title').optional(), 'Title', LIMITS.title),
  text(body('description').optional(), 'Description', LIMITS.description),
  link(body('link').optional()),
  isActiveBody(false),
  sortOrder,
  atLeastOne,
];

// PATCH /admin/videos/:id/status
const setStatus = [idParam, isActiveBody(true)];

// ======================= PUBLIC =======================

// GET /videos?search=&page=&limit=
const publicList = [searchQuery, ...paging];

module.exports = { byId, adminList, create, update, setStatus, publicList, LIMITS };
