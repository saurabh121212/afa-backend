// SHARED registration routes for EVERY user type, mounted at /api/v1/register
//
// The user type is known from the registrationToken (it holds the user id and userType),
// so these routes work the same for farmer, buyer, trader, logistics and FI.
//
//   POST /register/resume       continue an unfinished registration (public)
//   GET  /register/progress     saved data, to pre-fill the form
//   POST /register/send-otp     Step 4 - email the 6-digit code
//   POST /register/verify-otp   Step 4 - check the code
//   POST /register/submit       Step 4 - accept terms, send to admin
const express = require('express');
const registrationController = require('../controllers/registration.controller');
const registrationRules = require('../validators/registration.validator');
const validate = require('../middlewares/validate');
const { protectRegistration } = require('../middlewares/userAuth');
const { otpLimiter, loginLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/resume', loginLimiter, registrationRules.resume, validate, registrationController.resume);

// ---- Everything below needs the registrationToken ----
router.get('/progress', protectRegistration, registrationController.getProgress);

router.post('/send-otp', protectRegistration, otpLimiter, registrationController.sendOtp);

router.post(
  '/verify-otp',
  protectRegistration,
  otpLimiter,
  registrationRules.verifyOtp,
  validate,
  registrationController.verifyOtp
);

router.post(
  '/submit',
  protectRegistration,
  registrationRules.submit,
  validate,
  registrationController.submit
);

module.exports = router;
