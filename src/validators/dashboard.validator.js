// Validation for the dashboards: the period, and the admin seller-performance list / reports.
const { param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { PERIODS, MAX_CUSTOM_DAYS } = require('../services/dashboard/periods');
const { REPORTS, SORTS } = require('../services/dashboard/adminDashboard.service');

const isDay = (field) =>
  query(field)
    .if(query('period').equals('custom'))
    .notEmpty()
    .withMessage(`${field} is required when period is custom (YYYY-MM-DD)`)
    .bail()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${field} must be a date in YYYY-MM-DD format`)
    .bail()
    .customSanitizer((v) => new Date(`${String(v).slice(0, 10)}T12:00:00+02:00`));

// ?period=7d|30d|90d|12m|custom&from=&to=
const period = [
  query('period').optional({ values: 'falsy' }).trim().isIn(PERIODS).withMessage(`period must be one of: ${PERIODS.join(', ')}`),
  isDay('from'),
  isDay('to'),
  query('to')
    .if(query('period').equals('custom'))
    .custom((to, { req }) => {
      const from = req.query.from instanceof Date ? req.query.from : new Date(req.query.from);
      const end = to instanceof Date ? to : new Date(to);
      if (end < from) throw new Error('to must be on or after from');
      if ((end - from) / 86400000 > MAX_CUSTOM_DAYS) throw new Error(`A custom period can be at most ${MAX_CUSTOM_DAYS} days`);
      return true;
    }),
];

const refresh = query('refresh').optional({ values: 'falsy' }).isIn(['true', 'false']).withMessage('refresh must be true or false').bail().customSanitizer((v) => v === 'true');

// GET /me/dashboard
const mine = period;
// GET /admin/dashboard
const admin = [...period, refresh];
// GET /admin/dashboard/seller-performance
const sellerPerformance = [
  ...period,
  query('sort').optional({ values: 'falsy' }).trim().isIn(SORTS).withMessage(`sort must be one of: ${SORTS.join(', ')}`),
  query('order').optional({ values: 'falsy' }).trim().toLowerCase().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
  query('userType').optional({ values: 'falsy' }).trim().isIn(['farmer', 'trader']).withMessage('userType must be farmer or trader'),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long'),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
// GET /admin/dashboard/reports/:report
const report = [...period, param('report').isIn(REPORTS).withMessage(`report must be one of: ${REPORTS.join(', ')}`)];

module.exports = { mine, admin, sellerPerformance, report };
