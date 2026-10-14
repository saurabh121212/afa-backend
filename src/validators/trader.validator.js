// TRADER-ONLY validation rules (Figma "Trader Registration" Step 1 and Step 2).
// Shared Account Security rules are in registration.validator.js.
const { body } = require('express-validator');
const {
  BUSINESS_TYPES,
  DESIGNATIONS,
  LICENSE_ISSUING_AUTHORITIES,
  TRADER_BUSINESS_CATEGORIES,
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

// ---------- Step 1: Business Information (ALL mandatory) ----------
// Fields shared by "register" and "edit Step 1" (everything except the password)
const businessInformation = [
  businessNameField('businessName', 'Business name'),
  tinField('registrationNumberTin', 'Business Registration Number / TIN'),
  requiredChoiceField('businessType', 'Business type', BUSINESS_TYPES),
  requiredChoiceField('businessCategory', 'Business category', TRADER_BUSINESS_CATEGORIES),
  personNameField('contactFirstName', 'Contact person first name'),
  personNameField('contactLastName', 'Contact person last name'),
  requiredChoiceField('designation', 'Designation / Role', DESIGNATIONS),
  mobileField('mobile'),
  emailField('email'),
];

// POST /traders/register
const register = [
  ...businessInformation,
  newPasswordField('password'),
  confirmPasswordField('confirmPassword', 'password'),
];

// PUT /traders/register  (Step 1 again, after pressing "Back")
const update = [...businessInformation];

// ---------- Step 2: Business Address & License (ALL optional) ----------
const addressAndLicense = [
  body('businessAddress')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Business address must be 5-255 characters'),

  optionalIdField('regionId', 'Region'),
  optionalIdField('inkhundlaId', 'Inkhundla'),
  optionalIdField('umphakatsiId', 'Umphakatsi'),

  body('tradingLicenseNumber')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Trading license number must be 3-50 characters')
    .bail()
    .matches(/^[A-Za-z0-9/-]+$/)
    .withMessage('Trading license number can only contain letters, numbers, "-" and "/"')
    .customSanitizer((v) => v.toUpperCase()),

  optionalChoiceField('licenseIssuingAuthority', 'License issuing authority', LICENSE_ISSUING_AUTHORITIES),

  body('licenseExpiryDate')
    .optional({ values: 'falsy' })
    .trim()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('License expiry date must be a valid date in YYYY-MM-DD format')
    .bail()
    .customSanitizer((v) => v.slice(0, 10))
    .custom((value) => {
      if (value < today()) throw new Error('Your trading license has expired');
      return true;
    }),

  body('yearsInOperation')
    .optional({ values: 'null' })
    .isInt({ min: 0, max: 100 })
    .withMessage('Years in operation must be a whole number between 0 and 100')
    .toInt(),

  body('website')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage('Business website / social media must be 3-255 characters'),
];

module.exports = { register, update, addressAndLicense };
