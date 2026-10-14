// BUYER-ONLY endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const buyerService = require('../services/buyer.service');

// POST /buyers/register  (Step 1 - Buyer Information)
const register = asyncHandler(async (req, res) => {
  const data = await buyerService.register(req.validated);
  res.status(201).json({
    success: true,
    message: 'Buyer information saved. Continue to KYC / Verification.',
    data,
  });
});

// PUT /buyers/register  (Step 1 again, after "Back")
const update = asyncHandler(async (req, res) => {
  const data = await buyerService.updateBuyerInformation(req.user, req.validated);
  const notes = [];
  if (data.removedDocuments.length) {
    notes.push('Business documents were removed because you switched to Individual Buyer.');
  }
  if (!data.emailVerified) notes.push('Please verify your email address in Account Security.');
  res.json({
    success: true,
    message: ['Buyer information updated.', ...notes].join(' '),
    data,
  });
});

module.exports = { register, update };
