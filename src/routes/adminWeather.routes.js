// ADMIN weather, mounted at /api/v1/admin/weather. Admin JWT required.
//
//   GET    /admin/weather/status                        switched on?, last / next runs, calls used, coordinates summary
//   GET    /admin/weather/runs                          run log (?kind=&status=&page=&limit=)
//   GET    /admin/weather/locations                     coordinates of tinkhundla / regions
//                                                      (?type=inkhundla|region&regionId=&missing=true&source=&search=&page=&limit=)
//   PATCH  /admin/weather/locations/:id/coordinates     { latitude, longitude } set (or both null to clear)
//   POST   /admin/weather/refresh                       { type: current | forecast | all } run now (202, background)
//   GET    /admin/weather/alerts                        alerts written by the admin (?status=active|upcoming|ended&page=&limit=)
//   POST   /admin/weather/alerts                        { title, severity, message, regionIds (null = all), startsAt, endsAt }
//   PATCH  /admin/weather/alerts/:id                    change an upcoming / active alert
//   POST   /admin/weather/alerts/:id/end                stop showing it now
//   DELETE /admin/weather/alerts/:id                    delete (soft)
const express = require('express');
const controller = require('../controllers/weather.controller');
const rules = require('../validators/weather.validator');
const alertController = require('../controllers/weatherAlert.controller');
const alertRules = require('../validators/weatherAlert.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/status', controller.status);
router.get('/runs', rules.listRuns, validate, controller.runs);
router.get('/locations', rules.listCoordinates, validate, controller.coordinates);
router.patch('/locations/:id/coordinates', rules.setCoordinates, validate, controller.setCoordinates);
router.post('/refresh', rules.refresh, validate, controller.refresh);

router.get('/alerts', alertRules.list, validate, alertController.list);
router.post('/alerts', alertRules.create, validate, alertController.create);
router.patch('/alerts/:id', alertRules.update, validate, alertController.update);
router.post('/alerts/:id/end', alertRules.byId, validate, alertController.end);
router.delete('/alerts/:id', alertRules.byId, validate, alertController.remove);

module.exports = router;
