// ADMIN credit scores, mounted at /api/v1/admin/credit-scores. Admin JWT required.
//
//   GET  /admin/credit-scores/stats                  scored users, average, by grade, by user type, part averages
//   GET  /admin/credit-scores                        list (?userType=&grade=&regionId=&minScore=&maxScore=&search=&sort=score_desc|score_asc|recent&page=)
//   GET  /admin/credit-scores/export                 CSV, same filters
//   POST /admin/credit-scores/recalculate-all        recalculate everyone in the background (202)
//   GET  /admin/credit-scores/:userId                one user's score + monthly history + every change
//   POST /admin/credit-scores/:userId/recalculate    recalculate now
// Scores come from data only: there is no manual override.
const express = require('express');
const controller = require('../controllers/creditScore.controller').admin;
const rules = require('../validators/creditScore.validator');
const validate = require('../middlewares/validate');
const { protectAdmin } = require('../middlewares/adminAuth');

const router = express.Router();
router.use(protectAdmin);

router.get('/stats', controller.stats);
router.get('/export', rules.exportCsv, validate, controller.exportCsv);
router.post('/recalculate-all', controller.recalculateAll);
router.get('/', rules.list, validate, controller.list);
router.get('/:userId', rules.byUser, validate, controller.getOne);
router.post('/:userId/recalculate', rules.byUser, validate, controller.recalculate);

module.exports = router;
