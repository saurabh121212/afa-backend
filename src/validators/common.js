// Rules shared by several validators.
const { body } = require('express-validator');
const { USER_TYPES } = require('../utils/constants');

// Which account (farmer, buyer, ...). Needed wherever a user is found by email,
// because the same email can have one account per user type.
const accountTypeField = (field = 'accountType') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('Account type is required')
    .bail()
    .toLowerCase()
    .isIn(USER_TYPES)
    .withMessage(`Account type must be one of: ${USER_TYPES.join(', ')}`);

// At least 8 chars (max 64), with uppercase, lowercase, a number and a symbol.
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/;
const PASSWORD_MESSAGE =
  'Password must be 8-64 characters and include an uppercase letter, a lowercase letter, a number and a symbol';

// Letters (any language), spaces, apostrophes, dots and hyphens.
const NAME_RULE = /^[\p{L}][\p{L}\s'.-]*$/u;

// Accepts "+268 7612 3456", "26876123456", "76123456" -> stores "+26876123456"
function normalizeEswatiniMobile(value) {
  let v = String(value || '').replace(/[\s()-]/g, '');
  if (/^268\d{8}$/.test(v)) v = `+${v}`;
  if (/^\d{8}$/.test(v)) v = `+268${v}`;
  return v;
}

// Business / company names: letters, numbers, spaces and & . , ' ( ) / -
const BUSINESS_NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}\s&.,'()/-]*$/u;

const businessNameField = (field, label) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ min: 2, max: 150 })
    .withMessage(`${label} must be 2-150 characters`)
    .bail()
    .matches(BUSINESS_NAME_RULE)
    .withMessage(`${label} can only contain letters, numbers, spaces and & . , ' ( ) / -`);

// A person's first / last name (required)
const personNameField = (field, label) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ max: 60 })
    .withMessage(`${label} must be at most 60 characters`)
    .bail()
    .matches(NAME_RULE)
    .withMessage(`${label} can only contain letters, spaces, apostrophes and hyphens`);

// A required choice from a fixed list (stored in lower case)
const requiredChoiceField = (field, label, choices) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .toLowerCase()
    .isIn(choices)
    .withMessage(`${label} must be one of: ${choices.join(', ')}`);

// An optional choice from a fixed list
const optionalChoiceField = (field, label, choices) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .toLowerCase()
    .isIn(choices)
    .withMessage(`${label} must be one of: ${choices.join(', ')}`);

// Eswatini mobile number, saved as "+268XXXXXXXX"
const mobileField = (field = 'mobile') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required')
    .bail()
    .customSanitizer(normalizeEswatiniMobile)
    .matches(/^\+268[0-9]{8}$/)
    .withMessage('Enter a valid Eswatini mobile number, e.g. +268 7612 3456');

// ID number / TIN: letters, numbers, "-" and "/", saved in UPPER CASE
const tinField = (field, label) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ min: 3, max: 50 })
    .withMessage(`${label} must be 3-50 characters`)
    .bail()
    .matches(/^[A-Za-z0-9/-]+$/)
    .withMessage(`${label} can only contain letters, numbers, "-" and "/"`)
    .customSanitizer((v) => v.toUpperCase());

const emailField = (field = 'email') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('Email address is required')
    .bail()
    .isLength({ max: 150 })
    .withMessage('Email address is too long')
    .bail()
    .isEmail()
    .withMessage('Enter a valid email address')
    .bail()
    .customSanitizer((v) => v.toLowerCase());

const newPasswordField = (field = 'password', label = 'Password') =>
  body(field)
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .matches(PASSWORD_RULE)
    .withMessage(PASSWORD_MESSAGE);

const confirmPasswordField = (field = 'confirmPassword', matchField = 'password') =>
  body(field)
    .notEmpty()
    .withMessage('Please confirm your password')
    .bail()
    .custom((value, { req }) => value === req.body[matchField])
    .withMessage('Passwords do not match');

const otpField = (field = 'otp') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('Verification code is required')
    .bail()
    .matches(/^\d{6}$/)
    .withMessage('Verification code must be 6 digits');

// Optional location id: must be a positive whole number if sent
const optionalIdField = (field, label) =>
  body(field)
    .optional({ values: 'falsy' })
    .isInt({ min: 1 })
    .withMessage(`${label} is not valid`)
    .toInt();

const requiredIdField = (field, label) =>
  body(field)
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isInt({ min: 1 })
    .withMessage(`${label} is not valid`)
    .toInt();

module.exports = {
  accountTypeField,
  NAME_RULE,
  BUSINESS_NAME_RULE,
  businessNameField,
  personNameField,
  requiredChoiceField,
  optionalChoiceField,
  normalizeEswatiniMobile,
  mobileField,
  tinField,
  emailField,
  newPasswordField,
  confirmPasswordField,
  otpField,
  optionalIdField,
  requiredIdField,
};
