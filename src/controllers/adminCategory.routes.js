// ADMIN category management, mounted at /api/v1/admin/categories. Admin JWT required.
//
//   GET    /admin/categories/options             dropdowns: appliesTo, VAT choices, refund policies
//   GET    /admin/categories/stats               Main Categories / Sub-Categories / VAT cards
//   GET    /admin/categories                     tree for a tab (?type=product|service&search=&isActive=&vat=)
//   GET    /admin/categories/import/template     download the CSV template
//   POST   /admin/categories/import              bulk add from CSV (?dryRun=true to preview)
//   GET    /admin/categories/:id                 one category (+ sub-categories or + main category)
//   POST   /admin/categories                     add a main category or a sub-category (send parentId)
//   PUT    /admin/categories/:id                 edit name / appliesTo / vatApplicable / refundPolicy / description / sortOrder
//
// VAT: main category vatApplicable = true | false. Sub-category = null (same as main) | true | false.
// refundPolicy (main only): farm_produce | farming_products | leasing | services | null (automatic).
//   GET    /admin/categories/:id/vat-impact      ?vatApplicable=true|false|null -> how many live listings would be hidden
//   POST   /admin/categories/:id/icon            upload the icon image (form-data, field "file")
//   PATCH  /admin/categories/:id/status          enable / disable (a main category with its sub-categories)
//   DELETE /admin/categories/:id                 SOFT delete (main: only when it has no sub-categories)
const express = require('express');
const controller = require('../controllers/adminCategory.controller');
const rules = require('../validators/adminCategory.validator');
const validate = require('../middlewares/validate');
const uploadCsv = require('../middlewares/uploadCsv');
const uploadCategoryIcon = require('../middlewares/uploadCategoryIcon');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

// Fixed paths first, so "stats" / "import" aren't read as an :id
router.get('/options', controller.options);
router.get('/stats', controller.stats);
router.get('/import/template', controller.importTemplate);
router.post('/import', rules.importCsv, validate, uploadCsv, controller.importCsv);
router.get('/', rules.list, validate, controller.list);
router.post('/', rules.create, validate, controller.create);

router.get('/:id', rules.byId, validate, controller.getById);
router.put('/:id', rules.update, validate, controller.update);
router.get('/:id/vat-impact', rules.vatImpact, validate, controller.vatImpact);
router.post('/:id/icon', rules.byId, validate, uploadCategoryIcon, controller.setIcon);
router.patch('/:id/status', rules.setStatus, validate, controller.setStatus);
router.delete('/:id', rules.byId, validate, controller.remove);

module.exports = router;
