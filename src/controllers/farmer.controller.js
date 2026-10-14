// FARMER-ONLY endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const farmerService = require('../services/farmer.service');

// POST /farmers/register  (Step 1 - Personal Information)
const register = asyncHandler(async (req, res) => {
  const data = await farmerService.register(req.validated);
  res.status(201).json({
    success: true,
    message: 'Personal information saved. Continue to Farm Information.',
    data,
  });
});

// PUT /farmers/register/farm-information  (Step 2 - optional)
const saveFarmInformation = asyncHandler(async (req, res) => {
  const data = await farmerService.saveFarmInformation(req.user, req.validated);
  res.json({ success: true, message: 'Farm information saved.', data });
});

module.exports = { register, saveFarmInformation };
