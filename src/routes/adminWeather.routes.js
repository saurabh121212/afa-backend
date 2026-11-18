// ADMIN weather, mounted at /api/v1/admin/weather. Admin JWT required.
//
//   GET    /admin/weather/status                        switched on?, last / next runs, calls used, coordinates summary
//   GET    /admin/weather/runs                          run log (?kind=&status=&page=&limit=)
//   GET    /admin/weather/locations                     coordinates of tinkhundla / regions
//                                                      (?type=inkhundla|region&regionId=&missing=true&source=&search=&page=&limit=)
//   PATCH  /admin/weather/locations/:id/coordinates     { latitude, longitude } set (or both null to clear)
//   POST   /admin/weather/refresh                       { type: current | forecast | all } run now (202, background)
const express = require('express');
const controller = require('../controllers/weather.controller');
const rules = require('../validators/weather.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/status', controller.status);
router.get('/runs', rules.listRuns, validate, controller.runs);
router.get('/locations', rules.listCoordinates, validate, controller.coordinates);
router.patch('/locations/:id/coordinates', rules.setCoordinates, validate, controller.setCoordinates);
router.post('/refresh', rules.refresh, validate, controller.refresh);

module.exports = router;
