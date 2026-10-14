// SHARED registration endpoints for EVERY user type. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const registrationService = require('../services/registration.service');

// GET /register/progress
const getProgress = asyncHandler(async (req, res) => {
  const data = await registrationService.getProgress(req.user.id);
  res.json({ success: true, data });
});

// POST /register/resume
const resume = asyncHandler(async (req, res) => {
  const data = await registrationService.resume(req.validated);
  res.json({ success: true, message: 'You can continue your registration.', data });
});

// POST /register/send-otp
const sendOtp = asyncHandler(async (req, res) => {
  const data = await registrationService.sendOtp(req.user);
  res.json({ success: true, message: `A 6-digit code has been sent to ${data.email}`, data });
});

// POST /register/verify-otp
const verifyOtp = asyncHandler(async (req, res) => {
  const data = await registrationService.verifyOtp(req.user, req.validated.otp);
  res.json({ success: true, message: 'Email verified', data });
});

// POST /register/submit
const submit = asyncHandler(async (req, res) => {
  const data = await registrationService.submit(req.user, req.validated);
  res.json({
    success: true,
    message: data.canLoginNow
      ? 'Account created. You can log in now. Your documents will be reviewed by the AFA admin before your first order ships.'
      : 'Registration submitted. You can log in once the AFA admin approves your account.',
    data,
  });
});

module.exports = { getProgress, resume, sendOtp, verifyOtp, submit };
