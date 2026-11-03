// SELLER orders received ("My Sales"), mounted at /api/v1/me/sales.
// Farmers and traders (product sellers) with an approved account. Only PAID orders are shown.
//
//   GET    /me/sales/stats          New / Late / In progress / Completed, sales and payout totals
//   GET    /me/sales                list (?status=&late=true&from=&to=&search=&sort=&page=)
//   GET    /me/sales/export         same list as CSV
//   GET    /me/sales/:id            one order: items, buyer contact + delivery address, timeline, nextStatuses
//   PATCH  /me/sales/:id/status     { status, note? }
//                                   paid -> confirmed -> packed -> dispatched (delivery) -> delivered
//                                                              -> ready_for_pickup (pickup) -> collected
//                                  (?cancelRequest=true / ?openClaim=true filters on the list)
//
// Phase 4:
//   POST   /me/sales/:id/cancel                       { reason }  before dispatch / ready for pickup (full refund)
//   POST   /me/sales/:id/cancel-request/accept        { note? }   buyer asked to cancel -> cancelled, full refund
//   POST   /me/sales/:id/cancel-request/decline       { reason }  the order goes on
//   GET    /me/sales/claims                           claims on my orders (?status=&active=true&reason=&search=&sort=&page=)
//   GET    /me/sales/claims/:id                       one claim with messages + photos
//   POST   /me/sales/claims/:id/accept                { refundAmount?, returnRequired?, note? }
//   POST   /me/sales/claims/:id/reject                { reason }
//   POST   /me/sales/claims/:id/messages              form-data: message?, photos[]?
//   POST   /me/sales/claims/:id/return-received       { note? }  -> buyer refunded
//   GET    /me/sales/claims/:id/photos/:photoId
const express = require('express');
const controller = require('../controllers/sales.controller');
const cancellation = require('../controllers/cancellation.controller');
const claim = require('../controllers/claim.controller').seller;
const refundRules = require('../validators/refund.validator');
const validateUpload = require('../middlewares/validateUpload');
const uploadPrivateFiles = require('../middlewares/uploadPrivateFiles');
const { CLAIM_PHOTOS } = require('../config/refunds');
const rules = require('../validators/order.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType, requireApprovedAccount } = require('../middlewares/userAuth');

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
router.use(protectUser, requireUserType('farmer', 'trader'), requireApprovedAccount);

// Claims (before /:id)
router.get('/claims', refundRules.claimList, validate, claim.list);
router.get('/claims/:id', refundRules.claimById, validate, claim.getOne);
router.post('/claims/:id/accept', refundRules.claimAccept, validate, claim.accept);
router.post('/claims/:id/reject', refundRules.claimReject, validate, claim.reject);
router.post('/claims/:id/messages', refundRules.claimById, validate, photos, refundRules.claimMessage, validateUpload, claim.message);
router.post('/claims/:id/return-received', refundRules.claimNote, validate, claim.returnReceived);
router.get('/claims/:id/photos/:photoId', refundRules.claimPhoto, validate, claim.photo);

router.get('/stats', controller.stats);
router.get('/export', rules.salesList, validate, controller.exportCsv);
router.get('/', rules.salesList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getOne);
router.patch('/:id/status', rules.salesStatus, validate, controller.setStatus);
router.post('/:id/cancel', refundRules.sellerCancel, validate, cancellation.sellerCancel);
router.post('/:id/cancel-request/accept', refundRules.acceptRequest, validate, cancellation.sellerAccept);
router.post('/:id/cancel-request/decline', refundRules.declineRequest, validate, cancellation.sellerDecline);

module.exports = router;
