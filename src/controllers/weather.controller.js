// Weather endpoints (public, /me and admin). Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/weather.service');

// ---------- public ----------
// GET /weather/locations?regionId=
const listLocations = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listLocations(req.validated) });
});

// GET /weather/locations/:id
const forLocation = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.forLocation(req.validated.id) });
});

// ---------- logged-in user ----------
// GET /me/weather
const mine = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.forUser(req.user) });
});

// ---------- admin ----------
// GET /admin/weather/status
const status = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.status() });
});

// GET /admin/weather/runs
const runs = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listRuns(req.validated) });
});

// GET /admin/weather/locations
const coordinates = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listCoordinates(req.validated) });
});

// PATCH /admin/weather/locations/:id/coordinates
const setCoordinates = asyncHandler(async (req, res) => {
  const { id, latitude, longitude } = req.validated;
  const data = await service.setCoordinates(id, { latitude, longitude });
  const cleared = latitude === null || latitude === undefined;
  res.json({
    success: true,
    message: cleared
      ? `Coordinates of ${data.location.name} cleared`
      : `Coordinates of ${data.location.name} saved${data.refreshing ? '. Its weather is being updated now.' : ''}`,
    data,
  });
});

// POST /admin/weather/refresh
const refresh = asyncHandler(async (req, res) => {
  const data = await service.startRefresh(req.validated);
  res.status(202).json({
    success: true,
    message: `Weather refresh started for ${data.points} place(s). It takes about ${Math.max(1, Math.ceil(data.estimatedSeconds / 60))} minute(s).`,
    data,
  });
});

module.exports = { listLocations, forLocation, mine, status, runs, coordinates, setCoordinates, refresh };
