// ADMIN Listings Management, mounted at /api/v1/admin/listings. Admin JWT required.
//
//   GET    /admin/listings/stats            Total / Pending / Active / Flagged / Disabled cards
//   GET    /admin/listings                  list (?status=&kind=&categoryId=&sellerType=&search=&sort=&page=)
//   GET    /admin/listings/export           same list as CSV
//   GET    /admin/listings/:id              listing details + seller + allowed actions
//   POST   /admin/listings/:id/approve      pending -> active (visible on the website)
//   POST   /admin/listings/:id/reject       { reason }  pending -> rejected
//   POST   /admin/listings/:id/flag         { reason }  -> flagged (hidden)
//   POST   /admin/listings/:id/disable      { reason }  -> disabled (hidden)
//   POST   /admin/listings/:id/enable       disabled / flagged -> active
const express = require('express');
const controller = require('../controllers/adminListing.controller');
const rules = require('../validators/listing.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/export', rules.adminList, validate, controller.exportCsv);
router.get('/', rules.adminList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getById);

router.post('/:id/approve', rules.byId, validate, controller.approve);
router.post('/:id/reject', rules.withReason, validate, controller.reject);
router.post('/:id/flag', rules.withReason, validate, controller.flag);
router.post('/:id/disable', rules.withReason, validate, controller.disable);
router.post('/:id/enable', rules.byId, validate, controller.enable);

module.exports = router;
