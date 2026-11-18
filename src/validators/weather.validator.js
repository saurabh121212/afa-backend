// Validation for the weather APIs (public, /me and admin).
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { ESWATINI_BOUNDS: B } = require('../config/weather');

const idParam = param('id').isInt({ min: 1 }).withMessage('Location id must be a positive number').toInt();
const page = query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt();
const limit = query('limit')
  .optional({ values: 'falsy' })
  .isInt({ min: 1, max: MAX_LIMIT })
  .withMessage(`limit must be between 1 and ${MAX_LIMIT}`)
  .toInt();
const regionId = query('regionId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('regionId must be a positive number').toInt();
const optionalBool = (field) =>
  query(field)
    .optional({ values: 'falsy' })
    .isIn(['true', 'false'])
    .withMessage(`${field} must be true or false`)
    .bail()
    .customSanitizer((v) => v === 'true');

// GET /weather/locations?regionId=
const listLocations = [regionId];

// GET /weather/locations/:id
const byId = [idParam];

// GET /admin/weather/runs?kind=&status=&page=&limit=
const listRuns = [
  query('kind').optional({ values: 'falsy' }).isIn(['current', 'forecast', 'geocode', 'location']).withMessage('kind must be current, forecast, geocode or location'),
  query('status').optional({ values: 'falsy' }).isIn(['running', 'success', 'partial', 'failed']).withMessage('status must be running, success, partial or failed'),
  page,
  limit,
];

// GET /admin/weather/locations?type=&regionId=&missing=&source=&search=&page=&limit=
const listCoordinates = [
  query('type').optional({ values: 'falsy' }).isIn(['region', 'inkhundla']).withMessage('type must be region or inkhundla'),
  regionId,
  optionalBool('missing'),
  query('source').optional({ values: 'falsy' }).isIn(['seed', 'geocoded', 'manual']).withMessage('source must be seed, geocoded or manual'),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long'),
  page,
  limit,
];

// PATCH /admin/weather/locations/:id/coordinates   { latitude, longitude }  (both null = clear)
const coordinate = (field, min, max, label) =>
  body(field)
    .exists()
    .withMessage(`${label} is required (send null to clear)`)
    .bail()
    .custom((v) => v === null || (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))))
    .withMessage(`${label} must be a number`)
    .bail()
    .customSanitizer((v) => (v === null ? null : Math.round(Number(v) * 1e6) / 1e6))
    .custom((v) => v === null || (v >= min && v <= max))
    .withMessage(`${label} must be between ${min} and ${max} (inside Eswatini)`);

const setCoordinates = [
  idParam,
  coordinate('latitude', B.minLat, B.maxLat, 'Latitude'),
  coordinate('longitude', B.minLon, B.maxLon, 'Longitude'),
  body('longitude').custom((v, { req }) => (v === null) === (req.body.latitude === null)).withMessage('Send both latitude and longitude, or both as null to clear'),
];

// POST /admin/weather/refresh   { type?: current | forecast | all }
const refresh = [
  body('type').optional({ values: 'falsy' }).isIn(['current', 'forecast', 'all']).withMessage('type must be current, forecast or all'),
];

module.exports = { listLocations, byId, listRuns, listCoordinates, setCoordinates, refresh };
