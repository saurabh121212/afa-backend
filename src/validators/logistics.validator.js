// LOGISTICS-PROVIDER-ONLY validation rules
// (Figma "Logistics Provider Registration" Step 1 and Step 2).
// Shared Account Security rules are in registration.validator.js.
const { body } = require('express-validator');
const { BUSINESS_TYPES, LOGISTICS_SERVICE_TYPES, LOGISTICS_DESIGNATIONS } = require('../utils/constants');
const {
  businessNameField,
  personNameField,
  requiredChoiceField,
  mobileField,
  tinField,
  emailField,
  newPasswordField,
  confirmPasswordField,
  optionalIdField,
} = require('./common');

// ---------- Step 1: Business Information (ALL mandatory) ----------
// Fields shared by "register" and "edit Step 1" (everything except the password)
const businessInformation = [
  businessNameField('businessName', 'Business name'),
  tinField('registrationNumberTin', 'Business Registration Number / TIN'),
  requiredChoiceField('businessType', 'Business type', BUSINESS_TYPES),
  requiredChoiceField('serviceType', 'Service type', LOGISTICS_SERVICE_TYPES),
  personNameField('contactFirstName', 'Contact person first name'),
  personNameField('contactLastName', 'Contact person last name'),
  requiredChoiceField('designation', 'Designation / Role', LOGISTICS_DESIGNATIONS),
  mobileField('mobile'),
  emailField('email'),
];

// POST /logistics/register
const register = [
  ...businessInformation,
  newPasswordField('password'),
  confirmPasswordField('confirmPassword', 'password'),
];

// PUT /logistics/register  (Step 1 again, after pressing "Back")
const update = [...businessInformation];

// ---------- Step 2: Service Details & Coverage Area (ALL optional) ----------
const businessLocation = [
  body('businessAddress')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Business address must be 5-255 characters'),

  optionalIdField('regionId', 'Region'),
  optionalIdField('inkhundlaId', 'Inkhundla'),
  optionalIdField('umphakatsiId', 'Umphakatsi'),

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

module.exports = { register, update, businessLocation };
