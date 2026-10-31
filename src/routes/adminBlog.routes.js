// ADMIN CMS -> Blog & Resources, mounted at /api/v1/admin/blogs. Admin JWT required.
//
//   GET    /admin/blogs/stats          Total / Published / Drafts / Archived / On homepage cards
//   GET    /admin/blogs                every post, drafts and archived included
//                                      (?status=draft|published|archived&homepage=true|false&id=&search=&page=)
//   POST   /admin/blogs                create (then upload the cover image)
//   PUT    /admin/blogs/:id            edit, publish / archive, homepage on / off (send only what changes)
//   POST   /admin/blogs/:id/image      upload / replace the cover (form-data "file", JPG/PNG, max 5MB)
//   DELETE /admin/blogs/:id            delete (soft)
const express = require('express');
const controller = require('../controllers/blog.controller');
const rules = require('../validators/blog.validator');
const validate = require('../middlewares/validate');
const uploadPublicImage = require('../middlewares/uploadPublicImage');
const { protectAdmin } = require('../middlewares/adminAuth');
const { BLOG_IMAGE } = require('../config/blog');

const uploadCoverImage = uploadPublicImage(BLOG_IMAGE);

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/', rules.adminList, validate, controller.list);
router.post('/', rules.create, validate, controller.create);
router.put('/:id', rules.update, validate, controller.update);
router.post('/:id/image', rules.byId, validate, uploadCoverImage, controller.image);
router.delete('/:id', rules.byId, validate, controller.remove);

module.exports = router;
