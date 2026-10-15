// Validation for marketplace listings: seller (/me/listings), public (/listings) and admin (/admin/listings).
//
// Here we only check the FORMAT of each field. What depends on the listing type
// (product vs service units, required fields before sending for review, category tab)
// is checked in listing.service.js.
const { body, param, query } = require('express-validator');
const { MAX_LIMIT } = require('../utils/pagination');
const {
  LISTING_STATUS,
  LISTING_KINDS,
  SELLER_USER_TYPES,
  DELIVERY_TYPES,
  LOGISTICS_BY,
  DURATION_UNITS,
} = require('../config/listingOptions');

const STATUSES = Object.values(LISTING_STATUS);
const today = () => new Date().toISOString().slice(0, 10);

const idParam = param('id').isInt({ min: 1 }).withMessage('Listing id must be a positive number').toInt();
const photoIdParam = param('photoId').isInt({ min: 1 }).withMessage('Photo id must be a positive number').toInt();

const paging = [
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('page must be 1 or more').toInt(),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be between 1 and ${MAX_LIMIT}`)
    .toInt(),
];
const searchQuery = query('search').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('search is too long');

// ---------- field builders (null / "" empties an optional field) ----------
const text = (field, label, { min = 1, max }) =>
  body(field)
    .optional({ values: 'falsy' })
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .isLength({ min, max })
    .withMessage(`${label} must be ${min}-${max} characters`);

const number = (field, label, { min, max, int = false }) => {
  const chain = body(field).optional({ values: 'null' });
  return (int ? chain.isInt({ min, max }) : chain.isFloat({ min, max }))
    .withMessage(`${label} must be a number from ${min} to ${max.toLocaleString('en')}`)
    .bail()
    .customSanitizer((v) => (int ? parseInt(v, 10) : Math.round(parseFloat(v) * 100) / 100));
};

// Unit / choice codes: checked against the right list in the service
const code = (field, label) =>
  body(field)
    .optional({ values: 'falsy' })
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .toLowerCase()
    .matches(/^[a-z_]{1,30}$/)
    .withMessage(`${label} is not valid`);

const choice = (field, label, options) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(Object.keys(options))
    .withMessage(`${label} must be one of: ${Object.keys(options).join(', ')}`);

const id = (field, label) =>
  body(field).optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage(`${label} is not valid`).toInt();

const bool = (field, label) =>
  body(field)
    .optional({ values: 'null' })
    .isBoolean({ strict: false })
    .withMessage(`${label} must be true or false`)
    .toBoolean(true);

const futureDate = (field, label) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${label} must be a valid date in YYYY-MM-DD format`)
    .bail()
    .customSanitizer((v) => v.slice(0, 10))
    .custom((v) => {
      if (v < today()) throw new Error(`${label} cannot be in the past`);
      return true;
    });

// Every field of the listing forms (product + service)
const listingFields = [
  text('name', 'Name', { min: 2, max: 150 }),
  text('description', 'Description', { min: 10, max: 3000 }),
  id('categoryId', 'Category'),
  id('subCategoryId', 'Sub-category'),
  // product (trader)
  text('brand', 'Brand / manufacturer', { max: 100 }),
  text('sku', 'SKU / product code', { max: 60 })
    .bail()
    .matches(/^[A-Za-z0-9._/-]+$/)
    .withMessage('SKU / product code can only contain letters, numbers and . _ / -'),
  // service
  text('vehicleRegistration', 'Vehicle / equipment registration', { min: 2, max: 30 })
    .bail()
    .matches(/^[A-Za-z0-9 -]+$/)
    .withMessage('Vehicle / equipment registration can only contain letters, numbers, spaces and -')
    .customSanitizer((v) => v.toUpperCase()),
  text('makeModel', 'Make / model', { max: 100 }),
  // price (Emalangeni)
  number('price', 'Price', { min: 0.01, max: 100000000 }),
  code('priceUnit', 'Price unit'),
  // product stock
  number('quantity', 'Quantity', { min: 0, max: 1000000000 }),
  code('quantityUnit', 'Quantity unit'),
  number('minOrderQuantity', 'Minimum order quantity', { min: 0.01, max: 1000000000 }),
  code('minOrderUnit', 'Minimum order unit'),
  // service capacity
  number('capacity', 'Capacity / load size', { min: 0.01, max: 100000000 }),
  code('capacityUnit', 'Capacity unit'),
  number('minBooking', 'Minimum booking', { min: 0.01, max: 100000 }),
  code('minBookingUnit', 'Minimum booking unit'),
  // availability
  code('availability', 'Availability'),
  futureDate('availableFrom', 'Available date'),
  // product delivery
  choice('deliveryType', 'Delivery type', DELIVERY_TYPES),
  number('deliveryDuration', 'Delivery duration', { min: 0, max: 365, int: true }),
  choice('deliveryDurationUnit', 'Delivery duration unit', DURATION_UNITS),
  choice('logisticsBy', 'Manage logistics by', LOGISTICS_BY),
  // service booking
  number('advanceNotice', 'Advance booking notice', { min: 0, max: 365, int: true }),
  choice('advanceNoticeUnit', 'Advance booking notice unit', DURATION_UNITS),
  body('coverageRegionIds').optional({ values: 'null' }).isArray({ max: 20 }).withMessage('Coverage area must be a list of region ids'),
  body('coverageRegionIds.*').isInt({ min: 1 }).withMessage('Each coverage region must be a valid region id').toInt(),
  // location
  bool('useRegisteredAddress', 'Same as my registered address'),
  text('address', 'Address', { min: 5, max: 255 }),
  id('regionId', 'Region'),
  id('inkhundlaId', 'Inkhundla'),
  id('umphakatsiId', 'Umphakatsi'),
  // "Publish Listing" (true) or "Save as Draft" (false / left out)
  bool('submit', 'submit'),
];

