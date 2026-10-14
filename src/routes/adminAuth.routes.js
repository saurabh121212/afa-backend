// Admin authentication routes, mounted at /api/v1/admin/auth
const express = require('express');
const controller = require('../controllers/adminAuth.controller');
const { protectAdmin } = require('../middlewares/adminAuth');
const { loginLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, controller.login); // public, max 10 tries / 15 min
router.get('/me', protectAdmin, controller.me); // needs token
router.patch('/change-password', protectAdmin, controller.changePassword); // needs token

module.exports = router;
