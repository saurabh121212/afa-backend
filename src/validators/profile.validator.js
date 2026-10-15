// Validation for the logged-in user's own profile (GET / PATCH /me/profile, PATCH /me/password).
//
// PATCH /me/profile: send ONLY the fields to change. Each user type has its own fields.
//   - Required fields (e.g. first name) can be changed but not emptied.
//   - Optional fields can be emptied by sending null or "" (the service clears them).
//   - Email, TIN / registration number and buyer type can't be changed (checked in profile.service.js).
const { body } = require('express-validator');
const {
  GENDERS,
  LAND_OWNERSHIP_TYPES,
  FARMING_ACTIVITIES,
  FARMING_SEASONS,
  BUSINESS_TYPES,
  DESIGNATIONS,
  LICENSE_ISSUING_AUTHORITIES,
  TRADER_BUSINESS_CATEGORIES,
  LOGISTICS_SERVICE_TYPES,
  LOGISTICS_DESIGNATIONS,
  FI_INSTITUTION_TYPES,
  FI_PRODUCT_TYPES,
  FI_DESIGNATIONS,
  FI_REGULATORY_BODIES,
} = require('../utils/constants');
const {
  NAME_RULE,
  BUSINESS_NAME_RULE,
  normalizeEswatiniMobile,
  newPasswordField,
} = require('./common');
const validate = require('../middlewares/validate');
const ApiError = require('../utils/ApiError');

const today = () => new Date().toISOString().slice(0, 10);

// ---------- field builders (each call returns a NEW chain) ----------

// Required field: may be left out, but not emptied
const requiredText = (field, label, { min = 1, max }) =>
  body(field)
    .optional()
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(`${label} cannot be empty`)
    .bail()
    .isLength({ min, max })
    .withMessage(`${label} must be ${min}-${max} characters`);

// Optional field: null / "" clears it
const optionalText = (field, label, { min = 1, max }) =>
  body(field)
    .optional({ values: 'falsy' })
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .isLength({ min, max })
    .withMessage(`${label} must be ${min}-${max} characters`);

const personName = (field, label, { required = true } = {}) =>
  (required ? requiredText(field, label, { max: 60 }) : optionalText(field, label, { max: 60 }))
    .bail()
    .matches(NAME_RULE)
    .withMessage(`${label} can only contain letters, spaces, apostrophes and hyphens`);

const businessName = (field, label) =>
  requiredText(field, label, { min: 2, max: 150 })
    .bail()
    .matches(BUSINESS_NAME_RULE)
    .withMessage(`${label} can only contain letters, numbers, spaces and & . , ' ( ) / -`);

const requiredChoice = (field, label, choices) =>
  body(field)
    .optional()
    .trim()
    .notEmpty()
    .withMessage(`${label} cannot be empty`)
    .bail()
    .toLowerCase()
    .isIn(choices)
    .withMessage(`${label} must be one of: ${choices.join(', ')}`);

const optionalChoice = (field, label, choices) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(choices)
    .withMessage(`${label} must be one of: ${choices.join(', ')}`);

const requiredId = (field, label) =>
  body(field).optional().isInt({ min: 1 }).withMessage(`${label} is not valid`).toInt();

const optionalId = (field, label) =>
  body(field).optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage(`${label} is not valid`).toInt();

const licenseNumber = (field, label) =>
  optionalText(field, label, { min: 3, max: 50 })
    .bail()
    .matches(/^[A-Za-z0-9/-]+$/)
    .withMessage(`${label} can only contain letters, numbers, "-" and "/"`)
    .customSanitizer((v) => v.toUpperCase());

const futureDate = (field, label, expiredMessage) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage(`${label} must be a valid date in YYYY-MM-DD format`)
    .bail()
    .customSanitizer((v) => v.slice(0, 10))
    .custom((value) => {
      if (value < today()) throw new Error(expiredMessage);
      return true;
    });

const yearsInOperation = (max) =>
  body('yearsInOperation')
    .optional({ values: 'null' })
    .isInt({ min: 0, max })
    .withMessage(`Years in operation must be a whole number between 0 and ${max}`)
    .toInt();

