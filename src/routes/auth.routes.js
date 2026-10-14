// SHARED login routes for EVERY user type, mounted at /api/v1/auth
// The user type comes from "accountType" in the login body (Figma Account Type dropdown).
//
//   POST /auth/login             login (email or TIN)
//   POST /auth/forgot-password   email a reset code
//   POST /auth/reset-password    set a new password with the code
//   GET  /auth/me                logged-in user + their own profile
const express = require('express');
const authController = require('../controllers/auth.controller');
const authRules = require('../validators/auth.validator');
const validate = require('../middlewares/validate');
const { protectUser } = require('../middlewares/userAuth');
const { loginLimiter, otpLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, authRules.login, validate, authController.login);
router.post('/forgot-password', otpLimiter, authRules.forgotPassword, validate, authController.forgotPassword);
router.post('/reset-password', otpLimiter, authRules.resetPassword, validate, authController.resetPassword);
router.get('/me', protectUser, authController.me);

module.exports = router;
