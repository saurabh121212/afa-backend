// ADMIN claims, mounted at /api/v1/admin/claims. Admin JWT required.
//
//   GET  /admin/claims/stats                  active, to decide (escalated), by status / reason, refunded total
//   GET  /admin/claims                        list (?status=&active=true&reason=&sellerId=&buyerId=&from=&to=&search=&sort=&page=)
//   GET  /admin/claims/:id                    one claim with messages + photos
//   POST /admin/claims/:id/decide             { decision: refund | no_refund, refundAmount?, returnRequired?, note }  (final)
//   POST /admin/claims/:id/messages           form-data: message?, photos[]?
//   POST /admin/claims/:id/return-received    { note? }  the returned item reached the seller -> refund
//   GET  /admin/claims/:id/photos/:photoId
const express = require('express');
const controller = require('../controllers/claim.controller').admin;
const rules = require('../validators/refund.validator');
const validate = require('../middlewares/validate');
const validateUpload = require('../middlewares/validateUpload');
const uploadPrivateFiles = require('../middlewares/uploadPrivateFiles');
const { CLAIM_PHOTOS } = require('../config/refunds');
const { protectAdmin } = require('../middlewares/adminAuth');

const photos = uploadPrivateFiles({
  field: 'photos',
  maxFiles: CLAIM_PHOTOS.maxFiles,
  formats: CLAIM_PHOTOS.formats,
  maxSizeMB: CLAIM_PHOTOS.maxSizeMB,
  folder: () => `${CLAIM_PHOTOS.folder}/admin`,
  prefix: 'claim',
  label: 'photo',
});

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/', rules.adminClaimList, validate, controller.list);
router.get('/:id', rules.claimById, validate, controller.getOne);
router.post('/:id/decide', rules.claimDecide, validate, controller.decide);
router.post('/:id/messages', rules.claimById, validate, photos, rules.claimMessage, validateUpload, controller.message);
router.post('/:id/return-received', rules.claimNote, validate, controller.returnReceived);
router.get('/:id/photos/:photoId', rules.claimPhoto, validate, controller.photo);

module.exports = router;