const coverageRegions = () => [
  body('coverageRegionIds')
    .optional({ values: 'null' })
    .isArray({ max: 20 })
    .withMessage('Regions served must be a list of region ids'),
  body('coverageRegionIds.*').isInt({ min: 1 }).withMessage('Each region served must be a valid region id').toInt(),
];

// Every user type: mobile number (unique within the user type, checked in the service)
const mobile = body('mobile')
  .optional()
  .trim()
  .notEmpty()
  .withMessage('Mobile number cannot be empty')
  .bail()
  .customSanitizer(normalizeEswatiniMobile)
  .matches(/^\+268[0-9]{8}$/)
  .withMessage('Enter a valid Eswatini mobile number, e.g. +268 7612 3456');

// ---------- per user type ----------
const farmer = [
  mobile,
  personName('firstName', 'First name'),
  personName('middleName', 'Middle name', { required: false }),
  personName('lastName', 'Last name'),
  requiredChoice('gender', 'Gender', GENDERS),
  body('dateOfBirth')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Date of birth cannot be empty')
    .bail()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('Date of birth must be a valid date in YYYY-MM-DD format')
    .bail()
    .custom((value) => {
      const dob = new Date(`${value.slice(0, 10)}T00:00:00Z`);
      const now = new Date();
      if (dob > now) throw new Error('Date of birth cannot be in the future');
      if (dob.getUTCFullYear() < 1900) throw new Error('Date of birth is not valid');
      const eighteenth = new Date(Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate()));
      if (eighteenth > now) throw new Error('Farmer must be at least 18 years old');
      return true;
    })
    .customSanitizer((v) => v.slice(0, 10)),
  requiredText('residentAddress', 'Resident address', { min: 5, max: 255 }),
  requiredId('regionId', 'Region'),
  requiredId('inkhundlaId', 'Inkhundla'),
  requiredId('umphakatsiId', 'Umphakatsi'),

  // Farm information (all optional)
  optionalText('farmName', 'Farm name', { max: 150 }),
  optionalText('farmAddress', 'Farm location / address', { max: 255 }),
  optionalId('farmRegionId', 'Farm region'),
  optionalId('farmInkhundlaId', 'Farm Inkhundla'),
  optionalId('farmUmphakatsiId', 'Farm Umphakatsi'),
  body('farmSizeHa')
    .optional({ values: 'null' })
    .isFloat({ min: 0.01, max: 100000 })
    .withMessage('Total farm size must be a number between 0.01 and 100,000 hectares')
    .toFloat(),
  optionalChoice('landOwnershipType', 'Land ownership type', LAND_OWNERSHIP_TYPES),
  optionalChoice('farmingActivity', 'Farming activity', FARMING_ACTIVITIES),
  body('mainCrops').optional({ values: 'null' }).isArray({ max: 20 }).withMessage('Main crops must be a list of up to 20 crops'),
  body('mainCrops.*')
    .trim()
    .notEmpty()
    .withMessage('Crop name cannot be empty')
    .bail()
    .isLength({ max: 50 })
    .withMessage('Crop name must be at most 50 characters'),
  optionalText('otherCrops', 'Other crops', { max: 255 }),
  body('productionCapacityKg')
    .optional({ values: 'null' })
    .isFloat({ min: 0, max: 1000000000 })
    .withMessage('Typical production capacity must be a positive number (kg per year)')
    .toFloat(),
  body('farmingSeasons')
    .optional({ values: 'null' })
    .isArray({ max: FARMING_SEASONS.length })
    .withMessage('Farming season(s) must be a list'),
  body('farmingSeasons.*')
    .trim()
    .toLowerCase()
    .isIn(FARMING_SEASONS)
    .withMessage(`Farming season must be one of: ${FARMING_SEASONS.join(', ')}`),
];

