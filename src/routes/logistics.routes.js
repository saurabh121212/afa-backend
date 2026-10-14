// LOGISTICS-PROVIDER-ONLY routes, mounted at /api/v1/logistics
//
//   POST   /logistics/register                                  Step 1 - Business Information (public)
//   PUT    /logistics/register                                  Step 1 - edit after "Back"
//   PUT    /logistics/register/business-location                Step 2 - location + regions served (optional)
//   GET    /logistics/register/documents                        Step 3 - document cards + what's uploaded
//   POST   /logistics/register/documents/continue               Step 3 - "Continue" button
//   POST   /logistics/register/documents/:documentType          Step 3 - upload / replace one file
//   GET    /logistics/register/documents/:documentType/file     Step 3 - view own uploaded file
//   DELETE /logistics/register/documents/:documentType          Step 3 - remove a file ("X")
//   Step 4 (Account Security) is shared by all user types -> see registration.routes.js
const express = require('express');
const logisticsController = require('../controllers/logistics.controller');
const documentController = require('../controllers/document.controller');
const logisticsRules = require('../validators/logistics.validator');
const documentRules = require('../validators/document.validator');
const validate = require('../middlewares/validate');
const uploadKycDocument = require('../middlewares/uploadKycDocument');
const { checkDocumentAllowed } = require('../middlewares/documentAccess');
const { protectRegistration, requireUserType } = require('../middlewares/userAuth');
const { registerLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Every step after Step 1 needs the registrationToken and must be a logistics provider
const logisticsRegistration = [protectRegistration, requireUserType('logistics')];

// ---------- Step 1 ----------
router.post('/register', registerLimiter, logisticsRules.register, validate, logisticsController.register);
router.put('/register', logisticsRegistration, logisticsRules.update, validate, logisticsController.update);

// ---------- Step 2 (optional) ----------
router.put(
  '/register/business-location',
  logisticsRegistration,
  logisticsRules.businessLocation,
  validate,
  logisticsController.saveBusinessLocation
);

// ---------- Step 3: KYC / Documents (all optional) ----------
router.get('/register/documents', logisticsRegistration, documentController.list);

// Must be before "/:documentType" so "continue" isn't read as a document type
router.post('/register/documents/continue', logisticsRegistration, documentController.completeStep);

router.post(
  '/register/documents/:documentType',
  logisticsRegistration,
  documentRules.documentTypeParam,
  validate,
  checkDocumentAllowed,
  uploadKycDocument,
  documentController.upload
);

router.get(
  '/register/documents/:documentType/file',
  logisticsRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.viewFile
);

router.delete(
  '/register/documents/:documentType',
  logisticsRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.remove
);

module.exports = router;
