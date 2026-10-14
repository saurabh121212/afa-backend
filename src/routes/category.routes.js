// PUBLIC category APIs, mounted at /api/v1/categories. No login needed.
// Only ACTIVE categories are listed; deleted ones never appear.
//
//   GET /categories?type=product|service        main categories + their sub-categories (cache in the app)
//   GET /categories/:id/sub-categories          sub-categories of one main category (listing form dropdown)
//   GET /categories/:id                         one category
const express = require('express');
const controller = require('../controllers/category.controller');
const rules = require('../validators/category.validator');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/', rules.tree, validate, controller.tree);
router.get('/:id/sub-categories', rules.byId, validate, controller.subCategories);
router.get('/:id', rules.byId, validate, controller.getById);

module.exports = router;
