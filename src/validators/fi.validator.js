// FINANCIAL-INSTITUTION-ONLY validation rules
// (Figma "Financial Institution Registration" Step 1 and Step 2).
// Shared Account Security rules are in registration.validator.js.
const { body } = require('express-validator');
const {
  FI_INSTITUTION_TYPES,
  FI_PRODUCT_TYPES,
  FI_DESIGNATIONS,
  FI_REGULATORY_BODIES,
} = require('../utils/constants');
const {
  businessNameField,
  personNameField,
  requiredChoiceField,
  optionalChoiceField,
  mobileField,
  tinField,
  emailField,
  newPasswordField,
  confirmPasswordField,
  optionalIdField,
} = require('./common');

// Today's date as "YYYY-MM-DD"
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Step 1: Institution Information (ALL mandatory) ----------
// Fields shared by "register" and "edit Step 1" (everything except the password)
const institutionInformation = [
  businessNameField('institutionName', 'Institution name'),
  tinField('registrationNumberTin', 'Institution Registration Number / TIN'),
  requiredChoiceField('institutionType', 'Institution type', FI_INSTITUTION_TYPES),
  requiredChoiceField('productType', 'Product type offered', FI_PRODUCT_TYPES),
  personNameField('contactFirstName', 'Contact person first name'),
  personNameField('contactLastName', 'Contact person last name'),
  requiredChoiceField('designation', 'Designation / Role', FI_DESIGNATIONS),
  mobileField('mobile'),
  emailField('email'),
];

// POST /fis/register
const register = [
  ...institutionInformation,
  newPasswordField('password'),
  confirmPasswordField('confirmPassword', 'password'),
];

// PUT /fis/register  (Step 1 again, after pressing "Back")
const update = [...institutionInformation];

// ---------- Step 2: Regulatory Details & Coverage (ALL optional) ----------
const regulatoryDetails = [
  body('institutionAddress')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Institution address must be 5-255 characters'),

  optionalIdField('regionId', 'Region'),
  optionalIdField('inkhundlaId', 'Inkhundla'),
  optionalIdField('umphakatsiId', 'Umphakatsi'),

  optionalChoiceField('regulatoryBody', 'Regulatory body', FI_REGULATORY_BODIES),

  // Required when regulatoryBody is "other" (checked in fi.service.js,
  // because it may already be saved from an earlier request)
  body('regulatoryBodyOther')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage('Regulatory body name must be 2-150 characters'),

  body('regulatoryLicenseNumber')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Regulatory license number must be 3-50 characters')
    .bail()
    .matches(/^[A-Za-z0-9/-]+$/)
    .withMessage('Regulatory license number can only contain letters, numbers, "-" and "/"')
    .customSanitizer((v) => v.toUpperCase()),

  body('licenseExpiryDate')
    .optional({ values: 'falsy' })
    .trim()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('License expiry date must be a valid date in YYYY-MM-DD format')
    .bail()
    .customSanitizer((v) => v.slice(0, 10))
    .custom((value) => {
      if (value < today()) throw new Error('Your regulatory license has expired');
      return true;
    }),

  body('yearsInOperation')
    .optional({ values: 'null' })
    .isInt({ min: 0, max: 200 })
    .withMessage('Years in operation must be a whole number between 0 and 200')
    .toInt(),

  // Regions served, e.g. [1, 2]. Send [] to clear. Leave out to keep the saved list.
  body('coverageRegionIds')
    .optional({ values: 'null' })
    .isArray({ max: 20 })
    .withMessage('Regions served must be a list of region ids'),
  body('coverageRegionIds.*')
    .isInt({ min: 1 })
    .withMessage('Each region served must be a valid region id')
    .toInt(),
];

module.exports = { register, update, regulatoryDetails };
