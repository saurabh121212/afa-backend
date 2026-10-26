// ADMIN CMS -> Banners, mounted at /api/v1/admin/banners. Admin JWT required.
//
//   GET    /admin/banners/stats          Total / Active / Scheduled / Expired cards
//   GET    /admin/banners                list (?placement=&status=active|scheduled|expired|inactive&search=&page=)
//   GET    /admin/banners/:id            one banner
//   POST   /admin/banners                create (then upload the image)
//   PUT    /admin/banners/:id            edit (send only what changes)
//   POST   /admin/banners/:id/image      upload / replace the image (form-data "file", JPG/PNG, max 5MB)
//   PATCH  /admin/banners/:id/status     { isActive } switch on / off
//   DELETE /admin/banners/:id            delete (soft)
const express = require('express');
const controller = require('../controllers/cms.controller');
const rules = require('../validators/cms.validator');
const validate = require('../middlewares/validate');
const uploadPublicImage = require('../middlewares/uploadPublicImage');
const { protectAdmin } = require('../middlewares/adminAuth');
const { BANNER_IMAGE } = require('../config/cms');

const uploadBannerImage = uploadPublicImage(BANNER_IMAGE);

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.bannerStats);
router.get('/', rules.bannerList, validate, controller.bannerList);
router.post('/', rules.bannerCreate, validate, controller.bannerCreate);
router.get('/:id', rules.byId, validate, controller.bannerGet);
router.put('/:id', rules.bannerUpdate, validate, controller.bannerUpdate);
router.post('/:id/image', rules.byId, validate, uploadBannerImage, controller.bannerImage);
router.patch('/:id/status', rules.setStatus, validate, controller.bannerStatus);
router.delete('/:id', rules.byId, validate, controller.bannerRemove);

module.exports = router;
