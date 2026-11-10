// GET /me/verification: Verified badge status, KYC progress, listing limit and the dashboard banner.
const asyncHandler = require('../utils/asyncHandler');
const verification = require('../services/verification.service');

const mine = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await verification.status(req.user) });
});

module.exports = { mine };
