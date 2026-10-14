// Validation for the admin user-management, approval and KYC-queue APIs.
const { query, param, body } = require('express-validator');
const { USER_TYPES, USER_STATUS, DOCUMENT_STATUS } = require('../utils/constants');
const { MAX_LIMIT } = require('../utils/pagination');

const STATUS_FILTERS = Object.values(USER_STATUS);
const USER_SORTS = ['newest', 'oldest', 'name_asc', 'name_desc'];

const idParam = param('id').isInt({ min: 1 }).withMessage('User id must be a positive number').toInt();
const documentTypeParam = param('documentType')
  .trim()
  .matches(/^[a-z_]{2,50}$/)
  .withMessage('Document type is not valid');

const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be between 1 and ${MAX_LIMIT}`)
    .toInt(),
];
const searchQuery = query('search')
  .optional({ values: 'falsy' })
  .trim()
  .isLength({ max: 100 })
  .withMessage('search is too long');
const userTypeQuery = query('userType')
  .optional({ values: 'falsy' })
  .trim()
  .toLowerCase()
  .isIn(USER_TYPES)
  .withMessage(`userType must be one of: ${USER_TYPES.join(', ')}`);

// Reason / message text sent to the user
const textField = (field, label, min = 5) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ min, max: 2000 })
    .withMessage(`${label} must be ${min}-2000 characters`);

// GET /admin/users, GET /admin/users/export
const list = [
  searchQuery,
  userTypeQuery,
  query('status')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(STATUS_FILTERS)
    .withMessage(`status must be one of: ${STATUS_FILTERS.join(', ')}`),
  query('regionId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('regionId must be a positive number').toInt(),
  query('sort')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(USER_SORTS)
    .withMessage(`sort must be one of: ${USER_SORTS.join(', ')}`),
  ...paging,
];

const byId = [idParam];
const documentFile = [idParam, documentTypeParam];

// PATCH /admin/users/:id/documents/:documentType/review
const reviewDocument = [
  idParam,
  documentTypeParam,
  body('status')
    .trim()
    .notEmpty()
    .withMessage('status is required')
    .bail()
    .isIn(['approved', 'rejected'])
    .withMessage('status must be approved or rejected'),
  body('reason')
    .if(body('status').equals('rejected'))
    .trim()
    .notEmpty()
    .withMessage('Please give a reason for rejecting this document')
    .bail()
    .isLength({ min: 3, max: 500 })
    .withMessage('Reason must be 3-500 characters'),
  body('reason').optional({ values: 'falsy' }).trim(),
];

const reject = [idParam, textField('reason', 'Reason')];
const suspend = [idParam, textField('reason', 'Reason')];
const addNote = [idParam, textField('note', 'Note', 1)];

// GET /admin/kyc-queue
const kycQueue = [
  searchQuery,
  userTypeQuery,
  query('priority')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(['urgent', 'normal'])
    .withMessage('priority must be urgent or normal'),
  query('sort')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(['oldest', 'newest'])
    .withMessage('sort must be oldest or newest'),
  ...paging,
];

// GET /admin/kyc-queue/documents
const kycDocuments = [
  searchQuery,
  userTypeQuery,
  query('status')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(DOCUMENT_STATUS)
    .withMessage(`status must be one of: ${DOCUMENT_STATUS.join(', ')}`),
  query('documentType')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[a-z_]{2,50}$/)
    .withMessage('documentType is not valid'),
  query('sort')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(['oldest', 'newest'])
    .withMessage('sort must be oldest or newest'),
  ...paging,
];

module.exports = { list, byId, documentFile, reviewDocument, reject, suspend, addNote, kycQueue, kycDocuments };
