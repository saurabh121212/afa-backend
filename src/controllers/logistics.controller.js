// LOGISTICS-PROVIDER-ONLY endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const logisticsService = require('../services/logistics.service');

// POST /logistics/register  (Step 1 - Business Information)
const register = asyncHandler(async (req, res) => {
  const data = await logisticsService.register(req.validated);
  res.status(201).json({
    success: true,
    message: 'Business information saved. Continue to Service Details & Coverage Area.',
    data,
  });
});

// PUT /logistics/register  (Step 1 again, after "Back")
const update = asyncHandler(async (req, res) => {
  const data = await logisticsService.updateBusinessInformation(req.user, req.validated);
  res.json({
    success: true,
    message: data.emailVerified
      ? 'Business information updated.'
      : 'Business information updated. Please verify your email address in Account Security.',
    data,
  });
});

// PUT /logistics/register/business-location  (Step 2 - optional)
const saveBusinessLocation = asyncHandler(async (req, res) => {
  const data = await logisticsService.saveBusinessLocation(req.user, req.validated);
  res.json({ success: true, message: 'Service details & coverage area saved.', data });
});

module.exports = { register, update, saveBusinessLocation };
