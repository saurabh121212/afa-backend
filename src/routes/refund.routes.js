// BUYER refunds, mounted at /api/v1/me/refunds. Buyer login required.
//
//   GET    /me/refunds                     my refunds (?status=pending|paid|failed&page=) + summary
//   GET    /me/refunds/bank-account        saved bank account for refunds (null = none)
//   PUT    /me/refunds/bank-account        { bankName, accountName, accountNumber, branchCode? }
//                                          also fills refunds still waiting for bank details
//   DELETE /me/refunds/bank-account
//   GET    /me/refunds/:id                 one refund
//   PUT    /me/refunds/:id/bank-details    { bankName, accountName, accountNumber, branchCode?, saveForNextTime? }
//                                          (a failed refund goes back to pending)
//   GET    /me/refunds/:id/file            AFA's proof of the refund transfer (when uploaded)
const express = require('express');
const controller = require('../controllers/refund.controller').buyer;
const rules = require('../validators/refund.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('buyer'));

router.get('/', rules.myRefundList, validate, controller.list);
router.get('/bank-account', controller.getAccount);
router.put('/bank-account', rules.saveAccount, validate, controller.saveAccount);
router.delete('/bank-account', controller.deleteAccount);
router.get('/:id', rules.refundById, validate, controller.getOne);
router.put('/:id/bank-details', rules.bankDetails, validate, controller.bankDetails);
router.get('/:id/file', rules.refundById, validate, controller.file);

module.exports = router;
