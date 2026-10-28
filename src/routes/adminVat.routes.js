// ADMIN: sellers' VAT registration, mounted at /api/v1/admin/vat-registrations. Admin JWT required.
//
//   GET  /admin/vat-registrations/stats              Pending / Approved / Rejected / Not registered
//   GET  /admin/vat-registrations                    list (?status=pending|approved|rejected&userType=&search=&sort=oldest|newest&page=)
//                                                    default: everyone who applied; shows the TIN to compare with the certificate
//   POST /admin/vat-registrations/:userId/approve    pending  -> approved (certificate approved too)
//   POST /admin/vat-registrations/:userId/reject     { reason } pending  -> rejected (certificate rejected too)
//   POST /admin/vat-registrations/:userId/remove     { reason } approved -> rejected (e.g. ERS cancelled it)
//
// The certificate file: GET /admin/users/:id/documents/vat_certificate/file
// Reviewing that document on the KYC screens updates the VAT status the same way.
const express = require('express');
const controller = require('../controllers/adminVat.controller');
const rules = require('../validators/adminVat.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/', rules.list, validate, controller.list);
router.post('/:userId/approve', rules.approve, validate, controller.approve);
router.post('/:userId/reject', rules.withReason, validate, controller.reject);
router.post('/:userId/remove', rules.withReason, validate, controller.remove);

module.exports = router;
