// ADMIN category management endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/adminCategory.service');

const levelWord = (level) => (level === 'sub' ? 'Sub-category' : 'Main category');

// GET /admin/categories/stats
const stats = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.stats() });
});

// GET /admin/categories?type=product|service&search=&isActive=
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.validated) });
});

// GET /admin/categories/:id
const getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getById(req.validated.id) });
});

// POST /admin/categories
const create = asyncHandler(async (req, res) => {
  const { category, restored } = await service.create(req.validated);
  const what = `${levelWord(category.level)} "${category.name}"`;
  res.status(restored ? 200 : 201).json({
    success: true,
    message: restored ? `${what} was deleted before and has been restored` : `${what} added`,
    data: category,
  });
});

// PUT /admin/categories/:id
const update = asyncHandler(async (req, res) => {
  const data = await service.update(req.validated.id, req.validated);
  res.json({ success: true, message: `${levelWord(data.level)} updated`, data });
});

// POST /admin/categories/:id/icon   (form-data, field "file")
const setIcon = asyncHandler(async (req, res) => {
  const data = await service.setIcon(req.validated.id, req.file);
  res.json({ success: true, message: 'Category icon uploaded', data });
});

// PATCH /admin/categories/:id/status
const setStatus = asyncHandler(async (req, res) => {
  const data = await service.setStatus(req.validated.id, req.validated);
  const word = data.isActive ? 'enabled' : 'disabled';
  const extra = data.affectedCount > 1 ? ` (with ${data.affectedCount - 1} sub-category(s))` : '';
  res.json({ success: true, message: `${data.name} ${word}${extra}`, data });
});

// DELETE /admin/categories/:id   (soft delete)
const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.validated.id);
  res.json({ success: true, message: `${levelWord(data.level)} "${data.name}" deleted`, data });
});

// POST /admin/categories/import?dryRun=true   (form-data, field "file")
const importCsv = asyncHandler(async (req, res) => {
  const dryRun = req.validated.dryRun === true;
  const data = await service.importCsv(req.file.buffer, { dryRun });
  const added = data.created.mainCategories + data.created.subCategories;
  res.json({
    success: true,
    message: dryRun
      ? `Preview only: ${added} category(s) would be added. Nothing was saved.`
      : `Import finished: ${added} category(s) added.`,
    data,
  });
});

// GET /admin/categories/import/template
const importTemplate = (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="afa-categories-template.csv"');
  res.send(service.importTemplate());
};

module.exports = { stats, list, getById, create, update, setIcon, setStatus, remove, importCsv, importTemplate };
