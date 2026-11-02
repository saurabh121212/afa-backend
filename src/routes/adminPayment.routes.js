// ADMIN payments (bank transfer review queue), mounted at /api/v1/admin/payments. Admin JWT required.
//
//   GET  /admin/payments/stats         to review / confirmed / rejected / online results
//   GET  /admin/payments               list (?status=under_review&method=bank_transfer&search=<order no>&page=)
//   GET  /admin/payments/:id           one payment + order + buyer (amountMatches = paid >= total)
//   GET  /admin/payments/:id/file      the uploaded proof of payment
//   POST /admin/payments/:id/confirm   { note? }   bank transfer OK -> order Paid (sellers notified)
//   POST /admin/payments/:id/reject    { reason }  -> buyer must upload again (at least 24 hours more)
const express = require('express');
const controller = require('../controllers/adminOrder.controller');
const rules = require('../validators/order.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.paymentStats);
router.get('/', rules.paymentList, validate, controller.paymentList);
router.get('/:id', rules.paymentId, validate, controller.paymentGet);
router.get('/:id/file', rules.paymentId, validate, controller.paymentFile);
router.post('/:id/confirm', rules.confirmPayment, validate, controller.confirm);
router.post('/:id/reject', rules.rejectPayment, validate, controller.reject);

module.exports = router;
