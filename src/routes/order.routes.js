// BUYER checkout + orders, mounted at /api/v1/me/orders. Buyer login required.
// Placing an order needs an APPROVED buyer account.
//
//   GET    /me/orders/payment-methods                         bank transfer / online availability + AFA bank details
//   POST   /me/orders                                         place the order from the cart
//                                                             { paymentMethod, addressId?, sellerNotes?, acceptTerms: true, expectedTotal? }
//                                                             header Idempotency-Key: <unique per click> (recommended)
//   GET    /me/orders                                         My Orders (?status=&search=&page=)
//   GET    /me/orders/:id                                     order details (sellers, items, payments, timeline)
//   PATCH  /me/orders/:id/payment-method                      { paymentMethod } switch before paying
//   POST   /me/orders/:id/pay/online                          { channel?, cellNumber? } start an online payment -> redirectUrl
//   POST   /me/orders/:id/pay/test                            TEST MODE ONLY { outcome: "success" | "fail" }
//   POST   /me/orders/:id/payment-proof                       bank transfer proof (form-data: file, amountPaid, paidOn, bankReference?, note?)
//   GET    /me/orders/:id/payments/:paymentId/receipt         view your uploaded proof
//   POST   /me/orders/:id/cancel                              { reason? } cancel an UNPAID order (stock goes back)
//   POST   /me/orders/:id/seller-orders/:sellerOrderId/received   "I received it"
const express = require('express');
const controller = require('../controllers/order.controller');
const rules = require('../validators/order.validator');
const validate = require('../middlewares/validate');
const validateUpload = require('../middlewares/validateUpload');
const uploadPaymentProof = require('../middlewares/uploadPaymentProof');
const { protectUser, requireUserType, requireApprovedAccount } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('buyer'));

router.get('/payment-methods', controller.paymentMethods);
router.post('/', requireApprovedAccount, rules.placeOrder, validate, controller.placeOrder);
router.get('/', rules.myList, validate, controller.list);
router.get('/:id', rules.byId, validate, controller.getOne);
router.patch('/:id/payment-method', rules.paymentMethod, validate, controller.changeMethod);
router.post('/:id/pay/online', rules.payOnline, validate, controller.payOnline);
router.post('/:id/pay/test', rules.testPay, validate, controller.payTest);
router.post(
  '/:id/payment-proof',
  rules.byId,
  validate,
  uploadPaymentProof, // file first (form-data), then the text fields
  rules.paymentProof,
  validateUpload,
  controller.uploadProof
);
router.get('/:id/payments/:paymentId/receipt', rules.receipt, validate, controller.receipt);
router.post('/:id/cancel', rules.cancel, validate, controller.cancel);
router.post('/:id/seller-orders/:sellerOrderId/received', rules.received, validate, controller.received);

module.exports = router;
