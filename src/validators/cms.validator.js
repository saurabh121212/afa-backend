// Validation for the CMS: banners and FAQs (admin + public).
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { BANNER_PLACEMENTS, BANNER_STATUSES, BUSINESS_TZ } = require('../config/cms');

const PLACEMENTS = Object.keys(BANNER_PLACEMENTS);
const idParam = param('id').isInt({ min: 1 }).withMessage('Id must be a positive number').toInt();
const byId = [idParam];

const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
const searchQuery = query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long');

const isActiveBody = (required) => {
  const chain = required ? body('isActive').exists({ values: 'null' }).withMessage('isActive is required').bail() : body('isActive').optional({ values: 'null' });
  return chain.isBoolean({ strict: false }).withMessage('isActive must be true or false').toBoolean(true);
};
const isActiveQuery = query('isActive')
  .optional({ values: 'falsy' })
  .isIn(['true', 'false'])
  .withMessage('isActive must be true or false')
  .bail()
  .customSanitizer((v) => v === 'true');
const sortOrder = body('sortOrder').optional({ values: 'null' }).isInt({ min: 0, max: 9999 }).withMessage('sortOrder must be 0-9999').toInt();

const atLeastOne = (fields) =>
  body().custom((value) => {
    if (!value || !fields.some((f) => value[f] !== undefined)) throw new Error(`Send at least one of: ${fields.join(', ')}`);
    return true;
  });

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

// ======================= BANNERS =======================

// "2026-09-30" -> whole day in Eswatini time; full date-times are kept as sent
const bannerDate = (field, label, endOfDay) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .isISO8601()
    .withMessage(`${label} must be a date (YYYY-MM-DD) or date-time`)
    .bail()
    .customSanitizer((v) => {
      const s = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${endOfDay ? '23:59:59' : '00:00:00'}${BUSINESS_TZ}` : v;
      return new Date(s);
    })
    .custom((d) => {
      if (Number.isNaN(d.getTime())) throw new Error(`${label} is not a valid date`);
      return true;
    });

// "/marketplace", "/listings?categoryId=3" or "https://..."  (no javascript: or other schemes)
const linkUrl = body('linkUrl')
  .optional({ values: 'falsy' })
  .trim()
  .isLength({ max: 500 })
  .withMessage('Link can be at most 500 characters')
  .bail()
  .custom((v) => {
    const internal = /^\/[^\s]*$/.test(v) && !v.startsWith('//');
    const external = /^https?:\/\/[^\s]+$/i.test(v);
    if (!internal && !external) throw new Error('Link must start with "/" (a page on AFA) or with https://');
    return true;
  });

const bannerFields = [
  optionalText('subtitle', 'Subtitle', 300),
  optionalText('buttonText', 'Button text', 40),
  linkUrl,
  bannerDate('startsAt', 'Start date', false),
  bannerDate('endsAt', 'End date', true),
  isActiveBody(false),
  sortOrder,
];

const bannerTitle = (chain) =>
  chain.trim().notEmpty().withMessage('Title is required').bail().isLength({ min: 2, max: 150 }).withMessage('Title must be 2-150 characters');
const placement = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Placement is required')
    .bail()
    .toLowerCase()
    .isIn(PLACEMENTS)
    .withMessage(`Placement must be one of: ${PLACEMENTS.join(', ')}`);

// GET /admin/banners
const bannerList = [
  query('placement').optional({ values: 'falsy' }).trim().toLowerCase().isIn(PLACEMENTS).withMessage(`placement must be one of: ${PLACEMENTS.join(', ')}`),
  query('status').optional({ values: 'falsy' }).trim().toLowerCase().isIn(BANNER_STATUSES).withMessage(`status must be one of: ${BANNER_STATUSES.join(', ')}`),
  searchQuery,
  ...paging,
];

// POST /admin/banners
const bannerCreate = [bannerTitle(body('title')), placement(body('placement')), ...bannerFields];

// PUT /admin/banners/:id
const bannerUpdate = [
  idParam,
  bannerTitle(body('title').optional()),
  placement(body('placement').optional()),
  ...bannerFields,
  atLeastOne(['title', 'subtitle', 'buttonText', 'linkUrl', 'placement', 'startsAt', 'endsAt', 'isActive', 'sortOrder']),
];

// PATCH .../:id/status
const setStatus = [idParam, isActiveBody(true)];

// GET /banners?placement=
const bannerPublic = [
  query('placement').optional({ values: 'falsy' }).trim().toLowerCase().isIn(PLACEMENTS).withMessage(`placement must be one of: ${PLACEMENTS.join(', ')}`),
];

// ======================= FAQs =======================

const question = (chain) =>
  chain.trim().notEmpty().withMessage('Question is required').bail().isLength({ min: 5, max: 300 }).withMessage('Question must be 5-300 characters');
const answer = (chain) =>
  chain.trim().notEmpty().withMessage('Answer is required').bail().isLength({ min: 5, max: 5000 }).withMessage('Answer must be 5-5000 characters');
const categoryIdBody = (chain) => chain.isInt({ min: 1 }).withMessage('Choose an FAQ category').toInt();

// GET /admin/faqs
const faqList = [
  searchQuery,
  query('categoryId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('categoryId must be a positive number').toInt(),
  isActiveQuery,
];

// POST /admin/faqs
const faqCreate = [
  categoryIdBody(body('categoryId').exists({ values: 'falsy' }).withMessage('Choose an FAQ category').bail()),
  question(body('question')),
  answer(body('answer')),
  sortOrder,
  isActiveBody(false),
];

// PUT /admin/faqs/:id
const faqUpdate = [
  idParam,
  categoryIdBody(body('categoryId').optional()),
  question(body('question').optional()),
  answer(body('answer').optional()),
  sortOrder,
  isActiveBody(false),
  atLeastOne(['categoryId', 'question', 'answer', 'sortOrder', 'isActive']),
];

const categoryName = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .bail()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be 2-100 characters')
    .bail()
    .matches(/^[\p{L}\p{N}][\p{L}\p{N}\s&'(),./-]*$/u)
    .withMessage("Category name can only contain letters, numbers, spaces and & ' ( ) , . / -");

// POST /admin/faq-categories
const faqCategoryCreate = [categoryName(body('name')), sortOrder];

// PUT /admin/faq-categories/:id
const faqCategoryUpdate = [idParam, categoryName(body('name').optional()), sortOrder, atLeastOne(['name', 'sortOrder'])];

// GET /faqs?search=
const faqPublic = [searchQuery];

module.exports = {
  byId,
  setStatus,
  bannerList,
  bannerCreate,
  bannerUpdate,
  bannerPublic,
  faqList,
  faqCreate,
  faqUpdate,
  faqCategoryCreate,
  faqCategoryUpdate,
  faqPublic,
};
