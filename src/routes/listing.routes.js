// PUBLIC marketplace, mounted at /api/v1/listings. No login needed.
// Only admin-approved listings of approved sellers are shown.
//
//   GET /listings/options     every dropdown: units, availability, delivery types... (load once)
//   GET /listings             search + filters:
//                             ?search=&kind=product|service&categoryId=&subCategoryId=&regionId=
//                             &sellerType=farmer|trader|logistics&sellerId=&minPrice=&maxPrice=
//                             &availability=&sort=newest|price_asc|price_desc|name_asc&page=&limit=
//   GET /listings/:id         listing details + "About the Seller"
//   GET /listings/:id/related "You May Also Like" (?limit=, default 8)
//   GET /listings/:id/booking-form   services: what to fill in to book, rules, booked-dates calendar (?from=&to=)
//   GET /listings/:id/reviews        rating summary (average, count, stars) + published reviews (?rating=&withComment=&sort=&page=)
const express = require('express');
const controller = require('../controllers/listing.controller');
const rules = require('../validators/listing.validator');
const validate = require('../middlewares/validate');
const wishlistController = require('../controllers/wishlist.controller');
const wishlistRules = require('../validators/wishlist.validator');
const bookingController = require('../controllers/booking.controller');
const bookingRules = require('../validators/booking.validator');
const reviewController = require('../controllers/review.controller');
const reviewRules = require('../validators/review.validator');

const router = express.Router();

router.get('/options', controller.listingOptions);
router.get('/', rules.publicList, validate, controller.publicList);
router.get('/:id/related', wishlistRules.related, validate, wishlistController.related);
router.get('/:id/booking-form', bookingRules.bookingForm, validate, bookingController.bookingForm);
router.get('/:id/reviews', reviewRules.publicList('Listing'), validate, reviewController.forListing);
router.get('/:id', rules.byId, validate, controller.publicGet);

module.exports = router;
