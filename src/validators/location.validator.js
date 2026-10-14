// Validation for the PUBLIC location APIs (dropdowns, search, details).
const { query, param } = require('express-validator');
const { LOCATION_TYPES } = require('../utils/constants');

const idParam = param('id').isInt({ min: 1 }).withMessage('Location id must be a positive number').toInt();

// GET /locations?type=region   |   GET /locations?parentId=<id>   (kept for older screens)
const list = [
  query('type')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(LOCATION_TYPES)
    .withMessage(`type must be one of: ${LOCATION_TYPES.join(', ')}`),

  query('parentId')
    .optional({ values: 'falsy' })
    .isInt({ min: 1 })
    .withMessage('parentId must be a positive number')
    .toInt(),
];

// GET /locations/:id, /locations/regions/:id/tinkhundla, /locations/tinkhundla/:id/imiphakatsi
const byId = [idParam];

// GET /locations/search?q=&type=&limit=
const search = [
  query('q')
    .trim()
    .notEmpty()
    .withMessage('Type at least 2 letters to search')
    .bail()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search text must be 2-100 characters'),

  query('type')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(LOCATION_TYPES)
    .withMessage(`type must be one of: ${LOCATION_TYPES.join(', ')}`),

  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 50 })
    .withMessage('limit must be between 1 and 50')
    .toInt(),
];

module.exports = { list, byId, search };
