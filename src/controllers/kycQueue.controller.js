// ADMIN KYC Approval Queue endpoints.
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/kycQueue.service');

// GET /admin/kyc-queue/stats
const stats = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.stats() });
});

// GET /admin/kyc-queue
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.validated) });
});

// GET /admin/kyc-queue/documents
const listDocuments = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listDocuments(req.validated) });
});

module.exports = { stats, list, listDocuments };
