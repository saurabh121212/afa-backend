// BUYER claims (report a problem after delivery), mounted at /api/v1/me/claims. Buyer login required.
//
//   POST /me/claims                        open a claim (form-data: sellerOrderId, reason, description,
//                                          items = JSON text [{ "orderItemId": 12, "quantity": 2 }], photos[] up to 5)
//                                          Check first: GET /me/orders/:id/seller-orders/:sellerOrderId/claim-options
//   GET  /me/claims                        my claims (?status=&active=true&reason=&search=&sort=&page=)
//   GET  /me/claims/:id                    one claim: items, amounts, messages + photos, actions
//   POST /me/claims/:id/messages           form-data: message?, photos[]?
//   POST /me/claims/:id/escalate           { note? }  send to AFA (after the seller rejected, or did not reply in time)
//   POST /me/claims/:id/withdraw           { note? }
//   POST /me/claims/:id/returned           { note? }  "I sent the item back" (when a return is needed)
//   GET  /me/claims/:id/photos/:photoId    a photo of the claim
const express = require('express');
const controller = require('../controllers/claim.controller').buyer;
const rules = require('../validators/refund.validator');
const validate = require('../middlewares/validate');
const validateUpload = require('../middlewares/validateUpload');
const uploadPrivateFiles = require('../middlewares/uploadPrivateFiles');
const { CLAIM_PHOTOS } = require('../config/refunds');
const { protectUser, requireUserType } = require('../middlewares/userAuth');

const photos = uploadPrivateFiles({
  field: 'photos',
  maxFiles: CLAIM_PHOTOS.maxFiles,
  formats: CLAIM_PHOTOS.formats,
  maxSizeMB: CLAIM_PHOTOS.maxSizeMB,
  folder: (req) => `${CLAIM_PHOTOS.folder}/u${req.user.id}`,
  prefix: 'claim',
  label: 'photo',
});

const router = express.Router();
router.use(protectUser, requireUserType('buyer'));

router.post('/', photos, rules.openClaim, validateUpload, controller.open);
router.get('/', rules.claimList, validate, controller.list);
router.get('/:id', rules.claimById, validate, controller.getOne);
router.post('/:id/messages', rules.claimById, validate, photos, rules.claimMessage, validateUpload, controller.message);
router.post('/:id/escalate', rules.claimNote, validate, controller.escalate);
router.post('/:id/withdraw', rules.claimNote, validate, controller.withdraw);
router.post('/:id/returned', rules.claimNote, validate, controller.returned);
router.get('/:id/photos/:photoId', rules.claimPhoto, validate, controller.photo);

module.exports = router;

