// Validation for the admin location APIs.
const { body, param, query } = require('express-validator');
const { LOCATION_TYPES } = require('../utils/constants');
const { MAX_LIMIT } = require('../utils/pagination');

// Letters, numbers, spaces and ' ( ) . , / -
const LOCATION_NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}\s'().,/-]*$/u;

const idParam = param('id').isInt({ min: 1 }).withMessage('Location id must be a positive number').toInt();

const nameField = body('name')
  .trim()
  .notEmpty()
  .withMessage('Name is required')
  .bail()
  .isLength({ min: 2, max: 100 })
  .withMessage('Name must be 2-100 characters')
  .bail()
  .matches(LOCATION_NAME_RULE)
  .withMessage("Name can only contain letters, numbers, spaces and ' ( ) . , / -");

const optionalBoolQuery = (field) =>
  query(field)
    .optional({ values: 'falsy' })
    .isIn(['true', 'false'])
    .withMessage(`${field} must be true or false`)
    .bail()
    .customSanitizer((v) => v === 'true');

// GET /admin/locations
const list = [
  query('type')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(LOCATION_TYPES)
    .withMessage(`type must be one of: ${LOCATION_TYPES.join(', ')}`),
  query('parentId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('parentId must be a positive number').toInt(),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long'),
  optionalBoolQuery('isActive'),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be between 1 and ${MAX_LIMIT}`)
    .toInt(),
];

// GET /admin/locations/tree
const tree = [optionalBoolQuery('includeInactive')];

// GET /admin/locations/:id, DELETE /admin/locations/:id
const byId = [idParam];

// POST /admin/locations
const create = [
  nameField,
  body('type')
    .trim()
    .notEmpty()
    .withMessage('Type is required')
    .bail()
    .toLowerCase()
    .isIn(LOCATION_TYPES)
    .withMessage(`Type must be one of: ${LOCATION_TYPES.join(', ')}`),
  body('parentId')
    .optional({ values: 'null' })
    .isInt({ min: 1 })
    .withMessage('parentId must be a positive number')
    .toInt(),
];

// PUT /admin/locations/:id
const rename = [idParam, nameField];

// PATCH /admin/locations/:id/status
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

// POST /admin/locations/import
const importCsv = [optionalBoolQuery('dryRun')];

module.exports = { list, tree, byId, create, rename, setStatus, importCsv };
