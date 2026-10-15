// The logged-in user's own profile and password. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/profile.service');

// GET /me/profile
const getProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getProfile(req.user.id) });
});

// PATCH /me/profile   (send only the fields to change)
const updateProfile = asyncHandler(async (req, res) => {
  const data = await service.updateProfile(req.user, req.validated, req.body);
  res.json({ success: true, message: 'Profile updated', data });
});

// PATCH /me/password
const changePassword = asyncHandler(async (req, res) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  const data = await service.changePassword(req.user.id, req.validated, token);
  res.json({
    success: true,
    message: 'Password changed. You have been logged out on your other devices. Use the new token from now on.',
    data,
  });
});

module.exports = { getProfile, updateProfile, changePassword };
