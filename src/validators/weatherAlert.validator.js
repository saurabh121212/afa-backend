// Validation for the admin weather alert APIs (/admin/weather/alerts).
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');

const SEVERITIES = ['advisory', 'warning', 'severe'];

const idParam = param('id').isInt({ min: 1 }).withMessage('Alert id must be a positive number').toInt();

const text = (field, label, min, max, { optional = false } = {}) => {
  const chain = optional ? body(field).optional() : body(field).exists({ values: 'falsy' }).withMessage(`${label} is required`).bail();
  return chain
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .isLength({ min, max })
    .withMessage(`${label} must be ${min}-${max} characters`);
};

const severity = (optional) =>
  (optional ? body('severity').optional() : body('severity').exists({ values: 'falsy' }).withMessage('Severity is required').bail())
    .isIn(SEVERITIES)
    .withMessage(`Severity must be ${SEVERITIES.join(', ')}`);

// A full date-time with its zone, e.g. "2026-11-20T14:00:00+02:00" (Eswatini time) or "...Z"
const dateTime = (field, label, optional) =>
  (optional ? body(field).optional() : body(field).exists({ values: 'falsy' }).withMessage(`${label} is required`).bail())
    .isISO8601({ strict: true })
    .withMessage(`${label} must be a date and time`)
    .bail()
    .toDate();

// null / [] = all of Eswatini, otherwise region ids. Read from req.body by the controller.
const regionIds = body('regionIds')
  .optional({ values: 'null' })
  .isArray({ max: 20 })
  .withMessage('regionIds must be a list of region ids (or null for all of Eswatini)')
  .bail()
  .custom((list) => list.every((v) => Number.isInteger(Number(v)) && Number(v) > 0))
  .withMessage('regionIds must be positive numbers');

// GET /admin/weather/alerts?status=&page=&limit=
const list = [
  query('status').optional({ values: 'falsy' }).isIn(['active', 'upcoming', 'ended']).withMessage('status must be active, upcoming or ended'),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];

// POST /admin/weather/alerts   { title, severity, message, regionIds?, startsAt, endsAt }
const create = [
  text('title', 'Title', 3, 150),
  severity(false),
  text('message', 'Message', 3, 1000),
  regionIds,
  dateTime('startsAt', 'Start', false),
  dateTime('endsAt', 'End', false),
];

// PATCH /admin/weather/alerts/:id   any of the above
const update = [
  idParam,
  text('title', 'Title', 3, 150, { optional: true }),
  severity(true),
  text('message', 'Message', 3, 1000, { optional: true }),
  regionIds,
  dateTime('startsAt', 'Start', true),
  dateTime('endsAt', 'End', true),
  body().custom((b) => ['title', 'severity', 'message', 'regionIds', 'startsAt', 'endsAt'].some((k) => b[k] !== undefined)).withMessage('Send at least one field to change'),
];

// POST /admin/weather/alerts/:id/end , DELETE /admin/weather/alerts/:id
const byId = [idParam];

module.exports = { list, create, update, byId };
