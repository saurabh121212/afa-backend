// PUBLIC location endpoints (no login): dropdowns, search and details.
const asyncHandler = require('../utils/asyncHandler');
const locationService = require('../services/location.service');

// GET /locations?type=region   |   GET /locations?parentId=<id>   (kept for older screens)
const list = asyncHandler(async (req, res) => {
  const data = await locationService.list(req.validated);
  res.json({ success: true, data });
});

// GET /locations/regions
const regions = asyncHandler(async (req, res) => {
  const data = await locationService.listRegions();
  res.json({ success: true, data });
});

// GET /locations/regions/:id/tinkhundla
const tinkhundla = asyncHandler(async (req, res) => {
  const { parent, items } = await locationService.listChildren(req.validated.id, 'region');
  res.json({ success: true, data: items, meta: { region: parent } });
});

// GET /locations/tinkhundla/:id/imiphakatsi
const imiphakatsi = asyncHandler(async (req, res) => {
  const { parent, items } = await locationService.listChildren(req.validated.id, 'inkhundla');
  res.json({ success: true, data: items, meta: { inkhundla: parent } });
});

// GET /locations/tree
const tree = asyncHandler(async (req, res) => {
  const data = await locationService.activeTree();
  res.json({ success: true, data });
});

// GET /locations/search?q=&type=&limit=
const search = asyncHandler(async (req, res) => {
  const data = await locationService.search(req.validated);
  res.json({ success: true, data });
});

// GET /locations/:id
const getById = asyncHandler(async (req, res) => {
  const data = await locationService.getById(req.validated.id);
  res.json({ success: true, data });
});

module.exports = { list, regions, tinkhundla, imiphakatsi, tree, search, getById };
