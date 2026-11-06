// MY DASHBOARD, mounted at /api/v1/me/dashboard. Farmers, traders, buyers and logistics providers.
// (Financial institutions have no dashboard: 403 DASHBOARD_NOT_AVAILABLE.)
//
//   GET /me/dashboard   ?period=7d|30d|90d|12m|custom&from=YYYY-MM-DD&to=YYYY-MM-DD   (default 30d)
//       farmer / trader -> seller dashboard; buyer -> buyer dashboard; logistics -> account + sample bookings
const express = require('express');
const controller = require('../controllers/dashboard.controller');
const rules = require('../validators/dashboard.validator');
const validate = require('../middlewares/validate');
const { protectUser } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser);

router.get('/', rules.mine, validate, controller.mine);

module.exports = router;
