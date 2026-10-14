// Validation for the admin category APIs.
const { body, param, query } = require('express-validator');
const { APPLIES_TO, CATEGORY_NAME_RULE, CATEGORY_NAME_MAX } = require('../config/categories');

const TABS = ['product', 'service'];

const idParam = param('id').isInt({ min: 1 }).withMessage('Category id must be a positive number').toInt();

const nameRules = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .bail()
    .isLength({ min: 2, max: CATEGORY_NAME_MAX })
    .withMessage(`Category name must be 2-${CATEGORY_NAME_MAX} characters`)
    .bail()
    .matches(CATEGORY_NAME_RULE)
    .withMessage("Category name can only contain letters, numbers, spaces and & ' ( ) . , / -");

const appliesToField = body('appliesTo')
  .optional({ values: 'falsy' })
  .trim()
  .toLowerCase()
  .isIn(APPLIES_TO)
  .withMessage(`appliesTo must be one of: ${APPLIES_TO.join(', ')}`);

const descriptionField = body('description')
  .optional({ values: 'null' })
  .isString()
  .withMessage('Description must be text')
  .bail()
  .trim()
  .isLength({ max: 500 })
  .withMessage('Description can be at most 500 characters');

const sortOrderField = body('sortOrder')
  .optional({ values: 'null' })
  .isInt({ min: 0, max: 9999 })
  .withMessage('sortOrder must be a number from 0 to 9999')
  .toInt();

const optionalBoolQuery = (field) =>
  query(field)
    .optional({ values: 'falsy' })
    .isIn(['true', 'false'])
    .withMessage(`${field} must be true or false`)
    .bail()
    .customSanitizer((v) => v === 'true');

// GET /admin/categories
const list = [
  query('type')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(TABS)
    .withMessage(`type must be one of: ${TABS.join(', ')}`),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long'),
  optionalBoolQuery('isActive'),
];

// GET / DELETE /admin/categories/:id, POST /admin/categories/:id/icon
const byId = [idParam];

// POST /admin/categories
const create = [
  nameRules(body('name')),
  body('parentId')
    .optional({ values: 'null' })
    .isInt({ min: 1 })
    .withMessage('parentId must be a positive number')
    .toInt(),
  appliesToField,
  descriptionField,
  sortOrderField,
];

// PUT /admin/categories/:id   (send only the fields to change)
const update = [
  idParam,
  nameRules(body('name').optional({ values: 'null' })),
  appliesToField,
  descriptionField,
  sortOrderField,
  body().custom((value) => {
    const fields = ['name', 'appliesTo', 'description', 'sortOrder'];
    if (!value || !fields.some((f) => value[f] !== undefined && value[f] !== null)) {
      throw new Error(`Send at least one of: ${fields.join(', ')}`);
    }
    return true;
  }),
];

// PATCH /admin/categories/:id/status
const setStatus = [
  idParam,
  body('isActive')
    .exists({ values: 'null' })
    .withMessage('isActive is required')
    .bail()
    .isBoolean({ strict: false })
    .withMessage('isActive must be true or false')
    .toBoolean(true),
];

// POST /admin/categories/import
const importCsv = [optionalBoolQuery('dryRun')];

module.exports = { list, byId, create, update, setStatus, importCsv };
