// Reporting a review, mounted at /api/v1/reviews. Any logged-in user with an approved account.
//
//   POST /reviews/:id/report   { reason: offensive | false_info | spam | personal_info | not_about_order | other, note? }
//                              once per user per review; "other" needs a note
// (Reading reviews: GET /listings/:id/reviews and GET /sellers/:id/reviews, no login)
const express = require('express');
const controller = require('../controllers/review.controller');
const rules = require('../validators/review.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireApprovedAccount } = require('../middlewares/userAuth');

const router = express.Router();

router.post('/:id/report', protectUser, requireApprovedAccount, rules.report, validate, controller.report);

module.exports = router;
