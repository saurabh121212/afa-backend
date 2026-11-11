// ADMIN CMS -> Videos (Video Gallery), mounted at /api/v1/admin/videos. Admin JWT required.
//
//   GET    /admin/videos/stats          Total / Active / Hidden cards
//   GET    /admin/videos                list, hidden videos included (?isActive=true|false&search=&page=&limit=)
//   GET    /admin/videos/:id            one video
//   POST   /admin/videos                { title, description, link, isActive?, sortOrder? }
//   PUT    /admin/videos/:id            edit (send only what changes)
//   PATCH  /admin/videos/:id/status     { isActive } show on / hide from the website
//   DELETE /admin/videos/:id            delete (soft)
const express = require('express');
const controller = require('../controllers/video.controller');
const rules = require('../validators/video.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/', rules.adminList, validate, controller.list);
router.post('/', rules.create, validate, controller.create);
router.get('/:id', rules.byId, validate, controller.get);
router.put('/:id', rules.update, validate, controller.update);
router.patch('/:id/status', rules.setStatus, validate, controller.status);
router.delete('/:id', rules.byId, validate, controller.remove);

module.exports = router;
