// ADMIN review moderation, mounted at /api/v1/admin/reviews. Admin JWT required.
//
//   GET  /admin/reviews/stats                 total, published, held (waiting), hidden, reported, average
//   GET  /admin/reviews                       list (?status=&rating=&reported=true&sellerId=&buyerId=&search=&from=&to=&sort=newest|oldest|most_reported|lowest&page=)
//   GET  /admin/reviews/:id                   one review + its reports
//   POST /admin/reviews/:id/approve           held -> published
//   POST /admin/reviews/:id/hide              { reason }  (the buyer sees the reason; open reports are closed)
//   POST /admin/reviews/:id/restore           hidden -> published
//   POST /admin/reviews/:id/dismiss-reports   keep the review, close its reports
const express = require('express');
const controller = require('../controllers/review.controller').admin;
const rules = require('../validators/review.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/', rules.adminList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getOne);
router.post('/:id/approve', rules.byId, validate, controller.approve);
router.post('/:id/hide', rules.hide, validate, controller.hide);
router.post('/:id/restore', rules.byId, validate, controller.restore);
router.post('/:id/dismiss-reports', rules.byId, validate, controller.dismissReports);

module.exports = router;
