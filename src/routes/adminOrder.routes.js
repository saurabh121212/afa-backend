// ADMIN Orders & Transactions, mounted at /api/v1/admin/orders. Admin JWT required.
//
//   GET  /admin/orders/stats     totals, paid value, late seller orders, payments to review
//   GET  /admin/orders           list (?status=&paymentMethod=&sellerId=&from=&to=&search=&sort=&page=)
//   GET  /admin/orders/export    same list as CSV
//   GET  /admin/orders/:id       full details: buyer, seller orders, items, payments, timeline
const express = require('express');
const controller = require('../controllers/adminOrder.controller');
const rules = require('../validators/order.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/export', rules.adminList, validate, controller.exportCsv);
router.get('/', rules.adminList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getOne);

module.exports = router;
