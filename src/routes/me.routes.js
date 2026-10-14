// LOGGED-IN user's own account, mounted at /api/v1/me. Needs the login token (POST /auth/login).
//
// KYC documents after registration (documents are optional at registration,
// so users can upload or replace them any time from their account):
//   GET    /me/documents                              document cards + status (pending / approved / rejected)
//   POST   /me/documents/:documentType                upload / replace one file (form-data, field "file")
//   GET    /me/documents/:documentType/file           view own uploaded file
//
// A new or replaced file always goes back to "pending" and shows up in the
// admin KYC module (GET /admin/kyc-queue/documents) for review.
const express = require('express');
const documentController = require('../controllers/document.controller');
const documentRules = require('../validators/document.validator');
const validate = require('../middlewares/validate');
const uploadKycDocument = require('../middlewares/uploadKycDocument');
const { checkDocumentAllowed } = require('../middlewares/documentAccess');
const { protectUser } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser);

router.get('/documents', documentController.list);
router.post(
  '/documents/:documentType',
  documentRules.documentTypeParam,
  validate,
  checkDocumentAllowed,
  uploadKycDocument,
  documentController.upload
);
router.get('/documents/:documentType/file', documentRules.documentTypeParam, validate, documentController.viewFile);

module.exports = router;
