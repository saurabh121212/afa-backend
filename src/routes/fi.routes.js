// FINANCIAL-INSTITUTION-ONLY routes, mounted at /api/v1/fis
//
//   POST   /fis/register                                  Step 1 - Institution Information (public)
//   PUT    /fis/register                                  Step 1 - edit after "Back"
//   PUT    /fis/register/regulatory-details               Step 2 - location, regulatory details, regions served
//   GET    /fis/register/documents                        Step 3 - document cards + what's uploaded
//   POST   /fis/register/documents/continue               Step 3 - "Continue" button
//   POST   /fis/register/documents/:documentType          Step 3 - upload / replace one file
//   GET    /fis/register/documents/:documentType/file     Step 3 - view own uploaded file
//   DELETE /fis/register/documents/:documentType          Step 3 - remove a file ("X")
//   Step 4 (Account Security) is shared by all user types -> see registration.routes.js
const express = require('express');
const fiController = require('../controllers/fi.controller');
const documentController = require('../controllers/document.controller');
const fiRules = require('../validators/fi.validator');
const documentRules = require('../validators/document.validator');
const validate = require('../middlewares/validate');
const uploadKycDocument = require('../middlewares/uploadKycDocument');
const { checkDocumentAllowed } = require('../middlewares/documentAccess');
const { protectRegistration, requireUserType } = require('../middlewares/userAuth');
const { registerLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Every step after Step 1 needs the registrationToken and must be a financial institution
const fiRegistration = [protectRegistration, requireUserType('financial_institution')];

// ---------- Step 1 ----------
router.post('/register', registerLimiter, fiRules.register, validate, fiController.register);
router.put('/register', fiRegistration, fiRules.update, validate, fiController.update);

// ---------- Step 2 (optional) ----------
router.put(
  '/register/regulatory-details',
  fiRegistration,
  fiRules.regulatoryDetails,
  validate,
  fiController.saveRegulatoryDetails
);

// ---------- Step 3: KYC / Documents (all optional) ----------
router.get('/register/documents', fiRegistration, documentController.list);

// Must be before "/:documentType" so "continue" isn't read as a document type
router.post('/register/documents/continue', fiRegistration, documentController.completeStep);

router.post(
  '/register/documents/:documentType',
  fiRegistration,
  documentRules.documentTypeParam,
  validate,
  checkDocumentAllowed,
  uploadKycDocument,
  documentController.upload
);

router.get(
  '/register/documents/:documentType/file',
  fiRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.viewFile
);

router.delete(
  '/register/documents/:documentType',
  fiRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.remove
);

module.exports = router;
