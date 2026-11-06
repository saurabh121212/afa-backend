// MY DEVICES (push notification tokens), mounted at /api/v1/me/devices. Any logged-in user.
//
//   GET    /me/devices    my registered phones / browsers (tokens shortened) + pushEnabled
//   POST   /me/devices    { token, platform: android|ios|web, deviceName?, appVersion? }
//                        call after every login and whenever Firebase gives the app a new token
//   DELETE /me/devices    { token }   call on logout, before the session ends
const express = require('express');
const controller = require('../controllers/notification.controller');
const rules = require('../validators/notification.validator');
const validate = require('../middlewares/validate');
const { protectUser } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser);

router.get('/', controller.listDevices);
router.post('/', rules.registerDevice, validate, controller.registerDevice);
router.delete('/', rules.removeDevice, validate, controller.removeDevice);

module.exports = router;
