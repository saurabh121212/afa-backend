// FINANCIAL-INSTITUTION-ONLY endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const fiService = require('../services/fi.service');

// POST /fis/register  (Step 1 - Institution Information)
const register = asyncHandler(async (req, res) => {
  const data = await fiService.register(req.validated);
  res.status(201).json({
    success: true,
    message: 'Institution information saved. Continue to Regulatory Details & Coverage.',
    data,
  });
});

// PUT /fis/register  (Step 1 again, after "Back")
const update = asyncHandler(async (req, res) => {
  const data = await fiService.updateInstitutionInformation(req.user, req.validated);
  res.json({
    success: true,
    message: data.emailVerified
      ? 'Institution information updated.'
      : 'Institution information updated. Please verify your email address in Account Security.',
    data,
  });
});

// PUT /fis/register/regulatory-details  (Step 2 - optional)
const saveRegulatoryDetails = asyncHandler(async (req, res) => {
  const data = await fiService.saveRegulatoryDetails(req.user, req.validated);
  res.json({ success: true, message: 'Regulatory details & coverage saved.', data });
});

module.exports = { register, update, saveRegulatoryDetails };
