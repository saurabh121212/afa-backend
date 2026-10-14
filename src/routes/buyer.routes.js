// BUYER-ONLY routes, mounted at /api/v1/buyers
//   POST   /buyers/register                                  Step 1 - Buyer Information (public)
//   PUT    /buyers/register                                  Step 1 - edit after "Back"
//   GET    /buyers/register/documents                        Step 2 - document cards + what's uploaded
//   POST   /buyers/register/documents/continue               Step 2 - "Continue" button
//   POST   /buyers/register/documents/:documentType          Step 2 - upload / replace one file
//   GET    /buyers/register/documents/:documentType/file     Step 2 - view own uploaded file
//   DELETE /buyers/register/documents/:documentType          Step 2 - remove a file ("X")
//   Step 3 (Account Security) is shared by all user types -> see registration.routes.js


const express = require('express');
const buyerController = require('../controllers/buyer.controller');
const documentController = require('../controllers/document.controller');
const buyerRules = require('../validators/buyer.validator');
const documentRules = require('../validators/document.validator');
const validate = require('../middlewares/validate');
const uploadKycDocument = require('../middlewares/uploadKycDocument');
const { checkDocumentAllowed } = require('../middlewares/documentAccess');
const { protectRegistration, requireUserType } = require('../middlewares/userAuth');
const { registerLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Every step after Step 1 needs the registrationToken and must be a buyer
const buyerRegistration = [protectRegistration, requireUserType('buyer')];

// ---------- Step 1 ----------
router.post('/register', registerLimiter, buyerRules.register, validate, buyerController.register);
//router.put('/register', buyerRegistration, buyerRules.update, validate, buyerController.update);

// ---------- Step 2: KYC / Verification (all optional) ----------
router.get('/register/documents', buyerRegistration, documentController.list);

// Must be before "/:documentType" so "continue" isn't read as a document type
//router.post('/register/documents/continue', buyerRegistration, documentController.completeStep);

router.post(
  '/register/documents/:documentType',
  buyerRegistration,
  documentRules.documentTypeParam,
  validate,
  checkDocumentAllowed, // individual buyers can't upload business-only documents
  uploadKycDocument,
  documentController.upload
);

router.get(
  '/register/documents/:documentType/file',
  buyerRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.viewFile
);

router.delete(
  '/register/documents/:documentType',
  buyerRegistration,
  documentRules.documentTypeParam,
  validate,
  documentController.remove
);

module.exports = router;
