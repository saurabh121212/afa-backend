// SHARED login endpoints for EVERY user type. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');

// POST /auth/login
const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.validated);
  res.json({ success: true, message: 'Login successful', data });
});

// POST /auth/forgot-password
const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.validated);
  res.json({
    success: true,
    message: 'If this email is registered, a password reset code has been sent to it.',
  });
});

// POST /auth/reset-password
const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.validated);
  res.json({ success: true, message: 'Password reset successful. Please log in with your new password.' });
});

// GET /auth/me
const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  res.json({ success: true, data: { user } });
});

module.exports = { login, forgotPassword, resetPassword, me };
