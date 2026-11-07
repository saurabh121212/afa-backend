// Validation for the credit score endpoints.
const { param, query } = require('express-validator');
const { GRADES, SCORED_USER_TYPES } = require('../config/creditScore');

const GRADE_KEYS = GRADES.map((g) => g.key);
const SORTS = ['score_desc', 'score_asc', 'recent'];
const oneOf = (field, list) =>
  query(field).optional({ values: 'falsy' }).trim().toLowerCase().isIn(list).withMessage(`${field} must be one of: ${list.join(', ')}`);
const scoreQuery = (field) =>
  query(field).optional({ values: 'null' }).isInt({ min: 0, max: 100 }).withMessage(`${field} must be a whole number from 0 to 100`).toInt();

const filters = [
  oneOf('userType', SCORED_USER_TYPES),
  oneOf('grade', GRADE_KEYS),
  query('regionId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('regionId must be a positive number').toInt(),
  scoreQuery('minScore'),
  scoreQuery('maxScore'),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search can be at most 100 characters'),
  oneOf('sort', SORTS),
];

// GET /admin/credit-scores
const list = [
  ...filters,
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be a positive number').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt(),
];
// GET /admin/credit-scores/export
const exportCsv = filters;
// GET /admin/credit-scores/:userId, POST .../:userId/recalculate
const byUser = [param('userId').isInt({ min: 1 }).withMessage('userId must be a positive number').toInt()];

module.exports = { list, exportCsv, byUser };
