// Handles the HTTP side of admin auth: read the request, call the service,
// send the response.
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const adminAuthService = require('../services/adminAuth.service');
const { jwt: jwtConfig } = require('../config');

// At least 8 chars, with an uppercase, a lowercase, a number and a symbol.
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// POST /api/v1/admin/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required');
  }

  const { token, admin } = await adminAuthService.login(email, password);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      token,
      tokenType: 'Bearer',
      expiresIn: jwtConfig.expiresIn,
      admin,
    },
  });
});

// GET /api/v1/admin/auth/me
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { admin: req.admin } });
});

// PATCH /api/v1/admin/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'currentPassword and newPassword are required');
  }
  if (!STRONG_PASSWORD.test(newPassword)) {
    throw new ApiError(
      400,
      'New password must be at least 8 characters and include uppercase, lowercase, a number and a symbol'
    );
  }
  if (currentPassword === newPassword) {
    throw new ApiError(400, 'New password must be different from the current one');
  }

  await adminAuthService.changePassword(req.admin.id, currentPassword, newPassword);
  res.json({ success: true, message: 'Password changed successfully' });
});

module.exports = { login, me, changePassword };
