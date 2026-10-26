// PUBLIC CMS content for the website and apps. No login needed.
//
//   GET  /banners?placement=homepage_hero   banners live right now (on, started, not ended, with an image)
//   GET  /faqs?search=                      Help Centre: active categories with their active FAQs
//   POST /faqs/:id/view                     count a view when an answer is opened ("Most Viewed Category")
const express = require('express');
const controller = require('../controllers/cms.controller');
const rules = require('../validators/cms.validator');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/banners', rules.bannerPublic, validate, controller.publicBanners);
router.get('/faqs', rules.faqPublic, validate, controller.publicFaqs);
router.post('/faqs/:id/view', rules.byId, validate, controller.faqView);

module.exports = router;
