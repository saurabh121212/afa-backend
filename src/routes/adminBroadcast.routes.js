// ADMIN ADVISORIES / ANNOUNCEMENTS, mounted at /api/v1/admin/broadcasts. Admin JWT required.
// In-app + push to many users. No email.
//
//   POST /admin/broadcasts/preview      { audience } -> recipientCount (before sending)
//   POST /admin/broadcasts              { category: advisory|announcement, title, body, linkUrl?, audience, sendAt? }
//                                       audience: { type: 'all' }
//                                                 { type: 'filter', userTypes: ['farmer'], regionIds: [3] }
//                                                 { type: 'users', userIds: [12, 40] }
//                                       sendAt: empty = now, or a date-time up to 90 days ahead
//   GET  /admin/broadcasts              list (?status=&category=&search=&page=) + counts
//   GET  /admin/broadcasts/:id          one (+ readCount, readRate)
//   PUT  /admin/broadcasts/:id          edit a scheduled one (same fields, all optional)
//   POST /admin/broadcasts/:id/cancel   cancel a scheduled one
const express = require('express');
const controller = require('../controllers/notification.controller');
const rules = require('../validators/notification.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.post('/preview', rules.previewBroadcast, validate, controller.previewBroadcast);
router.post('/', rules.createBroadcast, validate, controller.createBroadcast);
router.get('/', rules.listBroadcasts, validate, controller.listBroadcasts);
router.get('/:id', rules.byId, validate, controller.getBroadcast);
router.put('/:id', rules.updateBroadcast, validate, controller.updateBroadcast);
router.post('/:id/cancel', rules.byId, validate, controller.cancelBroadcast);

module.exports = router;
