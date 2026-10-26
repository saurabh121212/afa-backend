// ADMIN CMS -> FAQs, mounted at /api/v1/admin/faqs. Admin JWT required.
//
//   Categories (Getting Started, Payments & Delivery, Orders, Loans & Insurance...)
//   GET    /admin/faqs/categories                 list (+ number of questions)
//   POST   /admin/faqs/categories                 { name, sortOrder? }
//   PUT    /admin/faqs/categories/:id             rename / reorder
//   PATCH  /admin/faqs/categories/:id/status      { isActive } hide / show the whole category
//   DELETE /admin/faqs/categories/:id             delete (soft; only when it has no FAQs)
//
//   FAQs
//   GET    /admin/faqs/stats                      Total FAQs / Categories / Most Viewed Category
//   GET    /admin/faqs                            grouped by category (?search=&categoryId=&isActive=)
//   GET    /admin/faqs/:id                        one FAQ
//   POST   /admin/faqs                            { categoryId, question, answer, sortOrder?, isActive? }
//   PUT    /admin/faqs/:id                        edit (send only what changes)
//   PATCH  /admin/faqs/:id/status                 { isActive } hide / show in the Help Centre
//   DELETE /admin/faqs/:id                        delete (soft)
const express = require('express');
const controller = require('../controllers/cms.controller');
const rules = require('../validators/cms.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

// Categories first, so "categories" / "stats" aren't read as an FAQ :id
router.get('/categories', controller.categoryList);
router.post('/categories', rules.faqCategoryCreate, validate, controller.categoryCreate);
router.put('/categories/:id', rules.faqCategoryUpdate, validate, controller.categoryUpdate);
router.patch('/categories/:id/status', rules.setStatus, validate, controller.categoryStatus);
router.delete('/categories/:id', rules.byId, validate, controller.categoryRemove);

router.get('/stats', controller.faqStats);
router.get('/', rules.faqList, validate, controller.faqList);
router.post('/', rules.faqCreate, validate, controller.faqCreate);
router.get('/:id', rules.byId, validate, controller.faqGet);
router.put('/:id', rules.faqUpdate, validate, controller.faqUpdate);
router.patch('/:id/status', rules.setStatus, validate, controller.faqStatus);
router.delete('/:id', rules.byId, validate, controller.faqRemove);

module.exports = router;
