// Saved delivery addresses of the logged-in user (/me/addresses). Input is already validated.
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/address.service');

// GET /me/addresses
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.user) });
});

// GET /me/addresses/:id
const getOne = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getOne(req.user, req.validated.id) });
});

// POST /me/addresses
const create = asyncHandler(async (req, res) => {
  const data = await service.create(req.user, req.validated);
  res.status(201).json({ success: true, message: `Address "${data.label}" saved`, data });
});

// PUT /me/addresses/:id
const update = asyncHandler(async (req, res) => {
  const data = await service.update(req.user, req.validated.id, req.validated, req.body);
  res.json({ success: true, message: 'Address updated', data });
});

// PATCH /me/addresses/:id/default
const setDefault = asyncHandler(async (req, res) => {
  const data = await service.setDefault(req.user, req.validated.id);
  res.json({ success: true, message: `"${data.label}" is now your default address`, data });
});

// DELETE /me/addresses/:id
const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.user, req.validated.id);
  res.json({
    success: true,
    message: data.newDefault ? `Address deleted. "${data.newDefault.label}" is now your default address.` : 'Address deleted',
    data,
  });
});

module.exports = { list, getOne, create, update, setDefault, remove };
