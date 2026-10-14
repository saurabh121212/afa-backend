// PUBLIC location APIs, mounted at /api/v1/locations. No login needed.
// Only ACTIVE locations are listed; deleted locations never appear.
//
//   GET /locations/regions                         all regions
//   GET /locations/regions/:id/tinkhundla          Tinkhundla of one region
//   GET /locations/tinkhundla/:id/imiphakatsi      Imiphakatsi of one Inkhundla
//   GET /locations/tree                            everything nested (load once, cache in the app)
//   GET /locations/search?q=&type=&limit=          name search (autocomplete)
//   GET /locations/:id                             one location + its Region / Inkhundla names
//   GET /locations?type=region | ?parentId=<id>    older form, still supported
const express = require('express');
const controller = require('../controllers/location.controller');
const rules = require('../validators/location.validator');
const validate = require('../middlewares/validate');

const router = express.Router();

// Fixed paths first, so "regions", "tree" and "search" aren't read as an :id
router.get('/', rules.list, validate, controller.list);
router.get('/regions', controller.regions);
router.get('/regions/:id/tinkhundla', rules.byId, validate, controller.tinkhundla);
router.get('/tinkhundla/:id/imiphakatsi', rules.byId, validate, controller.imiphakatsi);
router.get('/tree', controller.tree);
router.get('/search', rules.search, validate, controller.search);
router.get('/:id', rules.byId, validate, controller.getById);

module.exports = router;
