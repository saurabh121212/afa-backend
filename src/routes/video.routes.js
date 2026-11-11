// PUBLIC Video Gallery, mounted at /api/v1/videos. No login needed; only active videos.
//
//   GET  /videos   ?search=&page=&limit=   active videos in display order, with the YouTube
//                                          thumbnailUrl and embedUrl (null for other links)
const express = require('express');
const controller = require('../controllers/video.controller');
const rules = require('../validators/video.validator');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/', rules.publicList, validate, controller.publicList);

module.exports = router;
