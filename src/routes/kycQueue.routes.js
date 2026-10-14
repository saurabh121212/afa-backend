// ADMIN KYC Approval Queue, mounted at /api/v1/admin/kyc-queue. Admin JWT required.
//
//   GET /admin/kyc-queue/stats       Total Pending, Urgent (> 3 days), Approved Today, Rejected Today,
//                                    Documents to Review
//   GET /admin/kyc-queue             users waiting for approval (search, role, priority, sort, pages)
//   GET /admin/kyc-queue/documents   uploaded documents to review, from ANY user (default status=pending)
//
// "Review" opens GET /admin/users/:id, "Approve" / "Reject" call POST /admin/users/:id/approve | reject,
// a document is opened with GET /admin/users/:id/documents/:type/file and reviewed with
// PATCH /admin/users/:id/documents/:type/review.
const express = require('express');
const controller = require('../controllers/kycQueue.controller');
const rules = require('../validators/adminUser.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/documents', rules.kycDocuments, validate, controller.listDocuments);
router.get('/', rules.kycQueue, validate, controller.list);

module.exports = router;
