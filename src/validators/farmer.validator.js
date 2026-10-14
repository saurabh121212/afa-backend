// FARMER-ONLY validation rules (Figma "Farmer Registration" Step 1 and Step 2).
// Shared Step 4 rules are in registration.validator.js.
const { body } = require('express-validator');
const {
  GENDERS,
  LAND_OWNERSHIP_TYPES,
  FARMING_ACTIVITIES,
  FARMING_SEASONS,
} = require('../utils/constants');
const {
  NAME_RULE,
  normalizeEswatiniMobile,
  emailField,
  newPasswordField,
  confirmPasswordField,
  optionalIdField,
  requiredIdField,
} = require('./common');

const nameField = (field, label, { required }) => {
  const chain = required
    ? body(field).trim().notEmpty().withMessage(`${label} is required`).bail()
    : body(field).optional({ values: 'falsy' }).trim();
  return chain
    .isLength({ max: 60 })
    .withMessage(`${label} must be at most 60 characters`)
    .bail()
    .matches(NAME_RULE)
    .withMessage(`${label} can only contain letters, spaces, apostrophes and hyphens`);
};

// ---------- Step 1: Personal Information (ALL mandatory except middle name) ----------
const register = [
  body('farmerIdTin')
    .trim()
    .notEmpty()
    .withMessage('Farmer ID / TIN is required')
    .bail()
    .isLength({ min: 3, max: 50 })
    .withMessage('Farmer ID / TIN must be 3-50 characters')
    .bail()
    .matches(/^[A-Za-z0-9/-]+$/)
    .withMessage('Farmer ID / TIN can only contain letters, numbers, "-" and "/"')
    .customSanitizer((v) => v.toUpperCase()),

  nameField('firstName', 'First name', { required: true }),
  nameField('middleName', 'Middle name', { required: false }),
  nameField('lastName', 'Last name', { required: true }),

  body('gender')
    .trim()
    .notEmpty()
    .withMessage('Gender is required')
    .bail()
    .toLowerCase()
    .isIn(GENDERS)
    .withMessage(`Gender must be one of: ${GENDERS.join(', ')}`),

  body('dateOfBirth')
    .trim()
    .notEmpty()
    .withMessage('Date of birth is required')
    .bail()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('Date of birth must be a valid date in YYYY-MM-DD format')
    .bail()
    .custom((value) => {
      const dob = new Date(`${value.slice(0, 10)}T00:00:00Z`);
      const today = new Date();
      if (dob > today) throw new Error('Date of birth cannot be in the future');
      if (dob.getUTCFullYear() < 1900) throw new Error('Date of birth is not valid');
      const eighteenth = new Date(Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate()));
      if (eighteenth > today) throw new Error('Farmer must be at least 18 years old');
      return true;
    })
    .customSanitizer((v) => v.slice(0, 10)),

  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required')
    .bail()
    .customSanitizer(normalizeEswatiniMobile)
    .matches(/^\+268[0-9]{8}$/)
    .withMessage('Enter a valid Eswatini mobile number, e.g. +268 7612 3456'),

  emailField('email'),

  body('residentAddress')
    .trim()
    .notEmpty()
    .withMessage('Resident address is required')
    .bail()
    .isLength({ min: 5, max: 255 })
    .withMessage('Resident address must be 5-255 characters'),

  requiredIdField('regionId', 'Region'),
  requiredIdField('inkhundlaId', 'Inkhundla'),
  requiredIdField('umphakatsiId', 'Umphakatsi'),

  newPasswordField('password'),
  confirmPasswordField('confirmPassword', 'password'),
];

// ---------- Step 2: Farm Information (ALL optional) ----------
const farmInformation = [
  body('farmName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 150 })
    .withMessage('Farm name must be at most 150 characters'),

  body('farmAddress')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 255 })
    .withMessage('Farm location / address must be at most 255 characters'),

  optionalIdField('farmRegionId', 'Farm region'),
  optionalIdField('farmInkhundlaId', 'Farm Inkhundla'),
  optionalIdField('farmUmphakatsiId', 'Farm Umphakatsi'),

  body('farmSizeHa')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0.01, max: 100000 })
    .withMessage('Total farm size must be a number between 0.01 and 100,000 hectares')
    .toFloat(),

  body('landOwnershipType')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(LAND_OWNERSHIP_TYPES)
    .withMessage(`Land ownership type must be one of: ${LAND_OWNERSHIP_TYPES.join(', ')}`),

  body('farmingActivity')
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(FARMING_ACTIVITIES)
    .withMessage(`Farming activity must be one of: ${FARMING_ACTIVITIES.join(', ')}`),

  body('mainCrops')
    .optional({ values: 'null' })
    .isArray({ max: 20 })
    .withMessage('Main crops must be a list of up to 20 crops'),
  body('mainCrops.*')
    .trim()
    .notEmpty()
    .withMessage('Crop name cannot be empty')
    .bail()
    .isLength({ max: 50 })
    .withMessage('Crop name must be at most 50 characters'),

  body('otherCrops')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 255 })
    .withMessage('Other crops must be at most 255 characters'),

  body('productionCapacityKg')
    .optional({ values: 'falsy' })
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

module.exports = { register, farmInformation };
