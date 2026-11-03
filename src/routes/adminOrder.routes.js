// ADMIN Orders & Transactions, mounted at /api/v1/admin/orders. Admin JWT required.
//
//   GET  /admin/orders/stats     totals, paid value, late seller orders, payments to review
//   GET  /admin/orders           list (?status=&paymentMethod=&sellerId=&from=&to=&search=&sort=&page=)
//   GET  /admin/orders/export    same list as CSV
//   GET  /admin/orders/:id       full details: buyer, seller orders, items, payments, timeline,
//                                cancellation requests, claims, refunds
//
// Phase 4:
//   GET  /admin/orders/cancellation-requests                       (?status=escalated&page=)
//   POST /admin/orders/cancellation-requests/:requestId/decide     { decision: approve | reject, note? (needed to reject) }
//   POST /admin/orders/:id/seller-orders/:sellerOrderId/cancel     { reason, refundAmount? }  no refundAmount = full refund
//   POST /admin/orders/:id/seller-orders/:sellerOrderId/refund     { amount, reason }  refund without cancelling
const express = require('express');
const controller = require('../controllers/adminOrder.controller');
const cancellation = require('../controllers/cancellation.controller');
const refundRules = require('../validators/refund.validator');
const rules = require('../validators/order.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/export', rules.adminList, validate, controller.exportCsv);
router.get('/cancellation-requests', refundRules.requestList, validate, cancellation.requestList);
router.post('/cancellation-requests/:requestId/decide', refundRules.decideRequest, validate, cancellation.decideRequest);
router.get('/', rules.adminList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getOne);
router.post('/:id/seller-orders/:sellerOrderId/cancel', refundRules.adminCancel, validate, cancellation.adminCancel);
router.post('/:id/seller-orders/:sellerOrderId/refund', refundRules.adminRefund, validate, cancellation.adminRefund);

module.exports = router;
