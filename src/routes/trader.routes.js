// TRADER-ONLY routes, mounted at /api/v1/traders
//
//   POST   /traders/register                                  Step 1 - Business Information (public)
//   PUT    /traders/register                                  Step 1 - edit after "Back"
//   PUT    /traders/register/address-license                  Step 2 - Business Address & License (optional)
//   GET    /traders/register/documents                        Step 3 - document cards + what's uploaded
//   POST   /traders/register/documents/continue               Step 3 - "Continue" button
//   POST   /traders/register/documents/:documentType          Step 3 - upload / replace one file
//   GET    /traders/register/documents/:documentType/file     Step 3 - view own uploaded file
//   DELETE /traders/register/documents/:documentType          Step 3 - remove a file ("X")
//   Step 4 (Account Security) is shared by all user types -> see registration.routes.js
const express = require('express');
const traderController = require('../controllers/trader.controller');
const documentController = require('../controllers/document.controller');
const traderRules = require('../validators/trader.validator');
const documentRules = require('../validators/document.validator');
const validate = require('../middlewares/validate');
const uploadKycDocument = require('../middlewares/uploadKycDocument');
const { checkDocumentAllowed } = require('../middlewares/documentAccess');
const { protectRegistration, requireUserType } = require('../middlewares/userAuth');
const { registerLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Every step after Step 1 needs the registrationToken and must be a trader
const traderRegistration = [protectRegistration, requireUserType('trader')];

// ---------- Step 1 ----------
router.post('/register', registerLimiter, traderRules.register, validate, traderController.register);
router.put('/register', traderRegistration, traderRules.update, validate, traderController.update);

// ---------- Step 2 (optional) ----------
router.put(
  '/register/address-license',
  traderRegistration,
  traderRules.addressAndLicense,
  validate,
  traderController.saveAddressAndLicense
);

// ---------- Step 3: KYC / Documents (all optional) ----------
router.get('/register/documents', traderRegistration, documentController.list);

// Must be before "/:documentType" so "continue" isn't read as a document type
router.post('/register/documents/continue', traderRegistration, documentController.completeStep);

router.post(
  '/register/documents/:documentType',
  traderRegistration,
  documentRules.documentTypeParam,
  validate,
  checkDocumentAllowed,
  uploadKycDocument,
  documentController.upload
);

router.get(
  '/register/documents/:documentType/file',
  traderRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.viewFile
);

router.delete(
  '/register/documents/:documentType',
  traderRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.remove
);

module.exports = router;
