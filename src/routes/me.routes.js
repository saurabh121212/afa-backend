// LOGGED-IN user's own account, mounted at /api/v1/me. Needs the login token (POST /auth/login).
//
// Profile (all user types):
//   GET    /me/profile                                everything the profile screen shows
//   PATCH  /me/profile                                edit (send only the fields to change)
//   PATCH  /me/password                               change password (returns a new token)
//
// Bank & payment details (every user type EXCEPT financial institutions):
//   GET    /me/payment-methods                        list (Primary first)
//   POST   /me/payment-methods                        add a bank account or mobile money
//   PUT    /me/payment-methods/:id                    edit
//   PATCH  /me/payment-methods/:id/primary            make it the primary one
//   DELETE /me/payment-methods/:id                    remove (soft delete)
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
const profileController = require('../controllers/profile.controller');
const paymentController = require('../controllers/paymentMethod.controller');
const documentRules = require('../validators/document.validator');
const profileRules = require('../validators/profile.validator');
const paymentRules = require('../validators/paymentMethod.validator');
const validate = require('../middlewares/validate');
const uploadKycDocument = require('../middlewares/uploadKycDocument');
const { checkDocumentAllowed } = require('../middlewares/documentAccess');
const { protectUser } = require('../middlewares/userAuth');
const { loginLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();
router.use(protectUser);

// ---- Profile ----
router.get('/profile', profileController.getProfile);
router.patch('/profile', profileRules.updateProfile, profileController.updateProfile); // validates by user type
router.patch('/password', loginLimiter, profileRules.changePassword, validate, profileController.changePassword);

// ---- Bank & payment details ----
router.get('/payment-methods', paymentController.list);
router.post('/payment-methods', paymentRules.create, validate, paymentController.create);
router.put('/payment-methods/:id', paymentRules.update, validate, paymentController.update);
router.patch('/payment-methods/:id/primary', paymentRules.byId, validate, paymentController.setPrimary);
router.delete('/payment-methods/:id', paymentRules.byId, validate, paymentController.remove);

// ---- KYC documents ----
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
