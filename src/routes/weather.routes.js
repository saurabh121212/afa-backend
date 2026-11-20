// PUBLIC weather (OpenWeather data stored by the weather job), mounted at /api/v1/weather. No login needed.
//
//   GET /weather/locations?regionId=     every active inkhundla with its current weather (list / map)
//   GET /weather/locations/:id           one inkhundla: current, 3-hour steps, daily summary
//                                        (an umphakatsi id gives its inkhundla; a region id gives 422)
//   GET /weather/alerts                  every active weather alert written by the admin (public website)
// The logged-in user's own area: GET /me/weather (myWeather.routes.js).
const express = require('express');
const controller = require('../controllers/weather.controller');
const rules = require('../validators/weather.validator');
const validate = require('../middlewares/validate');
const alertController = require('../controllers/weatherAlert.controller');

const router = express.Router();

router.get('/locations', rules.listLocations, validate, controller.listLocations);
router.get('/locations/:id', rules.byId, validate, controller.forLocation);
router.get('/alerts', alertController.publicList);

module.exports = router;
