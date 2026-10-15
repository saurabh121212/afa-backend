// ADMIN Listings Management endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/adminListing.service');

const adminId = (req) => req.admin.id;

// GET /admin/listings/stats
const stats = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.stats() });
});

// GET /admin/listings
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.validated) });
});

// GET /admin/listings/export
const exportCsv = asyncHandler(async (req, res) => {
  const csv = await service.exportCsv(req.validated);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="afa-listings-${date}.csv"`);
  res.send(csv);
});

// GET /admin/listings/:id
const getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getById(req.validated.id) });
});

const action = (fn, message) =>
  asyncHandler(async (req, res) => {
    const data = await service[fn](req.validated.id, adminId(req), req.validated);
    res.json({ success: true, message, data });
  });

module.exports = {
  stats,
  list,
  exportCsv,
  getById,
  approve: action('approve', 'Listing approved. It is now visible on the marketplace.'),
  reject: action('reject', 'Listing rejected. The seller has been notified.'),
  flag: action('flag', 'Listing flagged and hidden. The seller has been notified.'),
  disable: action('disable', 'Listing disabled. The seller has been notified.'),
  enable: action('enable', 'Listing enabled. It is visible on the marketplace again.'),
};
