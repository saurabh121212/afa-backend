// Validation for saved delivery addresses (/me/addresses).
const { body, param } = require('express-validator');
const { BUSINESS_NAME_RULE, normalizeEswatiniMobile } = require('./common');

const idParam = param('id').isInt({ min: 1 }).withMessage('Address id must be a positive number').toInt();

// "Home", "Office", "Warehouse", "Mum's place"
const label = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Address label is required (e.g. Home, Office, Warehouse)')
    .bail()
    .isLength({ min: 2, max: 30 })
    .withMessage('Address label must be 2-30 characters')
    .bail()
    .matches(/^[\p{L}\p{N}][\p{L}\p{N}\s'&./-]*$/u)
    .withMessage("Address label can only contain letters, numbers, spaces and ' & . / -");

const addressLine = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Address is required (e.g. Plot 45, Ngwane Park)')
    .bail()
    .isLength({ min: 5, max: 255 })
    .withMessage('Address must be 5-255 characters');

const contactName = body('contactName')
  .optional({ values: 'falsy' })
  .trim()
  .isLength({ min: 2, max: 150 })
  .withMessage('Contact name must be 2-150 characters')
  .bail()
  .matches(BUSINESS_NAME_RULE)
  .withMessage("Contact name can only contain letters, numbers, spaces and & . , ' ( ) / -");

const phone = body('phone')
  .optional({ values: 'falsy' })
  .trim()
  .customSanitizer(normalizeEswatiniMobile)
  .matches(/^\+268[0-9]{8}$/)
  .withMessage('Enter a valid Eswatini phone number, e.g. +268 7612 3456');

const landmark = body('landmark')
  .optional({ values: 'falsy' })
  .trim()
  .isLength({ max: 255 })
  .withMessage('Landmark / directions can be at most 255 characters');

const locationId = (field, label2, required) => {
  const chain = required ? body(field) : body(field).optional({ values: 'falsy' });
  return (required ? chain.notEmpty().withMessage(`${label2} is required`).bail() : chain)
    .isInt({ min: 1 })
    .withMessage(`${label2} is not valid`)
    .toInt();
};

const isDefault = body('isDefault')
  .optional({ values: 'null' })
  .isBoolean({ strict: false })
  .withMessage('isDefault must be true or false')
  .toBoolean(true);

// POST /me/addresses
const create = [
  label(body('label')),
  addressLine(body('addressLine')),
  contactName,
  phone,
  landmark,
  locationId('regionId', 'Region', true),
  locationId('inkhundlaId', 'Inkhundla', true),
  locationId('umphakatsiId', 'Umphakatsi', false),
  isDefault,
];

// PUT /me/addresses/:id   (send only what changes)
const update = [
  idParam,
  label(body('label').optional()),
  addressLine(body('addressLine').optional()),
  contactName,
  phone,
  landmark,
  body('regionId').optional().isInt({ min: 1 }).withMessage('Region is not valid').toInt(),
  body('inkhundlaId').optional().isInt({ min: 1 }).withMessage('Inkhundla is not valid').toInt(),
  locationId('umphakatsiId', 'Umphakatsi', false),
  isDefault,
  body().custom((value) => {
    const fields = ['label', 'addressLine', 'contactName', 'phone', 'landmark', 'regionId', 'inkhundlaId', 'umphakatsiId', 'isDefault'];
    if (!value || !fields.some((f) => value[f] !== undefined)) throw new Error(`Send at least one of: ${fields.join(', ')}`);
    return true;
  }),
];

const byId = [idParam];

module.exports = { create, update, byId };
