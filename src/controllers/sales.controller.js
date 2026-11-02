// SELLER: orders received (My Sales). Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/sellerOrder.service');
const { SELLER_ORDER_STATUS_LABELS } = require('../config/orders');

const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await service.stats(req.user) }));
const list = asyncHandler(async (req, res) => res.json({ success: true, data: await service.list(req.user, req.validated) }));
const getOne = asyncHandler(async (req, res) => res.json({ success: true, data: await service.getOne(req.user, req.validated.id) }));

const setStatus = asyncHandler(async (req, res) => {
  const data = await service.setStatus(req.user, req.validated.id, req.validated);
  res.json({ success: true, message: `Order marked as ${SELLER_ORDER_STATUS_LABELS[req.validated.status]}`, data });
});

const exportCsv = asyncHandler(async (req, res) => {
  const csv = await service.exportCsv(req.user, req.validated);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="afa-my-sales-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

module.exports = { stats, list, getOne, setStatus, exportCsv };
