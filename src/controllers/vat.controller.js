// Seller VAT registration (/me/vat). No request body.
const asyncHandler = require('../utils/asyncHandler');
const vatService = require('../services/vat.service');

// GET /me/vat
const getMine = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await vatService.getMine(req.user) });
});

// POST /me/vat   "I am VAT-registered"
const apply = asyncHandler(async (req, res) => {
  const data = await vatService.apply(req.user);
  res.json({
    success: true,
    message: 'Thank you! Your VAT registration has been sent to the AFA team for review.',
    data,
  });
});

// DELETE /me/vat   "I am not VAT-registered"
const withdraw = asyncHandler(async (req, res) => {
  const data = await vatService.withdraw(req.user);
  res.json({
    success: true,
    message: 'You are no longer VAT-registered on AFA. You cannot list VAT-applicable items.',
    data,
  });
});

module.exports = { getMine, apply, withdraw };
