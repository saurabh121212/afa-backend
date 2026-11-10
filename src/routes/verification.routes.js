// My verification, mounted at /api/v1/me/verification. Any logged-in user.
//
//   GET /me/verification   isVerified, badge, KYC documents progress, missing / pending / rejected documents,
//                          listing limit (sellers) and the dashboard banner text
//                          ("Your account setup is incomplete — complete your KYC to trade without limits")
const express = require('express');
const controller = require('../controllers/verification.controller');
const { protectUser } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser);

router.get('/', controller.mine);

module.exports = router;
