// ADMIN location management, mounted at /api/v1/admin/locations
// Every route needs the admin JWT.
//
//   GET    /admin/locations                     list (filters + pages)
//   GET    /admin/locations/tree                full Region -> Inkhundla -> Umphakatsi tree
//   GET    /admin/locations/import/template     download the CSV template
//   POST   /admin/locations/import              bulk add from CSV (?dryRun=true to preview)
//   GET    /admin/locations/:id                 one location + parent + children
//   POST   /admin/locations                     add one
//   PUT    /admin/locations/:id                 rename
//   PATCH  /admin/locations/:id/status          enable / disable (with everything under it)
//   DELETE /admin/locations/:id                 SOFT delete (only if not in use)
const express = require('express');
const controller = require('../controllers/adminLocation.controller');
const rules = require('../validators/adminLocation.validator');
const validate = require('../middlewares/validate');
const uploadCsv = require('../middlewares/uploadCsv');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();

router.use(protectAdmin); // all routes below need the admin token

// Fixed paths first, so "tree" / "import" aren't read as an :id
router.get('/', rules.list, validate, controller.list);
router.get('/tree', rules.tree, validate, controller.tree);
router.get('/import/template', controller.importTemplate);
router.post('/import', rules.importCsv, validate, uploadCsv, controller.importCsv);

router.get('/:id', rules.byId, validate, controller.getById);
router.post('/', rules.create, validate, controller.create);
router.put('/:id', rules.rename, validate, controller.rename);
router.patch('/:id/status', rules.setStatus, validate, controller.setStatus);
router.delete('/:id', rules.byId, validate, controller.remove);

module.exports = router;
