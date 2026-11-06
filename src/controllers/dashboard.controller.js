// Dashboards: the logged-in user's (by user type) and the admin's. Input is already validated.
const asyncHandler = require('../utils/asyncHandler');
const userDashboard = require('../services/dashboard/userDashboard.service');
const adminDashboard = require('../services/dashboard/adminDashboard.service');

const v = (req) => req.validated;

// GET /me/dashboard
const mine = asyncHandler(async (req, res) => res.json({ success: true, data: await userDashboard.forUser(req.user, v(req)) }));

// GET /admin/dashboard
const admin = asyncHandler(async (req, res) => res.json({ success: true, data: await adminDashboard.overview(v(req)) }));

// GET /admin/dashboard/seller-performance
const sellerPerformance = asyncHandler(async (req, res) => res.json({ success: true, data: await adminDashboard.sellerPerformance(v(req)) }));

// GET /admin/dashboard/reports/:report   (CSV)
const report = asyncHandler(async (req, res) => {
  const { filename, content } = await adminDashboard.report(v(req).report, v(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

module.exports = { mine, admin, sellerPerformance, report };
