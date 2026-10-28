// ADMIN System Settings, mounted at /api/v1/admin/settings. Admin JWT required.
//
//   GET  /admin/settings              all settings, grouped (Tax / VAT, Orders & Payments) + flat "values"
//   PUT  /admin/settings              { "vat_rate": 15, "vat_on_delivery_fee": true, "payment_time_limit_minutes": 30 }
//                                     send only what changes
//   POST /admin/settings/:key/reset   back to the default value
//
// Settings are never deleted; reset saves the default again.
const express = require('express');
const controller = require('../controllers/setting.controller');
const rules = require('../validators/setting.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/', controller.list);
router.put('/', rules.update, validate, controller.update);
router.post('/:key/reset', rules.reset, validate, controller.reset);

module.exports = router;
