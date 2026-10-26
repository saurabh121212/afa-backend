// CMS endpoints: banners + FAQs (admin and public). Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const bannerService = require('../services/banner.service');
const faqService = require('../services/faq.service');

const adminId = (req) => req.admin.id;

// ======================= ADMIN: banners =======================
const bannerStats = asyncHandler(async (req, res) => res.json({ success: true, data: await bannerService.stats() }));
const bannerList = asyncHandler(async (req, res) => res.json({ success: true, data: await bannerService.list(req.validated) }));
const bannerGet = asyncHandler(async (req, res) => res.json({ success: true, data: await bannerService.getById(req.validated.id) }));

const bannerCreate = asyncHandler(async (req, res) => {
  const data = await bannerService.create(req.validated, req.body, adminId(req));
  res.status(201).json({ success: true, message: 'Banner created. Now upload its image.', data });
});

const bannerUpdate = asyncHandler(async (req, res) => {
  const data = await bannerService.update(req.validated.id, req.validated, req.body, adminId(req));
  res.json({ success: true, message: 'Banner updated', data });
});

const bannerStatus = asyncHandler(async (req, res) => {
  const data = await bannerService.setStatus(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: data.isActive ? 'Banner switched on' : 'Banner switched off', data });
});

const bannerImage = asyncHandler(async (req, res) => {
  const data = await bannerService.setImage(req.validated.id, req.file, adminId(req));
  res.json({ success: true, message: 'Banner image uploaded', data });
});

const bannerRemove = asyncHandler(async (req, res) => {
  const data = await bannerService.remove(req.validated.id);
  res.json({ success: true, message: `Banner "${data.title}" deleted`, data });
});

// ======================= ADMIN: FAQs =======================
const faqStats = asyncHandler(async (req, res) => res.json({ success: true, data: await faqService.stats() }));
const faqList = asyncHandler(async (req, res) => res.json({ success: true, data: await faqService.list(req.validated) }));
const faqGet = asyncHandler(async (req, res) => res.json({ success: true, data: await faqService.getFaq(req.validated.id) }));

const faqCreate = asyncHandler(async (req, res) => {
  const data = await faqService.createFaq(req.validated, adminId(req));
  res.status(201).json({ success: true, message: 'FAQ saved', data });
});

const faqUpdate = asyncHandler(async (req, res) => {
  const data = await faqService.updateFaq(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: 'FAQ updated', data });
});

const faqStatus = asyncHandler(async (req, res) => {
  const data = await faqService.setFaqStatus(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: data.isActive ? 'FAQ is visible in the Help Centre' : 'FAQ hidden from the Help Centre', data });
});

const faqRemove = asyncHandler(async (req, res) => {
  const data = await faqService.removeFaq(req.validated.id);
  res.json({ success: true, message: 'FAQ deleted', data });
});

// ======================= ADMIN: FAQ categories =======================
const categoryList = asyncHandler(async (req, res) => res.json({ success: true, data: await faqService.listCategories() }));

const categoryCreate = asyncHandler(async (req, res) => {
  const { category, restored } = await faqService.createCategory(req.validated);
  res.status(restored ? 200 : 201).json({
    success: true,
    message: restored ? `"${category.name}" was deleted before and has been restored` : `FAQ category "${category.name}" added`,
    data: category,
  });
});

const categoryUpdate = asyncHandler(async (req, res) => {
  const data = await faqService.updateCategory(req.validated.id, req.validated);
  res.json({ success: true, message: 'FAQ category updated', data });
});

const categoryStatus = asyncHandler(async (req, res) => {
  const data = await faqService.setCategoryStatus(req.validated.id, req.validated);
  res.json({ success: true, message: data.isActive ? 'Category is visible' : 'Category and its FAQs are hidden', data });
});

const categoryRemove = asyncHandler(async (req, res) => {
  const data = await faqService.removeCategory(req.validated.id);
  res.json({ success: true, message: `FAQ category "${data.name}" deleted`, data });
});

// ======================= PUBLIC =======================
const publicBanners = asyncHandler(async (req, res) => res.json({ success: true, data: await bannerService.listPublic(req.validated) }));
const publicFaqs = asyncHandler(async (req, res) => res.json({ success: true, data: await faqService.listPublic(req.validated) }));
const faqView = asyncHandler(async (req, res) => res.json({ success: true, data: await faqService.recordView(req.validated.id) }));

module.exports = {
  bannerStats,
  bannerList,
  bannerGet,
  bannerCreate,
  bannerUpdate,
  bannerStatus,
  bannerImage,
  bannerRemove,
  faqStats,
  faqList,
  faqGet,
  faqCreate,
  faqUpdate,
  faqStatus,
  faqRemove,
  categoryList,
  categoryCreate,
  categoryUpdate,
  categoryStatus,
  categoryRemove,
  publicBanners,
  publicFaqs,
  faqView,
};
