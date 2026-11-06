// Validation for notifications (bell), devices (push tokens) and admin broadcasts.
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { USER_TYPES } = require('../utils/constants');
const { CATEGORIES, PLATFORMS, BROADCAST_CATEGORIES, BROADCAST_STATUS, BROADCAST_MAX_DAYS_AHEAD } = require('../config/notifications');

const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];
const byId = [param('id').isInt({ min: 1 }).withMessage('id must be a positive number').toInt()];
const categoryIn = (chain, list) => chain.optional({ values: 'falsy' }).trim().isIn(list).withMessage(`category must be one of: ${list.join(', ')}`);

const USER_CATEGORIES = Object.keys(CATEGORIES).filter((c) => c !== 'admin');

// ---------- bell ----------
const listFor = (categories) => [
  categoryIn(query('category'), categories),
  query('unread').optional({ values: 'falsy' }).isIn(['true', 'false']).withMessage('unread must be true or false').bail().customSanitizer((v) => v === 'true'),
  ...paging,
];
const myList = listFor(USER_CATEGORIES);
const adminList = listFor(['admin']);
const myReadAll = [categoryIn(body('category'), USER_CATEGORIES)];
const adminReadAll = [categoryIn(body('category'), ['admin'])];

// ---------- devices ----------
const token = body('token')
  .trim()
  .notEmpty()
  .withMessage('token is required')
  .bail()
  .isLength({ min: 20, max: 500 })
  .withMessage('token must be 20-500 characters')
  .bail()
  .matches(/^\S+$/)
  .withMessage('token must not contain spaces');
const registerDevice = [
  token,
  body('platform').trim().notEmpty().withMessage('platform is required').bail().toLowerCase().isIn(PLATFORMS).withMessage(`platform must be one of: ${PLATFORMS.join(', ')}`),
  body('deviceName').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('deviceName must be at most 100 characters'),
  body('appVersion').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('appVersion must be at most 30 characters'),
];
const removeDevice = [token];

// ---------- broadcasts ----------
const audience = (optional) => [
  (optional ? body('audience').optional() : body('audience').exists().withMessage('audience is required'))
    .bail()
    .isObject()
    .withMessage('audience must be an object: { type, userTypes?, regionIds?, userIds? }'),
  body('audience.type')
    .if(body('audience').exists())
    .trim()
    .notEmpty()
    .withMessage('audience.type is required')
    .bail()
    .isIn(['all', 'filter', 'users'])
    .withMessage('audience.type must be all, filter or users'),
  body('audience.userTypes').optional().isArray({ max: USER_TYPES.length }).withMessage('audience.userTypes must be a list'),
  body('audience.userTypes.*').isIn(USER_TYPES).withMessage(`audience.userTypes can contain: ${USER_TYPES.join(', ')}`),
  body('audience.regionIds').optional().isArray({ max: 50 }).withMessage('audience.regionIds must be a list (max 50)'),
  body('audience.regionIds.*').isInt({ min: 1 }).withMessage('audience.regionIds must be positive numbers').toInt(),
  body('audience.userIds')
    .if(body('audience.type').equals('users'))
    .isArray({ min: 1, max: 5000 })
    .withMessage('audience.userIds must list 1-5000 users'),
  body('audience.userIds.*').isInt({ min: 1 }).withMessage('audience.userIds must be positive numbers').toInt(),
];
const sendAt = body('sendAt')
  .optional({ values: 'null' })
  .isISO8601({ strict: true })
  .withMessage('sendAt must be a date-time, e.g. 2026-11-10T08:00:00+02:00')
  .bail()
  .custom((v) => {
    const t = new Date(v).getTime();
    if (t < Date.now() - 60 * 1000) throw new Error('sendAt cannot be in the past (leave it out to send now)');
    if (t > Date.now() + BROADCAST_MAX_DAYS_AHEAD * 86400000) throw new Error(`sendAt can be at most ${BROADCAST_MAX_DAYS_AHEAD} days ahead`);
    return true;
  })
  .customSanitizer((v) => new Date(v));
const broadcastFields = (optional) => {
  const req = (chain, label) => (optional ? chain.optional() : chain.exists({ values: 'falsy' }).withMessage(`${label} is required`).bail());
  return [
    req(body('category'), 'category').trim().isIn(Object.keys(BROADCAST_CATEGORIES)).withMessage('category must be advisory or announcement'),
    req(body('title'), 'title').trim().isLength({ min: 3, max: 120 }).withMessage('title must be 3-120 characters'),
    req(body('body'), 'body').trim().isLength({ min: 3, max: 1000 }).withMessage('body must be 3-1000 characters'),
    body('linkUrl')
      .optional({ values: 'null' })
      .trim()
      .if((v) => v !== '')
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('linkUrl must be a full http(s) link')
      .bail()
      .isLength({ max: 500 })
      .withMessage('linkUrl must be at most 500 characters'),
    ...audience(optional),
    sendAt,
  ];
};
const createBroadcast = broadcastFields(false);
const updateBroadcast = [...byId, ...broadcastFields(true)];
const previewBroadcast = audience(false);
const listBroadcasts = [
  query('status').optional({ values: 'falsy' }).trim().isIn(Object.values(BROADCAST_STATUS)).withMessage(`status must be one of: ${Object.values(BROADCAST_STATUS).join(', ')}`),
  categoryIn(query('category'), Object.keys(BROADCAST_CATEGORIES)),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long'),
  ...paging,
];

module.exports = {
  byId,
  myList,
  adminList,
  myReadAll,
  adminReadAll,
  registerDevice,
  removeDevice,
  createBroadcast,
  updateBroadcast,
  previewBroadcast,
  listBroadcasts,
};
