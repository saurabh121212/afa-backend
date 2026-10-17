// PUBLIC seller pages, mounted at /api/v1/sellers. No login needed.
// Only approved farmers, traders and logistics providers are shown.
//
//   GET /sellers/:id            "About the Seller" + store header (member since, live listings, public details)
//   GET /sellers/:id/listings   the seller's live listings ("Visit Store"), same filters as GET /listings
const express = require('express');
const controller = require('../controllers/wishlist.controller');
const rules = require('../validators/wishlist.validator');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/:id', rules.sellerId, validate, controller.getSeller);
router.get('/:id/listings', rules.sellerListings, validate, controller.sellerListings);

module.exports = router;
