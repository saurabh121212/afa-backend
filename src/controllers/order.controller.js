// BUYER: checkout, payments and My Orders. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const checkoutService = require('../services/checkout.service');
const paymentService = require('../services/payment.service');
const orderService = require('../services/order.service');
const orderNotify = require('../services/orderNotify.service');

const v = (req) => req.validated;

const sendFile = (res, next, { fullPath, mimeType, originalName }) => {
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName || 'receipt')}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) next(err);
  });
};

// GET /me/orders/payment-methods
const paymentMethods = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await checkoutService.paymentOptions() });
});

// POST /me/orders   (Place order)
const placeOrder = asyncHandler(async (req, res) => {
  const key = (req.get('idempotency-key') || '').trim() || null;
  const { orderId, created } = await checkoutService.placeOrder(req.user, v(req), { idempotencyKey: key });
  if (created) orderNotify.orderPlaced(orderId);
  const data = await orderService.getMine(req.user, orderId);
  res.status(created ? 201 : 200).json({
    success: true,
    message: created ? `Order ${data.orderNumber} placed. Please complete the payment.` : `Order ${data.orderNumber} was already placed`,
    data,
  });
});

// GET /me/orders
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orderService.listMine(req.user, v(req)) });
});

// GET /me/orders/:id
const getOne = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orderService.getMine(req.user, v(req).id) });
});

// PATCH /me/orders/:id/payment-method
const changeMethod = asyncHandler(async (req, res) => {
  await paymentService.switchMethod(req.user, v(req).id, v(req));
  res.json({ success: true, message: 'Payment method changed', data: await orderService.getMine(req.user, v(req).id) });
});

// POST /me/orders/:id/pay/online
const payOnline = asyncHandler(async (req, res) => {
  const data = await paymentService.startOnline(req.user, v(req).id, { channel: v(req).channel, cellNumber: v(req).cellNumber });
  res.status(201).json({ success: true, message: 'Continue to the payment page', data });
});

// POST /me/orders/:id/pay/test   (PAYMENT_GATEWAY=test only)
const payTest = asyncHandler(async (req, res) => {
  const result = await paymentService.testOutcome(req.user, v(req).id, v(req));
  const data = await orderService.getMine(req.user, v(req).id);
  res.json({
    success: true,
    message: result.status === 'succeeded' ? 'Test payment successful: the order is paid' : 'Test payment failed: you can try again',
    data: { payment: result, order: data },
  });
});

// POST /me/orders/:id/payment-proof   (form-data)
const uploadProof = asyncHandler(async (req, res) => {
  await paymentService.uploadProof(req.user, v(req).id, v(req), req.file);
  res.status(201).json({
    success: true,
    message: 'Thank you! Your proof of payment was sent. The AFA team will confirm it soon.',
    data: await orderService.getMine(req.user, v(req).id),
  });
});

// GET /me/orders/:id/payments/:paymentId/receipt
const receipt = asyncHandler(async (req, res, next) => {
  const file = await paymentService.receiptFile(v(req).paymentId, { userId: req.user.id });
  sendFile(res, next, file);
});

// POST /me/orders/:id/cancel
const cancel = asyncHandler(async (req, res) => {
  await paymentService.cancelByBuyer(req.user, v(req).id, v(req));
  res.json({ success: true, message: 'Order cancelled', data: await orderService.getMine(req.user, v(req).id) });
});

// POST /me/orders/:id/seller-orders/:sellerOrderId/received
const received = asyncHandler(async (req, res) => {
  const data = await orderService.confirmReceived(req.user, v(req).id, v(req).sellerOrderId);
  res.json({ success: true, message: 'Thank you for confirming', data });
});

module.exports = { paymentMethods, placeOrder, list, getOne, changeMethod, payOnline, payTest, uploadProof, receipt, cancel, received, sendFile };
