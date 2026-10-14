// SHARED login / password reset rules for EVERY user type (Figma "Login" screen).
// accountType is required everywhere: the same email can have one account per user type.
const { body } = require('express-validator');
const {
  accountTypeField,
  emailField,
  newPasswordField,
  confirmPasswordField,
  otpField,
} = require('./common');

// POST /auth/login
const login = [
  accountTypeField('accountType'),

  body('identifier')
    .trim()
    .notEmpty()
    .withMessage('Email ID or TIN is required')
    .bail()
    .isLength({ max: 150 })
    .withMessage('Email ID or TIN is too long'),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .bail()
    .isString()
    .withMessage('Password must be text'),

  body('rememberMe')
    .optional({ values: 'null' })
    .isBoolean({ strict: false })
    .withMessage('Remember me must be true or false')
    .toBoolean(true),
];

// POST /auth/forgot-password
const forgotPassword = [accountTypeField('accountType'), emailField('email')];

// POST /auth/reset-password
const resetPassword = [
  accountTypeField('accountType'),
  emailField('email'),
  otpField('otp'),
  newPasswordField('newPassword', 'New password'),
  confirmPasswordField('confirmPassword', 'newPassword'),
];

module.exports = { login, forgotPassword, resetPassword };
