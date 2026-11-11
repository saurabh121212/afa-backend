// Video Gallery endpoints (admin and public). Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const videoService = require('../services/video.service');

const adminId = (req) => req.admin.id;

// ======================= ADMIN =======================
const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await videoService.stats() }));
const list = asyncHandler(async (req, res) => res.json({ success: true, data: await videoService.list(req.validated) }));
const get = asyncHandler(async (req, res) => res.json({ success: true, data: await videoService.getById(req.validated.id) }));

const create = asyncHandler(async (req, res) => {
  const data = await videoService.create(req.validated, adminId(req));
  res.status(201).json({ success: true, message: data.isActive ? 'Video added to the gallery' : 'Video saved (hidden)', data });
});

const update = asyncHandler(async (req, res) => {
  const data = await videoService.update(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: 'Video updated', data });
});

const status = asyncHandler(async (req, res) => {
  const data = await videoService.setStatus(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: data.isActive ? 'Video is on the website' : 'Video hidden from the website', data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await videoService.remove(req.validated.id);
  res.json({ success: true, message: `Video "${data.title}" deleted`, data });
});

// ======================= PUBLIC =======================
const publicList = asyncHandler(async (req, res) => res.json({ success: true, data: await videoService.listPublic(req.validated) }));

module.exports = { stats, list, get, create, update, status, remove, publicList };
