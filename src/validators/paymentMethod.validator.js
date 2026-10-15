// Validation for the user's bank & payment details (/me/payment-methods).
const { body, param } = require('express-validator');
const {
  PAYMENT_METHOD_TYPES,
  BANK_ACCOUNT_TYPES,
  MOBILE_MONEY_PROVIDERS,
} = require('../config/paymentMethods');
const { BUSINESS_NAME_RULE, normalizeEswatiniMobile } = require('./common');

const idParam = param('id').isInt({ min: 1 }).withMessage('Payment method id must be a positive number').toInt();

const isBank = body('methodType').equals('bank_account');
const isMobile = body('methodType').equals('mobile_money');

// "Thabo Sipho Dlamini", "Sunrise Farm (Pty) Ltd"
const holderName = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Account holder name is required')
    .bail()
    .isLength({ min: 2, max: 150 })
    .withMessage('Account holder name must be 2-150 characters')
    .bail()
    .matches(BUSINESS_NAME_RULE)
    .withMessage("Account holder name can only contain letters, numbers, spaces and & . , ' ( ) / -");

const bankName = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Bank name is required')
    .bail()
    .isLength({ min: 2, max: 100 })
    .withMessage('Bank name must be 2-100 characters')
    .bail()
    .matches(BUSINESS_NAME_RULE)
    .withMessage("Bank name can only contain letters, numbers, spaces and & . , ' ( ) / -");

// Digits only (spaces and "-" are removed), 5-20 digits
const accountNumber = (chain) =>
  chain
    .customSanitizer((v) => String(v == null ? '' : v).replace(/[\s-]/g, ''))
    .notEmpty()
    .withMessage('Account number is required')
    .bail()
    .matches(/^\d{5,20}$/)
    .withMessage('Account number must be 5-20 digits');

const accountType = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Account type is required')
    .bail()
    .toLowerCase()
    .isIn(BANK_ACCOUNT_TYPES)
    .withMessage(`Account type must be one of: ${BANK_ACCOUNT_TYPES.join(', ')}`);

const branchCode = () =>
  body('branchCode')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\d{3,10}$/)
    .withMessage('Branch code must be 3-10 digits');

const provider = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Mobile money provider is required')
    .bail()
    .toLowerCase()
    .isIn(MOBILE_MONEY_PROVIDERS)
    .withMessage(`Provider must be one of: ${MOBILE_MONEY_PROVIDERS.join(', ')}`);

const mobileNumber = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('Mobile money number is required')
    .bail()
    .customSanitizer(normalizeEswatiniMobile)
    .matches(/^\+268[0-9]{8}$/)
    .withMessage('Enter a valid Eswatini mobile number, e.g. +268 7612 3456');

const makePrimary = body('makePrimary')
  .optional({ values: 'null' })
  .isBoolean({ strict: false })
  .withMessage('makePrimary must be true or false')
  .toBoolean(true);

// POST /me/payment-methods
const create = [
  body('methodType')
    .trim()
    .notEmpty()
    .withMessage('Payment type is required')
    .bail()
    .toLowerCase()
    .isIn(PAYMENT_METHOD_TYPES)
    .withMessage(`Payment type must be one of: ${PAYMENT_METHOD_TYPES.join(', ')}`),
  holderName(body('accountHolderName')),
  // Bank account
  bankName(body('bankName').if(isBank)),
  accountNumber(body('accountNumber').if(isBank)),
  accountType(body('accountType').if(isBank)),
  branchCode(),
  // Mobile money
  provider(body('provider').if(isMobile)),
  mobileNumber(body('mobileNumber').if(isMobile)),
  makePrimary,
];

// PUT /me/payment-methods/:id   (send only what changes)
const update = [
  idParam,
  body('methodType').optional({ values: 'falsy' }).trim().toLowerCase(),
  holderName(body('accountHolderName').optional()),
  bankName(body('bankName').optional()),
  accountNumber(body('accountNumber').optional()),
  accountType(body('accountType').optional()),
  branchCode(),
  provider(body('provider').optional()),
  mobileNumber(body('mobileNumber').optional()),
  makePrimary,
  body().custom((value) => {
    const fields = ['accountHolderName', 'bankName', 'accountNumber', 'accountType', 'branchCode', 'provider', 'mobileNumber', 'makePrimary'];
    if (!value || !fields.some((f) => value[f] !== undefined)) {
      throw new Error(`Send at least one of: ${fields.join(', ')}`);
    }
    return true;
  }),
];

const byId = [idParam];

module.exports = { create, update, byId };
