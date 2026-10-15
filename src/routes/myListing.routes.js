// SELLER listings, mounted at /api/v1/me/listings.
// Login token + APPROVED account + user type farmer / trader (products) or logistics (services).
//
//   GET    /me/listings                          My Listings (?status=&search=&page=) + counts per status
//   POST   /me/listings                          create ("Save as Draft"; submit: true = "Publish Listing")
//   GET    /me/listings/:id                      one listing (+ what is still missing to publish)
//   PUT    /me/listings/:id                      edit (an active listing goes back to review)
//   POST   /me/listings/:id/submit               send a draft / rejected / flagged listing for review
//   PATCH  /me/listings/:id/inventory            stock + availability only (no new review)
//   PATCH  /me/listings/:id/visibility           { visible: false } pause, { visible: true } show again
//   DELETE /me/listings/:id                      delete (soft)
//   POST   /me/listings/:id/photos               add photos (form-data "photos", up to 5 in total)
//   PATCH  /me/listings/:id/photos/order         { photoIds: [...] } first = cover photo
//   DELETE /me/listings/:id/photos/:photoId      remove a photo
const express = require('express');
const controller = require('../controllers/listing.controller');
const rules = require('../validators/listing.validator');
const validate = require('../middlewares/validate');
const uploadListingPhotos = require('../middlewares/uploadListingPhotos');
const { protectUser, requireApprovedAccount, requireUserType } = require('../middlewares/userAuth');
const { SELLER_USER_TYPES } = require('../config/listingOptions');

const router = express.Router();
router.use(protectUser, requireApprovedAccount, requireUserType(...SELLER_USER_TYPES));

router.get('/', rules.myList, validate, controller.listMine);
router.post('/', rules.create, validate, controller.create);
router.get('/:id', rules.byId, validate, controller.getMine);
router.put('/:id', rules.update, validate, controller.update);
router.post('/:id/submit', rules.byId, validate, controller.submit);
router.patch('/:id/inventory', rules.inventory, validate, controller.updateInventory);
router.patch('/:id/visibility', rules.visibility, validate, controller.setVisibility);
router.delete('/:id', rules.byId, validate, controller.remove);

router.post('/:id/photos', rules.photos, validate, uploadListingPhotos, controller.addPhotos);
router.patch('/:id/photos/order', rules.photoOrder, validate, controller.reorderPhotos);
router.delete('/:id/photos/:photoId', rules.photo, validate, controller.removePhoto);

module.exports = router;