const buyer = [
  mobile,
  requiredText('name', 'Full name / business name', { min: 2, max: 150 })
    .bail()
    .matches(BUSINESS_NAME_RULE)
    .withMessage("Name can only contain letters, numbers, spaces and & . , ' ( ) / -"),
  requiredText('deliveryAddress', 'Delivery address', { min: 5, max: 255 }),
  requiredId('regionId', 'Region'),
  requiredId('inkhundlaId', 'Inkhundla'),
  requiredId('umphakatsiId', 'Umphakatsi'),
  body('orderPriceAlerts')
    .optional({ values: 'null' })
    .isBoolean({ strict: false })
    .withMessage('Order & price alerts must be true or false')
    .toBoolean(true),
];

const contactPerson = (designations) => [
  personName('contactFirstName', 'Contact person first name'),
  personName('contactLastName', 'Contact person last name'),
  requiredChoice('designation', 'Designation / Role', designations),
];

const businessLocation = (addressField, addressLabel) => [
  optionalText(addressField, addressLabel, { min: 5, max: 255 }),
  optionalId('regionId', 'Region'),
  optionalId('inkhundlaId', 'Inkhundla'),
  optionalId('umphakatsiId', 'Umphakatsi'),
];

const trader = [
  mobile,
  businessName('businessName', 'Business name'),
  requiredChoice('businessType', 'Business type', BUSINESS_TYPES),
  requiredChoice('businessCategory', 'Business category', TRADER_BUSINESS_CATEGORIES),
  ...contactPerson(DESIGNATIONS),
  ...businessLocation('businessAddress', 'Business address'),
  licenseNumber('tradingLicenseNumber', 'Trading license number'),
  optionalChoice('licenseIssuingAuthority', 'License issuing authority', LICENSE_ISSUING_AUTHORITIES),
  futureDate('licenseExpiryDate', 'License expiry date', 'Your trading license has expired'),
  yearsInOperation(100),
  optionalText('website', 'Business website / social media', { min: 3, max: 255 }),
];

const logistics = [
  mobile,
  businessName('businessName', 'Business name'),
  requiredChoice('businessType', 'Business type', BUSINESS_TYPES),
  requiredChoice('serviceType', 'Service type', LOGISTICS_SERVICE_TYPES),
  ...contactPerson(LOGISTICS_DESIGNATIONS),
  ...businessLocation('businessAddress', 'Business address'),
  ...coverageRegions(),
];

const financialInstitution = [
  mobile,
  businessName('institutionName', 'Institution name'),
  requiredChoice('institutionType', 'Institution type', FI_INSTITUTION_TYPES),
  requiredChoice('productType', 'Product type offered', FI_PRODUCT_TYPES),
  ...contactPerson(FI_DESIGNATIONS),
  ...businessLocation('institutionAddress', 'Institution address'),
  optionalChoice('regulatoryBody', 'Regulatory body', FI_REGULATORY_BODIES),
  optionalText('regulatoryBodyOther', 'Regulatory body name', { min: 2, max: 150 }),
  licenseNumber('regulatoryLicenseNumber', 'Regulatory license number'),
  futureDate('licenseExpiryDate', 'License expiry date', 'Your regulatory license has expired'),
  yearsInOperation(200),
  ...coverageRegions(),
];

const RULES_BY_TYPE = {
  farmer,
  buyer,
  trader,
  logistics,
  financial_institution: financialInstitution,
};

// PATCH /me/profile -> runs the rules of the logged-in user's type, then the usual "validate"
async function updateProfile(req, res, next) {
  try {
    const rules = RULES_BY_TYPE[req.user.userType];
    if (!rules) throw new ApiError(400, 'Profile editing is not available for this account', { code: 'NOT_SUPPORTED' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.keys(req.body).length) {
      throw new ApiError(422, 'Send at least one field to update', { code: 'NOTHING_TO_UPDATE' });
    }
    await Promise.all(rules.map((rule) => rule.run(req)));
    return validate(req, res, next);
  } catch (err) {
    return next(err);
  }
}

// PATCH /me/password
const changePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required')
    .bail()
    .isString()
    .withMessage('Current password must be text'),
  newPasswordField('newPassword', 'New password'),
  body('confirmPassword')
    .notEmpty()
    .withMessage('Please confirm your new password')
    .bail()
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('Passwords do not match'),
];

module.exports = { updateProfile, changePassword, RULES_BY_TYPE };
