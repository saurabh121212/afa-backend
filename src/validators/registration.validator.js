// SHARED registration rules, the same for EVERY user type (Figma "Account Security" step).
const { body } = require('express-validator');
const { accountTypeField, emailField, otpField } = require('./common');

// POST /register/verify-otp
const verifyOtp = [otpField('otp')];

const mustBeTrue = (field, message) =>
  body(field)
    .exists({ values: 'null' })
    .withMessage(message)
    .bail()
    .isBoolean({ strict: false })
    .withMessage(message)
    .bail()
    .toBoolean(true)
    .custom((v) => v === true)
    .withMessage(message);

// POST /register/submit
const submit = [
  mustBeTrue('acceptTerms', 'You must agree to the AFA Terms & Conditions'),
  mustBeTrue('acceptPrivacy', 'You must agree to the AFA Privacy Policy'),
  mustBeTrue('confirmAccuracy', 'You must confirm that the information provided is true and accurate'),

  // Trader only (required for traders, checked in registration.service.js):
  // "I confirm that I am authorized to register and represent this business on AFA"
  body('confirmAuthorized')
    .optional({ values: 'null' })
    .isBoolean({ strict: false })
    .withMessage('confirmAuthorized must be true or false')
    .toBoolean(true),

  // Buyer only: "Order & Price Alerts" toggle (ignored for other user types)
  body('orderPriceAlerts')
    .optional({ values: 'null' })
    .isBoolean({ strict: false })
    .withMessage('Order & Price Alerts must be true or false')
    .toBoolean(true),
];

// POST /register/resume
// accountType is needed: the same email can have one account per user type
const resume = [
  accountTypeField('accountType'),
  emailField('email'),
  body('password').notEmpty().withMessage('Password is required'),
];

module.exports = { verifyOtp, submit, resume };
