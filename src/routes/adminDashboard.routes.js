// ADMIN DASHBOARD, mounted at /api/v1/admin/dashboard. Admin JWT required.
//
//   GET /admin/dashboard                       ?period=&from=&to=&refresh=true   (cached 5 minutes; refresh skips it)
//   GET /admin/dashboard/seller-performance    ?period&sort=&order=&userType=farmer|trader&search=&page=
//   GET /admin/dashboard/reports/:report       CSV: sales-by-seller | sales-by-category | sales-by-region | registrations
const express = require('express');
const controller = require('../controllers/dashboard.controller');
const rules = require('../validators/dashboard.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/', rules.admin, validate, controller.admin);
router.get('/seller-performance', rules.sellerPerformance, validate, controller.sellerPerformance);
router.get('/reports/:report', rules.report, validate, controller.report);

module.exports = router;
