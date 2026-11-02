// SELLER orders received ("My Sales"), mounted at /api/v1/me/sales.
// Farmers and traders (product sellers) with an approved account. Only PAID orders are shown.
//
//   GET    /me/sales/stats          New / Late / In progress / Completed, sales and payout totals
//   GET    /me/sales                list (?status=&late=true&from=&to=&search=&sort=&page=)
//   GET    /me/sales/export         same list as CSV
//   GET    /me/sales/:id            one order: items, buyer contact + delivery address, timeline, nextStatuses
//   PATCH  /me/sales/:id/status     { status, note? }
//                                   paid -> confirmed -> packed -> dispatched (delivery) -> delivered
//                                                              -> ready_for_pickup (pickup) -> collected
const express = require('express');
const controller = require('../controllers/sales.controller');
const rules = require('../validators/order.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType, requireApprovedAccount } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('farmer', 'trader'), requireApprovedAccount);

router.get('/stats', controller.stats);
router.get('/export', rules.salesList, validate, controller.exportCsv);
router.get('/', rules.salesList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getOne);
router.patch('/:id/status', rules.salesStatus, validate, controller.setStatus);

module.exports = router;
