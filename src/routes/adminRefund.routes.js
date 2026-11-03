// ADMIN refunds (pay buyers back), mounted at /api/v1/admin/refunds. Admin JWT required.
// Refunds are paid manually by bank transfer for now.
//
//   GET  /admin/refunds/stats         pending (+ amount), ready to pay, needs bank details, overdue, failed, paid
//   GET  /admin/refunds               list (?status=&source=&overdue=true&needsBankDetails=true&recoverFromSeller=true&from=&to=&search=&page=)
//   GET  /admin/refunds/export        same list as CSV (with bank details, for the bank upload)
//   GET  /admin/refunds/:id           one refund (full bank details)
//   POST /admin/refunds/:id/paid      form-data: bankReference, paidOn (YYYY-MM-DD), note?, file? (proof: JPG/PNG/PDF, 5MB)
//   POST /admin/refunds/:id/failed    { reason }  -> the buyer is asked for new bank details
//   GET  /admin/refunds/:id/file      the uploaded proof
const express = require('express');
const controller = require('../controllers/refund.controller').admin;
const rules = require('../validators/refund.validator');
const validate = require('../middlewares/validate');
const validateUpload = require('../middlewares/validateUpload');
const uploadPrivateFiles = require('../middlewares/uploadPrivateFiles');
const { REFUND_PROOF } = require('../config/refunds');
const { protectAdmin } = require('../middlewares/adminAuth');

const proof = uploadPrivateFiles({
  field: 'file',
  maxFiles: 1,
  formats: REFUND_PROOF.formats,
  maxSizeMB: REFUND_PROOF.maxSizeMB,
  folder: (req) => `${REFUND_PROOF.folder}/${parseInt(req.params.id, 10) || 0}`,
  prefix: 'refund-proof',
  label: 'file',
});

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/export', rules.adminRefundList, validate, controller.exportCsv);
router.get('/', rules.adminRefundList, validate, controller.list);
router.get('/:id', rules.refundById, validate, controller.getOne);
router.post('/:id/paid', rules.refundById, validate, proof, rules.refundPaid, validateUpload, controller.markPaid);
router.post('/:id/failed', rules.refundFailed, validate, controller.markFailed);
router.get('/:id/file', rules.refundById, validate, controller.file);

module.exports = router;
