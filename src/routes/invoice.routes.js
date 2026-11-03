// MY INVOICES, mounted at /api/v1/me/invoices. Buyers, farmers and traders.
//   Buyer : the invoices of their orders (one per seller), receipts, credit notes
//   Seller: invoices issued in their name + credit notes (no receipts)
//
//   GET /me/invoices               list (?type=invoice|credit_note|receipt&orderId=&search=<number>&from=&to=&page=)
//   GET /me/invoices/:id           the document as page data (company, parties, lines, totals, notes)
//   GET /me/invoices/:id/pdf       the PDF (inline; ?download=true to download)
const express = require('express');
const controller = require('../controllers/invoice.controller');
const rules = require('../validators/invoice.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('buyer', 'farmer', 'trader'));

router.get('/', rules.myInvoices, validate, controller.mine.list);
router.get('/:id', rules.invoiceById, validate, controller.mine.getOne);
router.get('/:id/pdf', rules.invoiceById, validate, controller.mine.pdf);

module.exports = router;
