// Blog endpoints (admin and public). Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const blogService = require('../services/blog.service');

const adminId = (req) => req.admin.id;

// ======================= ADMIN =======================
const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await blogService.stats() }));
const list = asyncHandler(async (req, res) => res.json({ success: true, data: await blogService.list(req.validated) }));

const create = asyncHandler(async (req, res) => {
  const data = await blogService.create(req.validated, req.body, adminId(req));
  res.status(201).json({ success: true, message: data.status === 'published' ? 'Post published' : 'Post saved', data });
});

const update = asyncHandler(async (req, res) => {
  const data = await blogService.update(req.validated.id, req.validated, req.body, adminId(req));
  res.json({ success: true, message: 'Post updated', data });
});

const image = asyncHandler(async (req, res) => {
  const data = await blogService.setImage(req.validated.id, req.file, adminId(req));
  res.json({ success: true, message: 'Cover image uploaded', data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await blogService.remove(req.validated.id);
  res.json({ success: true, message: `Post "${data.title}" deleted`, data });
});

// ======================= PUBLIC =======================
const publicList = asyncHandler(async (req, res) => res.json({ success: true, data: await blogService.listPublic(req.validated) }));
const publicGet = asyncHandler(async (req, res) => res.json({ success: true, data: await blogService.getPublic(req.validated.slug) }));

module.exports = { stats, list, create, update, image, remove, publicList, publicGet };
