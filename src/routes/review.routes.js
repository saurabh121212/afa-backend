// BUYER reviews, mounted at /api/v1/me/reviews. Buyers only.
//
//   GET  /me/reviews/pending   completed orders / bookings to review ("To Review"), up to 30 days after completion
//   GET  /me/reviews           my reviews (?status=published|held|hidden&page=&limit=)
//   POST /me/reviews           { sellerOrderId, rating: 1-5, comment? }
//   GET  /me/reviews/:id
//   PUT  /me/reviews/:id       { rating?, comment? }   ONCE, within 7 days of writing it
const express = require('express');
const controller = require('../controllers/review.controller').buyer;
const rules = require('../validators/review.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('buyer'));

router.get('/pending', rules.pending, validate, controller.pending);
router.get('/', rules.myList, validate, controller.list);
router.post('/', rules.create, validate, controller.create);
router.get('/:id', rules.byId, validate, controller.getOne);
router.put('/:id', rules.update, validate, controller.update);

module.exports = router;
