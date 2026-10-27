// ADMIN Contact Us inbox, mounted at /api/v1/admin/contact-messages. Admin JWT required.
//
//   GET    /admin/contact-messages/stats         Total / New (unread) / Read / Replied / Closed / Open
//   GET    /admin/contact-messages               list (?status=&subject=&senderType=&search=&from=&to=&sort=&page=)
//   GET    /admin/contact-messages/export        same list as CSV
//   GET    /admin/contact-messages/:id           one message + replies (a "new" message becomes "read")
//   POST   /admin/contact-messages/:id/reply     { message } email the answer to the sender
//   PATCH  /admin/contact-messages/:id/status    { status: new | read | closed } unread / read / reopen / close
//   DELETE /admin/contact-messages/:id           delete (soft)
const express = require('express');
const controller = require('../controllers/contact.controller');
const rules = require('../validators/contact.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/export', rules.list, validate, controller.exportCsv);
router.get('/', rules.list, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getById);
router.post('/:id/reply', rules.reply, validate, controller.reply);
router.patch('/:id/status', rules.setStatus, validate, controller.setStatus);
router.delete('/:id', rules.byId, validate, controller.remove);

module.exports = router;
