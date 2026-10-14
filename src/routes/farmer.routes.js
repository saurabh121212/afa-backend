// FARMER-ONLY routes, mounted at /api/v1/farmers
//
//   POST   /farmers/register                                  Step 1 - Personal Information (public)
//   PUT    /farmers/register/farm-information                 Step 2 - Farm Information (optional)
//   GET    /farmers/register/documents                        Step 3 - document cards + what's uploaded
//   POST   /farmers/register/documents/continue               Step 3 - "Continue" button
//   POST   /farmers/register/documents/:documentType          Step 3 - upload / replace one file
//   GET    /farmers/register/documents/:documentType/file     Step 3 - view own uploaded file
//   DELETE /farmers/register/documents/:documentType          Step 3 - remove a file ("X")
//   Step 4 is shared by all user types -> see registration.routes.js
const express = require('express');
const farmerController = require('../controllers/farmer.controller');
const documentController = require('../controllers/document.controller');
const farmerRules = require('../validators/farmer.validator');
const documentRules = require('../validators/document.validator');
const validate = require('../middlewares/validate');
const uploadKycDocument = require('../middlewares/uploadKycDocument');
const { checkDocumentAllowed } = require('../middlewares/documentAccess');
const { protectRegistration, requireUserType } = require('../middlewares/userAuth');
const { registerLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Every step after Step 1 needs the registrationToken and must be a farmer
const farmerRegistration = [protectRegistration, requireUserType('farmer')];

// ---------- Step 1 (public) ----------
router.post('/register', registerLimiter, farmerRules.register, validate, farmerController.register);

// ---------- Step 2 (optional) ----------
router.put(
  '/register/farm-information',
  farmerRegistration,
  farmerRules.farmInformation,
  validate,
  farmerController.saveFarmInformation
);

// ---------- Step 3: KYC documents (all optional) ----------
router.get('/register/documents', farmerRegistration, documentController.list);

// Must be before "/:documentType" so "continue" isn't read as a document type
router.post('/register/documents/continue', farmerRegistration, documentController.completeStep);

router.post(
  '/register/documents/:documentType',
  farmerRegistration,
  documentRules.documentTypeParam,
  validate,
  checkDocumentAllowed,
  uploadKycDocument,
  documentController.upload
);

router.get(
  '/register/documents/:documentType/file',
  farmerRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.viewFile
);

router.delete(
  '/register/documents/:documentType',
  farmerRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.remove
);

module.exports = router;
