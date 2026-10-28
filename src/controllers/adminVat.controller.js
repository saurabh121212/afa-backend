// ADMIN: sellers' VAT registration. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/adminVat.service');

const adminId = (req) => req.admin.id;

const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await service.stats() }));
const list = asyncHandler(async (req, res) => res.json({ success: true, data: await service.list(req.validated) }));

const approve = asyncHandler(async (req, res) => {
  const data = await service.approve(req.validated.userId, adminId(req));
  res.json({ success: true, message: `${data.name || 'Seller'} is now VAT-registered`, data });
});

const reject = asyncHandler(async (req, res) => {
  const data = await service.reject(req.validated.userId, req.validated, adminId(req));
  res.json({ success: true, message: 'VAT registration rejected', data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.validated.userId, req.validated, adminId(req));
  res.json({ success: true, message: 'VAT registration removed', data });
});

module.exports = { stats, list, approve, reject, remove };
