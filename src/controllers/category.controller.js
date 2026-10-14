// PUBLIC category endpoints (no login): marketplace tabs, listing forms, website filters.
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/category.service');

// GET /categories?type=product|service
const tree = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.tree(req.validated) });
});

// GET /categories/:id/sub-categories
const subCategories = asyncHandler(async (req, res) => {
  const { category, items } = await service.listSubCategories(req.validated.id);
  res.json({ success: true, data: items, meta: { category } });
});

// GET /categories/:id
const getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getById(req.validated.id) });
});

module.exports = { tree, subCategories, getById };
