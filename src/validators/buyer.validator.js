// BUYER-ONLY validation rules (Figma "Buyer Registration - Step 1 (Buyer Information)").
// Every Step 1 field is mandatory. Shared Account Security rules are in registration.validator.js.
const { body } = require('express-validator');
const { BUYER_TYPES } = require('../utils/constants');
const {
  mobileField,
  tinField,
  emailField,
  newPasswordField,
  confirmPasswordField,
  requiredIdField,
} = require('./common');

// Full name or business name: letters, numbers, spaces and & . , ' ( ) / -
const BUYER_NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}\s&.,'()/-]*$/u;

// Fields shared by "register" and "edit Step 1" (everything except the password)
const buyerInformation = [
  body('buyerType')
    .trim()
    .notEmpty()
    .withMessage('Please choose: Individual Buyer or Business / Food Processor')
    .bail()
    .toLowerCase()
    .isIn(BUYER_TYPES)
    .withMessage(`Buyer type must be one of: ${BUYER_TYPES.join(', ')}`),

  body('name')
    .trim()
    .notEmpty()
    .withMessage('Full name / business name is required')
    .bail()
    .isLength({ min: 2, max: 150 })
    .withMessage('Full name / business name must be 2-150 characters')
    .bail()
    .matches(BUYER_NAME_RULE)
    .withMessage('Name can only contain letters, numbers, spaces and & . , \' ( ) / -'),

  emailField('email'),
  mobileField('mobile'),
  tinField('idNumberTin', 'ID Number / Business TIN'),

  body('deliveryAddress')
    .trim()
    .notEmpty()
    .withMessage('Delivery address is required')
    .bail()
    .isLength({ min: 5, max: 255 })
    .withMessage('Delivery address must be 5-255 characters'),

  requiredIdField('regionId', 'Region'),
  requiredIdField('inkhundlaId', 'Inkhundla'),
  requiredIdField('umphakatsiId', 'Umphakatsi'),
];

// POST /buyers/register  (Step 1)
const register = [
  ...buyerInformation,
  newPasswordField('password'),
  confirmPasswordField('confirmPassword', 'password'),
];

// PUT /buyers/register  (Step 1 again, after pressing "Back")
const update = [...buyerInformation];

module.exports = { register, update };
