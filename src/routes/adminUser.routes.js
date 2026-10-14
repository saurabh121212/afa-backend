// ADMIN user management + approval, mounted at /api/v1/admin/users. Admin JWT required.
//
//   GET    /admin/users/stats                                       totals for the stat cards
//   GET    /admin/users                                             list (search, filters, sort, pages)
//   GET    /admin/users/export                                      same list as CSV
//   GET    /admin/users/:id                                         details + documents + notes
//   GET    /admin/users/:id/documents/:documentType/file            open a KYC file
//   PATCH  /admin/users/:id/documents/:documentType/review          approve / reject one document
//   POST   /admin/users/:id/approve                                 approve account (warns about documents)
//   POST   /admin/users/:id/reject                                  reject (final)
//   POST   /admin/users/:id/suspend                                 suspend
//   POST   /admin/users/:id/reactivate                              undo suspension
//   GET    /admin/users/:id/notes                                   internal notes
//   POST   /admin/users/:id/notes                                   add an internal note
const express = require('express');
const controller = require('../controllers/adminUser.controller');
const rules = require('../validators/adminUser.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

// Fixed paths first, so "stats" / "export" aren't read as an :id
router.get('/stats', controller.stats);
router.get('/export', rules.list, validate, controller.exportCsv);
router.get('/', rules.list, validate, controller.list);

router.get('/:id', rules.byId, validate, controller.getDetails);
router.get('/:id/documents/:documentType/file', rules.documentFile, validate, controller.viewDocument);
router.patch('/:id/documents/:documentType/review', rules.reviewDocument, validate, controller.reviewDocument);

router.post('/:id/approve', rules.byId, validate, controller.approve);
router.post('/:id/reject', rules.reject, validate, controller.reject);
router.post('/:id/suspend', rules.suspend, validate, controller.suspend);
router.post('/:id/reactivate', rules.byId, validate, controller.reactivate);

router.get('/:id/notes', rules.byId, validate, controller.listNotes);
router.post('/:id/notes', rules.addNote, validate, controller.addNote);

module.exports = router;