// ======================= SELLER =======================

// POST /me/listings   (name is the only field needed for a draft)
const create = [
  body('name').exists({ values: 'falsy' }).withMessage('Name is required'),
  ...listingFields,
];

// PUT /me/listings/:id   (send only what changes)
const update = [
  idParam,
  body('name').optional().not().isEmpty({ ignore_whitespace: true }).withMessage('Name cannot be empty'),
  ...listingFields,
];

// GET /me/listings
const myList = [
  query('status')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(STATUSES)
    .withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  searchQuery,
  ...paging,
];

const byId = [idParam];

// PATCH /me/listings/:id/inventory   (no new admin review)
const inventory = [
  idParam,
  number('quantity', 'Quantity', { min: 0, max: 1000000000 }),
  code('availability', 'Availability'),
  futureDate('availableFrom', 'Available date'),
  body().custom((v) => {
    if (!v || !['quantity', 'availability', 'availableFrom'].some((f) => v[f] !== undefined)) {
      throw new Error('Send at least one of: quantity, availability, availableFrom');
    }
    return true;
  }),
];

// PATCH /me/listings/:id/visibility   { visible: false } = pause, { visible: true } = show again
const visibility = [
  idParam,
  body('visible')
    .exists({ values: 'null' })
    .withMessage('visible is required')
    .bail()
    .isBoolean({ strict: false })
    .withMessage('visible must be true or false')
    .toBoolean(true),
];

// POST /me/listings/:id/photos
const photos = [idParam];

// DELETE /me/listings/:id/photos/:photoId
const photo = [idParam, photoIdParam];

// PATCH /me/listings/:id/photos/order   { photoIds: [5, 3, 4] } -> first = cover
const photoOrder = [
  idParam,
  body('photoIds').isArray({ min: 1, max: 10 }).withMessage('photoIds must be a list of photo ids'),
  body('photoIds.*').isInt({ min: 1 }).withMessage('Each photo id must be a positive number').toInt(),
];

// ======================= PUBLIC =======================

// GET /listings
const publicList = [
  searchQuery,
  query('kind').optional({ values: 'falsy' }).trim().toLowerCase().isIn(LISTING_KINDS).withMessage(`kind must be one of: ${LISTING_KINDS.join(', ')}`),
  query('categoryId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('categoryId must be a positive number').toInt(),
  query('subCategoryId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('subCategoryId must be a positive number').toInt(),
  query('regionId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('regionId must be a positive number').toInt(),
  query('sellerType')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(SELLER_USER_TYPES)
    .withMessage(`sellerType must be one of: ${SELLER_USER_TYPES.join(', ')}`),
  query('sellerId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('sellerId must be a positive number').toInt(),
  query('minPrice').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('minPrice must be a positive number').toFloat(),
  query('maxPrice').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('maxPrice must be a positive number').toFloat(),
  query('availability').optional({ values: 'falsy' }).trim().toLowerCase().matches(/^[a-z_]{1,30}$/).withMessage('availability is not valid'),
  query('sort')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(['newest', 'price_asc', 'price_desc', 'name_asc'])
    .withMessage('sort must be one of: newest, price_asc, price_desc, name_asc'),
  ...paging,
];

// ======================= ADMIN =======================

// GET /admin/listings, GET /admin/listings/export
const ADMIN_STATUSES = STATUSES.filter((s) => s !== LISTING_STATUS.DRAFT); // drafts are private to the seller
const adminList = [
  searchQuery,
  query('status')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(ADMIN_STATUSES)
    .withMessage(`status must be one of: ${ADMIN_STATUSES.join(', ')}`),
  query('kind').optional({ values: 'falsy' }).trim().toLowerCase().isIn(LISTING_KINDS).withMessage(`kind must be one of: ${LISTING_KINDS.join(', ')}`),
  query('categoryId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('categoryId must be a positive number').toInt(),
  query('sellerType')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(SELLER_USER_TYPES)
    .withMessage(`sellerType must be one of: ${SELLER_USER_TYPES.join(', ')}`),
  query('sort').optional({ values: 'falsy' }).trim().isIn(['newest', 'oldest']).withMessage('sort must be newest or oldest'),
  ...paging,
];

// reject / flag / disable need a reason (sent to the seller)
const withReason = [
  idParam,
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('Please give a reason (the seller will see it)')
    .bail()
    .isLength({ min: 5, max: 1000 })
    .withMessage('Reason must be 5-1000 characters'),
];

module.exports = {
  create,
  update,
  myList,
  byId,
  inventory,
  visibility,
  photos,
  photo,
  photoOrder,
  publicList,
  adminList,
  withReason,
};
