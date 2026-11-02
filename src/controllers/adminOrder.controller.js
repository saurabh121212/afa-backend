// ADMIN: orders and the payment review queue. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/adminOrder.service');
const paymentService = require('../services/payment.service');
const { sendFile } = require('./order.controller');

const adminId = (req) => req.admin.id;

// ---------- orders ----------
const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await service.stats() }));
const list = asyncHandler(async (req, res) => res.json({ success: true, data: await service.list(req.validated) }));
const getOne = asyncHandler(async (req, res) => res.json({ success: true, data: await service.getById(req.validated.id) }));
const exportCsv = asyncHandler(async (req, res) => {
  const csv = await service.exportCsv(req.validated);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="afa-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ---------- payments ----------
const paymentStats = asyncHandler(async (req, res) => res.json({ success: true, data: await service.paymentStats() }));
const paymentList = asyncHandler(async (req, res) => res.json({ success: true, data: await service.listPayments(req.validated) }));
const paymentGet = asyncHandler(async (req, res) => res.json({ success: true, data: await service.getPayment(req.validated.id) }));

const paymentFile = asyncHandler(async (req, res, next) => {
  sendFile(res, next, await paymentService.receiptFile(req.validated.id));
});

const confirm = asyncHandler(async (req, res) => {
  const orderId = await paymentService.confirmBankTransfer(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: 'Payment confirmed. The order is paid and the sellers are notified.', data: await service.getById(orderId) });
});

const reject = asyncHandler(async (req, res) => {
  const orderId = await paymentService.rejectBankTransfer(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: 'Payment rejected. The buyer is asked to upload a new proof.', data: await service.getById(orderId) });
});

module.exports = { stats, list, getOne, exportCsv, paymentStats, paymentList, paymentGet, paymentFile, confirm, reject };
