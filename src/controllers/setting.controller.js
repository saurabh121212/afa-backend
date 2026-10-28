// System Settings (admin). Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/setting.service');

// GET /admin/settings
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list() });
});

// PUT /admin/settings
const update = asyncHandler(async (req, res) => {
  // The service only takes known setting keys from req.validated
  const result = await service.update(req.validated, req.admin.id);
  res.json({
    success: true,
    message: result.changed.length ? 'Settings saved' : 'No changes: the values are the same as before',
    data: result,
  });
});

// POST /admin/settings/:key/reset
const reset = asyncHandler(async (req, res) => {
  const data = await service.reset(req.validated.key, req.admin.id);
  res.json({ success: true, message: `${data.label} reset to ${data.valueLabel}`, data });
});

module.exports = { list, update, reset };
