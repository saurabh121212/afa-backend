// TRADER-ONLY endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const traderService = require('../services/trader.service');

// POST /traders/register  (Step 1 - Business Information)
const register = asyncHandler(async (req, res) => {
  const data = await traderService.register(req.validated);
  res.status(201).json({
    success: true,
    message: 'Business information saved. Continue to Business Address & License.',
    data,
  });
});

// PUT /traders/register  (Step 1 again, after "Back")
const update = asyncHandler(async (req, res) => {
  const data = await traderService.updateBusinessInformation(req.user, req.validated);
  res.json({
    success: true,
    message: data.emailVerified
      ? 'Business information updated.'
      : 'Business information updated. Please verify your email address in Account Security.',
    data,
  });
});

// PUT /traders/register/address-license  (Step 2 - optional)
const saveAddressAndLicense = asyncHandler(async (req, res) => {
  const data = await traderService.saveAddressAndLicense(req.user, req.validated);
  res.json({ success: true, message: 'Business address & license saved.', data });
});

module.exports = { register, update, saveAddressAndLicense };
