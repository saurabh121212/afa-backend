// PUBLIC Contact Us form, mounted at /api/v1/contact. No login needed.
//
//   GET  /contact/options   dropdowns: "I am a..." and "Subject"
//   POST /contact           send a message (max 5 per hour per IP)
const express = require('express');
const controller = require('../controllers/contact.controller');
const rules = require('../validators/contact.validator');
const validate = require('../middlewares/validate');
const { contactLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.get('/options', controller.options);
router.post('/', contactLimiter, rules.submit, validate, controller.submit);

module.exports = router;
