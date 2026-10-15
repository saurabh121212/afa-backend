// The logged-in user's bank & payment details. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/paymentMethod.service');

// GET /me/payment-methods
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.user) });
});

// POST /me/payment-methods
const create = asyncHandler(async (req, res) => {
  const data = await service.create(req.user, req.validated, req.body);
  res.status(201).json({ success: true, message: `${data.methodTypeLabel} added`, data });
});

// PUT /me/payment-methods/:id
const update = asyncHandler(async (req, res) => {
  const data = await service.update(req.user, req.validated.id, req.validated, req.body);
  res.json({ success: true, message: `${data.methodTypeLabel} updated`, data });
});

// PATCH /me/payment-methods/:id/primary
const setPrimary = asyncHandler(async (req, res) => {
  const data = await service.setPrimary(req.user, req.validated.id);
  res.json({ success: true, message: 'Primary payment method changed', data });
});

// DELETE /me/payment-methods/:id   (soft delete)
const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.user, req.validated.id);
  res.json({
    success: true,
    message: data.newPrimary ? 'Payment method removed. Your other method is now primary.' : 'Payment method removed',
    data,
  });
});

module.exports = { list, create, update, setPrimary, remove };
