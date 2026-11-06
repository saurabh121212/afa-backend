// MY NOTIFICATIONS (the bell), mounted at /api/v1/me/notifications. Any logged-in user.
//
//   GET    /me/notifications               list (?category=&unread=true&page=&limit=) + unreadCount + byCategory
//   GET    /me/notifications/unread-count  { unreadCount, byCategory }  (for the badge)
//   POST   /me/notifications/read-all      { category? }  mark all (of a category) as read
//   POST   /me/notifications/:id/read      mark one as read
//   DELETE /me/notifications/:id           remove from my list (kept on the server)
const express = require('express');
const controller = require('../controllers/notification.controller');
const rules = require('../validators/notification.validator');
const validate = require('../middlewares/validate');
const { protectUser } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser);

router.get('/', rules.myList, validate, controller.user.list);
router.get('/unread-count', controller.user.unreadCount);
router.post('/read-all', rules.myReadAll, validate, controller.user.readAll);
router.post('/:id/read', rules.byId, validate, controller.user.read);
router.delete('/:id', rules.byId, validate, controller.user.hide);

module.exports = router;
