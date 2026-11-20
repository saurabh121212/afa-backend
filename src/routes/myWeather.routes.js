// MY WEATHER, mounted at /api/v1/me/weather (before /me). Any logged-in user.
//
//   GET /me/weather   weather of the user's area: a farmer's FARM inkhundla first, otherwise the
//                     inkhundla on the profile. 404 NO_PROFILE_LOCATION when none is saved.
//   GET /me/weather/alerts   active weather alerts (written by the admin) for the user's region(s),
//                            plus the ones for all of Eswatini. Most severe first.
const express = require('express');
const controller = require('../controllers/weather.controller');
const alertController = require('../controllers/weatherAlert.controller');
const { protectUser } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser);

router.get('/', controller.mine);
router.get('/alerts', alertController.mine);

module.exports = router;
