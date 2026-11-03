// ADMIN invoices, credit notes and receipts, mounted at /api/v1/admin/invoices. Admin JWT required.
//
//   GET /admin/invoices            list (?type=&orderId=&sellerId=&buyerId=&search=<number or order no>&from=&to=&page=)
//   GET /admin/invoices/:id        page data
//   GET /admin/invoices/:id/pdf    PDF (?download=true to download)
const express = require('express');
const controller = require('../controllers/invoice.controller');
const rules = require('../validators/invoice.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/', rules.adminInvoices, validate, controller.admin.list);
router.get('/:id', rules.invoiceById, validate, controller.admin.getOne);
router.get('/:id/pdf', rules.invoiceById, validate, controller.admin.pdf);

module.exports = router;
