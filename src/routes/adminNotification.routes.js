// ADMIN BELL, mounted at /api/v1/admin/notifications. Admin JWT required.
// New registrations, listings to review, payment proofs, VAT requests, Contact Us messages,
// claims / cancellation requests to decide, refunds to pay.
//
//   GET    /admin/notifications               (?unread=true&page=)
//   GET    /admin/notifications/unread-count
//   POST   /admin/notifications/read-all
//   POST   /admin/notifications/:id/read
//   DELETE /admin/notifications/:id
const express = require('express');
const controller = require('../controllers/notification.controller');
const rules = require('../validators/notification.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/', rules.adminList, validate, controller.admin.list);
router.get('/unread-count', controller.admin.unreadCount);
router.post('/read-all', rules.adminReadAll, validate, controller.admin.readAll);
router.post('/:id/read', rules.byId, validate, controller.admin.read);
router.delete('/:id', rules.byId, validate, controller.admin.hide);

module.exports = router;
