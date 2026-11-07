// My credit score, mounted at /api/v1/me/credit-score. Farmers, traders and logistics providers.
//
//   GET /me/credit-score           score (0-100), grade, the 5 parts with points, explanation and tips
//   GET /me/credit-score/history   score at the end of each of the last 12 months + latest changes
//
// The score is private (not shown to buyers or on the marketplace).
const express = require('express');
const controller = require('../controllers/creditScore.controller');
const { protectUser, requireUserType } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('farmer', 'trader', 'logistics'));

router.get('/', controller.mine);
router.get('/history', controller.history);

module.exports = router;
