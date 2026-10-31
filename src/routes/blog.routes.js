// PUBLIC Blog, mounted at /api/v1/blogs. No login needed; only published posts.
//
//   GET  /blogs                 published posts, newest first (?homepage=true&category=&search=&page=&limit=)
//   GET  /blogs/:slug           one published post with its body (website /blog/<slug>)
const express = require('express');
const controller = require('../controllers/blog.controller');
const rules = require('../validators/blog.validator');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/', rules.publicList, validate, controller.publicList);
router.get('/:slug', rules.bySlug, validate, controller.publicGet);

module.exports = router;
