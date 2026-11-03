// ADMIN transaction history, mounted at /api/v1/admin/transactions. Admin JWT required.
// All money in (payments) and out (refunds, payouts due to sellers).
//
//   GET /admin/transactions/stats   totals { received, refundsPaid, refundsPending, payoutsHeld, payoutsReleased, balanceHeld } (?from=&to=)
//   GET /admin/transactions         list (?type=payment|refund|payout&status=&method=&userId=&search=<order / refund no>&from=&to=&page=)
//   GET /admin/transactions/export  same rows as CSV
const express = require('express');
const controller = require('../controllers/invoice.controller');
const rules = require('../validators/invoice.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', rules.adminTransactions, validate, controller.adminTransactionStats);
router.get('/export', rules.adminTransactions, validate, controller.adminTransactionsCsv);
router.get('/', rules.adminTransactions, validate, controller.adminTransactions);

module.exports = router;
