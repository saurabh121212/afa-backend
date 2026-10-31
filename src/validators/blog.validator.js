// Validation for the Blog (admin + public). The HTML body is cleaned in the service (sanitize-html).
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { BLOG_STATUSES, BLOG_LIMITS, SLUG_RULE } = require('../config/blog');

const STATUSES = Object.keys(BLOG_STATUSES);
const L = BLOG_LIMITS;

const idParam = param('id').isInt({ min: 1 }).withMessage('Id must be a positive number').toInt();
const byId = [idParam];

const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
const searchQuery = query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long');
const booleanQuery = (field) =>
  query(field)
    .optional({ values: 'falsy' })
    .isIn(['true', 'false'])
    .withMessage(`${field} must be true or false`)
    .bail()
    .customSanitizer((v) => v === 'true');

// Optional text (null / "" clears it in the service)
const optionalText = (field, label, max) =>
  body(field)
    .optional({ values: 'falsy' })
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .isLength({ max })
    .withMessage(`${label} can be at most ${max} characters`);

const title = (chain) =>
  chain
    .isString()
    .withMessage('Title must be text')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .bail()
    .isLength(L.title)
    .withMessage(`Title must be ${L.title.min}-${L.title.max} characters`);

// The length of the text without tags is checked in the service, after cleaning
const content = (chain) =>
  chain
    .isString()
    .withMessage('Content must be text')
    .bail()
    .notEmpty()
    .withMessage('Content is required')
    .bail()
    .isLength({ max: L.contentHtml.max })
    .withMessage('The post is too long');

// Empty = made from the title
const slug = body('slug')
  .optional({ values: 'falsy' })
  .isString()
  .withMessage('Web address must be text')
  .bail()
  .trim()
  .toLowerCase()
  .isLength({ max: L.slug.max })
  .withMessage(`Web address can be at most ${L.slug.max} characters`)
  .bail()
  .matches(SLUG_RULE)
  .withMessage('Web address can only use lower-case letters, numbers and dashes, e.g. preparing-soil-for-summer');

const status = body('status')
  .optional({ values: 'falsy' })
  .trim()
  .toLowerCase()
  .isIn(STATUSES)
  .withMessage(`Status must be one of: ${STATUSES.join(', ')}`);

const showOnHomepage = body('showOnHomepage')
  .optional({ values: 'null' })
  .isBoolean({ strict: false })
  .withMessage('showOnHomepage must be true or false')
  .toBoolean(true);

const otherFields = [
  slug,
  optionalText('excerpt', 'Summary', L.excerpt.max),
  optionalText('category', 'Category', L.category.max),
  optionalText('authorName', 'Author', L.authorName.max),
  status,
  showOnHomepage,
];

const FIELDS = ['title', 'slug', 'excerpt', 'content', 'category', 'authorName', 'status', 'showOnHomepage'];
const atLeastOne = body().custom((value) => {
  if (!value || !FIELDS.some((f) => value[f] !== undefined)) throw new Error(`Send at least one of: ${FIELDS.join(', ')}`);
  return true;
});

// ======================= ADMIN =======================

// GET /admin/blogs
const adminList = [
  query('status').optional({ values: 'falsy' }).trim().toLowerCase().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  booleanQuery('homepage'),
  query('id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('id must be a positive number').toInt(),
  searchQuery,
  ...paging,
];

// POST /admin/blogs
const create = [title(body('title')), content(body('content')), ...otherFields];

// PUT /admin/blogs/:id   (send only what changes)
const update = [idParam, title(body('title').optional()), content(body('content').optional()), ...otherFields, atLeastOne];

// ======================= PUBLIC =======================

// GET /blogs?homepage=true&search=&category=&page=
const publicList = [
  booleanQuery('homepage'),
  query('category').optional({ values: 'falsy' }).trim().isLength({ max: L.category.max }).withMessage('category is too long'),
  searchQuery,
  ...paging,
];

// GET /blogs/:slug   (an address no post can have is a 404 in the service, like any unknown post)
const bySlug = [param('slug').trim().toLowerCase()];

module.exports = { byId, adminList, create, update, publicList, bySlug };
