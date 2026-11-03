// MY TRANSACTIONS, mounted at /api/v1/me/transactions. Buyers, farmers and traders.
//   Buyer : payments (every attempt) + refunds, totals { paid, refunded, refundsPending }
//   Seller: sales (paid orders, payout status) + refunds on them,
//           totals { sales, vat, refunds, payoutHeld, payoutReleased }
//
//   GET /me/transactions           (?type=payment|refund|sale&status=&payoutStatus=&from=&to=&page=)
//   GET /me/transactions/export    same rows as CSV
const express = require('express');
const controller = require('../controllers/invoice.controller');
const rules = require('../validators/invoice.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('buyer', 'farmer', 'trader'));

router.get('/', rules.myTransactions, validate, controller.myTransactions);
router.get('/export', rules.myTransactions, validate, controller.myTransactionsCsv);

module.exports = router;
