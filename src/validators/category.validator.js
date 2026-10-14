// Validation for the PUBLIC category APIs.
const { query, param } = require('express-validator');

const TABS = ['product', 'service'];

// GET /categories?type=product|service
const tree = [
  query('type')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(TABS)
    .withMessage(`type must be one of: ${TABS.join(', ')}`),
];

// GET /categories/:id, /categories/:id/sub-categories
const byId = [param('id').isInt({ min: 1 }).withMessage('Category id must be a positive number').toInt()];

module.exports = { tree, byId };
