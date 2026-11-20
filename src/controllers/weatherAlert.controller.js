// Weather alerts: the admin writes them, logged-in users see the active ones for their region.
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/weatherAlert.service');

// regionIds may be null (= all of Eswatini), which matchedData drops, so it is read from the body.
const withRegions = (req) => ({
  ...req.validated,
  regionIds: Object.prototype.hasOwnProperty.call(req.body || {}, 'regionIds') ? req.body.regionIds : undefined,
});

// ---------- public ----------
// GET /weather/alerts
const publicList = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.publicActive() });
});

// ---------- logged-in user ----------
// GET /me/weather/alerts
const mine = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.forUser(req.user) });
});

// ---------- admin ----------
// GET /admin/weather/alerts
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.validated) });
});

// POST /admin/weather/alerts
const create = asyncHandler(async (req, res) => {
  const data = await service.create(withRegions(req), req.admin.id);
  res.status(201).json({ success: true, message: `Alert "${data.title}" saved`, data });
});

// PATCH /admin/weather/alerts/:id
const update = asyncHandler(async (req, res) => {
  const data = await service.update(req.validated.id, withRegions(req), req.admin.id);
  res.json({ success: true, message: `Alert "${data.title}" updated`, data });
});

// POST /admin/weather/alerts/:id/end
const end = asyncHandler(async (req, res) => {
  const data = await service.end(req.validated.id, req.admin.id);
  res.json({ success: true, message: `Alert "${data.title}" ended. Users no longer see it.`, data });
});

// DELETE /admin/weather/alerts/:id
const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.validated.id);
  res.json({ success: true, message: `Alert "${data.title}" deleted`, data });
});

module.exports = { publicList, mine, list, create, update, end, remove };
