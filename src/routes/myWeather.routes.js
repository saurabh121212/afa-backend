// MY WEATHER, mounted at /api/v1/me/weather (before /me). Any logged-in user.
//
//   GET /me/weather   weather of the user's area: a farmer's FARM inkhundla first, otherwise the
//                     inkhundla on the profile. 404 NO_PROFILE_LOCATION when none is saved.
const express = require('express');
const controller = require('../controllers/weather.controller');
const { protectUser } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser);

router.get('/', controller.mine);

module.exports = router;
