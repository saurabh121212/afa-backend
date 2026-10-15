// PUBLIC marketplace, mounted at /api/v1/listings. No login needed.
// Only admin-approved listings of approved sellers are shown.
//
//   GET /listings/options     every dropdown: units, availability, delivery types... (load once)
//   GET /listings             search + filters:
//                             ?search=&kind=product|service&categoryId=&subCategoryId=&regionId=
//                             &sellerType=farmer|trader|logistics&sellerId=&minPrice=&maxPrice=
//                             &availability=&sort=newest|price_asc|price_desc|name_asc&page=&limit=
//   GET /listings/:id         listing details + seller
const express = require('express');
const controller = require('../controllers/listing.controller');
const rules = require('../validators/listing.validator');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/options', controller.listingOptions);
router.get('/', rules.publicList, validate, controller.publicList);
router.get('/:id', rules.byId, validate, controller.publicGet);

module.exports = router;
