// Validation for the Contact Us form (public) and the admin inbox.
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const { normalizeEswatiniMobile, emailField } = require('./common');
const { CONTACT_SENDER_TYPES, CONTACT_SUBJECTS, CONTACT_STATUSES } = require('../config/contact');

const SENDER_TYPES = Object.keys(CONTACT_SENDER_TYPES);
const SUBJECTS = Object.keys(CONTACT_SUBJECTS);
const STATUSES = Object.keys(CONTACT_STATUSES);

const choice = (chain, label, list) =>
  chain.trim().notEmpty().withMessage(`${label} is required`).bail().toLowerCase().isIn(list).withMessage(`${label} must be one of: ${list.join(', ')}`);

// POST /contact   (Figma "Send Us a Message")
const submit = [
  body('fullName')
    .trim()
    .notEmpty()
    .withMessage('Full name is required')
    .bail()
    .isLength({ min: 2, max: 150 })
    .withMessage('Full name must be 2-150 characters')
    .bail()
    .matches(/^[\p{L}\p{N}][\p{L}\p{N}\s&.,'()/-]*$/u)
    .withMessage("Full name can only contain letters, numbers, spaces and & . , ' ( ) / -"),
  emailField('email'),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .customSanitizer(normalizeEswatiniMobile)
    .matches(/^\+268[0-9]{8}$/)
    .withMessage('Enter a valid Eswatini phone number, e.g. +268 7612 3456'),
  choice(body('senderType'), 'I am a', SENDER_TYPES),
  choice(body('subject'), 'Subject', SUBJECTS),
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .bail()
    .isLength({ min: 10, max: 3000 })
    .withMessage('Message must be 10-3000 characters'),
  // Hidden field (honeypot): real users never fill it; bots usually do
  body('website').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
];

// ======================= ADMIN =======================
const idParam = param('id').isInt({ min: 1 }).withMessage('Message id must be a positive number').toInt();
const dateQuery = (field, endOfDay) =>
  query(field)
    .optional({ values: 'falsy' })
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${field} must be a date in YYYY-MM-DD format`)
    .bail()
    .customSanitizer((v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00` : v));

// GET /admin/contact-messages, /export
const list = [
  query('status').optional({ values: 'falsy' }).trim().toLowerCase().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  query('subject').optional({ values: 'falsy' }).trim().toLowerCase().isIn(SUBJECTS).withMessage(`subject must be one of: ${SUBJECTS.join(', ')}`),
  query('senderType').optional({ values: 'falsy' }).trim().toLowerCase().isIn(SENDER_TYPES).withMessage(`senderType must be one of: ${SENDER_TYPES.join(', ')}`),
  query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long'),
  dateQuery('from', false),
  dateQuery('to', true),
  query('sort').optional({ values: 'falsy' }).trim().isIn(['newest', 'oldest']).withMessage('sort must be newest or oldest'),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: MAX_LIMIT }).withMessage(`limit must be between 1 and ${MAX_LIMIT}`).toInt(),
];

const byId = [idParam];

// POST /admin/contact-messages/:id/reply
const reply = [
  idParam,
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Reply message is required')
    .bail()
    .isLength({ min: 2, max: 5000 })
    .withMessage('Reply must be 2-5000 characters'),
];

// PATCH /admin/contact-messages/:id/status   (new = mark unread, read = mark read / reopen, closed = close)
const setStatus = [
  idParam,
  body('status')
    .trim()
    .notEmpty()
    .withMessage('status is required')
    .bail()
    .toLowerCase()
    .isIn(['new', 'read', 'closed'])
    .withMessage('status must be one of: new, read, closed'),
];

module.exports = { submit, list, byId, reply, setStatus };
