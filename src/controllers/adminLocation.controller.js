// ADMIN location management endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/adminLocation.service');

// GET /admin/locations
const list = asyncHandler(async (req, res) => {
  const data = await service.list(req.validated);
  res.json({ success: true, data });
});

// GET /admin/locations/tree
const tree = asyncHandler(async (req, res) => {
  const includeInactive = req.validated.includeInactive !== false; // default: show all
  const data = await service.tree({ includeInactive });
  res.json({ success: true, data });
});

// GET /admin/locations/:id
const getById = asyncHandler(async (req, res) => {
  const data = await service.getById(req.validated.id);
  res.json({ success: true, data });
});

// POST /admin/locations
const create = asyncHandler(async (req, res) => {
  const { location, restored } = await service.create(req.validated);
  res.status(restored ? 200 : 201).json({
    success: true,
    message: restored ? `${location.name} was deleted before and has been restored` : `${location.name} added`,
    data: location,
  });
});

// PUT /admin/locations/:id
const rename = asyncHandler(async (req, res) => {
  const data = await service.rename(req.validated.id, req.validated);
  res.json({ success: true, message: 'Location renamed', data });
});

// PATCH /admin/locations/:id/status
const setStatus = asyncHandler(async (req, res) => {
  const data = await service.setStatus(req.validated.id, req.validated);
  const word = data.isActive ? 'enabled' : 'disabled';
  const extra = data.affectedCount > 1 ? ` (with ${data.affectedCount - 1} location(s) under it)` : '';
  res.json({ success: true, message: `${data.name} ${word}${extra}`, data });
});

// DELETE /admin/locations/:id   (soft delete)
const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.validated.id);
  const extra = data.deletedCount > 1 ? ` (with ${data.deletedCount - 1} location(s) under it)` : '';
  res.json({ success: true, message: `${data.name} deleted${extra}`, data });
});

// POST /admin/locations/import?dryRun=true   (form-data, field "file")
const importCsv = asyncHandler(async (req, res) => {
  const dryRun = req.validated.dryRun === true;
  const data = await service.importCsv(req.file.buffer, { dryRun });
  const created = data.created.regions + data.created.tinkhundla + data.created.imiphakatsi;
  res.json({
    success: true,
    message: dryRun
      ? `Preview only: ${created} location(s) would be added. Nothing was saved.`
      : `Import finished: ${created} location(s) added.`,
    data,
  });
});

// GET /admin/locations/import/template
const importTemplate = (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="afa-locations-template.csv"');
  res.send(service.importTemplate());
};

module.exports = { list, tree, getById, create, rename, setStatus, remove, importCsv, importTemplate };
