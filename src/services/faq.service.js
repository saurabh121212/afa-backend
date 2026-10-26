// CMS FAQs (Figma "Content Management" -> FAQs, "Add New FAQ", website "Help Centre").
//
//   FAQ categories: Getting Started, Payments & Delivery, Orders, Loans & Insurance... (admin manages them)
//   FAQs: question + answer in a category; hidden ones (isActive false) are not on the website.
//   view_count goes up each time someone opens an answer on the website -> "Most Viewed Category".
//   Delete = soft delete. A category can only be deleted when it has no FAQs left.
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const { Faq, FaqCategory } = require('../models');
const ApiError = require('../utils/ApiError');

const ORDER = [['sortOrder', 'ASC'], ['id', 'ASC']];
const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const faqNotFound = () => new ApiError(404, 'FAQ not found', { code: 'FAQ_NOT_FOUND' });
const categoryNotFound = () => new ApiError(404, 'FAQ category not found', { code: 'FAQ_CATEGORY_NOT_FOUND' });
const duplicate = (field, message) => new ApiError(409, message, { code: 'DUPLICATE_VALUE', errors: [{ field, message }] });
const sameText = (column, value) => sqlWhere(fn('LOWER', col(column)), clean(value).toLowerCase());

const faqShape = (f) => ({
  id: f.id,
  categoryId: f.categoryId,
  question: f.question,
  answer: f.answer,
  sortOrder: f.sortOrder,
  isActive: f.isActive,
  viewCount: f.viewCount,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});
const categoryShape = (c, extra = {}) => ({
  id: c.id,
  name: c.name,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
  ...extra,
});

// ======================= ADMIN: FAQs =======================

// GET /admin/faqs/stats   (Total FAQs / Categories / Most Viewed Category)
async function stats() {
  const [totalFaqs, categories, views] = await Promise.all([
    Faq.count(),
    FaqCategory.count(),
    Faq.findAll({
      attributes: ['categoryId', [fn('SUM', col('view_count')), 'views']],
      group: ['categoryId'],
      raw: true,
    }),
  ]);
  let mostViewedCategory = null;
  const top = views.map((v) => ({ id: v.categoryId, views: Number(v.views) })).sort((a, b) => b.views - a.views)[0];
  if (top && top.views > 0) {
    const cat = await FaqCategory.findByPk(top.id, { attributes: ['id', 'name'] });
    if (cat) mostViewedCategory = { id: cat.id, name: cat.name, views: top.views };
  }
  return { totalFaqs, categories, mostViewedCategory };
}

// GET /admin/faqs?search=&categoryId=&isActive=
// Grouped like the admin screen: each category with its questions.
async function list(query = {}) {
  const faqWhere = {};
  if (query.categoryId) faqWhere.categoryId = query.categoryId;
  if (typeof query.isActive === 'boolean') faqWhere.isActive = query.isActive;
  if (query.search) {
    const like = `%${query.search}%`;
    faqWhere[Op.or] = [{ question: { [Op.like]: like } }, { answer: { [Op.like]: like } }];
  }
  const [categories, faqs] = await Promise.all([
    FaqCategory.findAll({ where: query.categoryId ? { id: query.categoryId } : {}, order: ORDER }),
    Faq.findAll({ where: faqWhere, order: ORDER }),
  ]);
  const filtering = Boolean(query.search || typeof query.isActive === 'boolean');
  const items = categories
    .map((c) => {
      const own = faqs.filter((f) => f.categoryId === c.id);
      return categoryShape(c, { questionsCount: own.length, faqs: own.map(faqShape) });
    })
    .filter((c) => !filtering || c.faqs.length); // when searching, hide empty categories
  return { items, totalFaqs: faqs.length };
}

async function findFaq(id) {
  const faq = await Faq.findByPk(id, { include: [{ model: FaqCategory, as: 'category', attributes: ['id', 'name'] }] });
  if (!faq) throw faqNotFound();
  return faq;
}

// GET /admin/faqs/:id
async function getFaq(id) {
  const faq = await findFaq(id);
  return { ...faqShape(faq), category: faq.category ? { id: faq.category.id, name: faq.category.name } : null };
}

async function assertCategory(categoryId) {
  const cat = await FaqCategory.findByPk(categoryId);
  if (!cat) {
    throw new ApiError(422, 'Validation failed', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'categoryId', message: 'Choose an existing FAQ category' }],
    });
  }
  return cat;
}

// The same question can't be in a category twice (upper / lower case ignored)
async function assertUniqueQuestion(categoryId, question, excludeId = null) {
  const existing = await Faq.findOne({
    where: {
      categoryId,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      [Op.and]: [sameText('question', question)],
    },
  });
  if (existing) throw duplicate('question', 'This question already exists in this category');
}

// POST /admin/faqs   { categoryId, question, answer, sortOrder?, isActive? }
async function createFaq(data, adminId) {
  await assertCategory(data.categoryId);
  const question = clean(data.question);
  await assertUniqueQuestion(data.categoryId, question);
  const faq = await Faq.create({
    categoryId: data.categoryId,
    question,
    answer: String(data.answer).trim(),
    sortOrder: data.sortOrder !== undefined ? data.sortOrder : 0,
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdBy: adminId,
    updatedBy: adminId,
  });
  return getFaq(faq.id);
}

// PUT /admin/faqs/:id   (send only what changes)
async function updateFaq(id, data, adminId) {
  const faq = await findFaq(id);
  const values = {};
  if (data.categoryId !== undefined) {
    await assertCategory(data.categoryId);
    values.categoryId = data.categoryId;
  }
  if (data.question !== undefined) values.question = clean(data.question);
  if (data.answer !== undefined) values.answer = String(data.answer).trim();
  if (data.sortOrder !== undefined) values.sortOrder = data.sortOrder;
  if (data.isActive !== undefined) values.isActive = data.isActive;
  if (values.question !== undefined || values.categoryId !== undefined) {
    await assertUniqueQuestion(values.categoryId || faq.categoryId, values.question || faq.question, faq.id);
  }
  await faq.update({ ...values, updatedBy: adminId });
  return getFaq(id);
}

// PATCH /admin/faqs/:id/status   { isActive }  (hide / show on the Help Centre)
async function setFaqStatus(id, { isActive }, adminId) {
  const faq = await findFaq(id);
  await faq.update({ isActive, updatedBy: adminId });
  return getFaq(id);
}

// DELETE /admin/faqs/:id   (soft delete)
async function removeFaq(id) {
  const faq = await findFaq(id);
  await faq.destroy();
  return { id: faq.id, question: faq.question };
}

// ======================= ADMIN: categories =======================

// GET /admin/faq-categories
async function listCategories() {
  const [cats, counts] = await Promise.all([
    FaqCategory.findAll({ order: ORDER }),
    Faq.findAll({ attributes: ['categoryId', [fn('COUNT', col('id')), 'total']], group: ['categoryId'], raw: true }),
  ]);
  const byCat = new Map(counts.map((c) => [c.categoryId, Number(c.total)]));
  return cats.map((c) => categoryShape(c, { questionsCount: byCat.get(c.id) || 0 }));
}

async function findCategory(id) {
  const cat = await FaqCategory.findByPk(id);
  if (!cat) throw categoryNotFound();
  return cat;
}

async function assertUniqueCategory(name, excludeId = null) {
  const existing = await FaqCategory.findOne({
    where: { ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}), [Op.and]: [sameText('name', name)] },
  });
  if (existing) throw duplicate('name', `FAQ category "${existing.name}" already exists`);
}

// POST /admin/faq-categories   { name, sortOrder? }
async function createCategory(data) {
  const name = clean(data.name);
  await assertUniqueCategory(name);
  // A category deleted before with the same name is brought back
  const deleted = await FaqCategory.findOne({ where: { [Op.and]: [sameText('name', name)] }, paranoid: false });
  if (deleted) {
    await deleted.restore();
    await deleted.update({ name, isActive: true, ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}) });
    return { category: categoryShape(deleted, { questionsCount: 0 }), restored: true };
  }
  const cat = await FaqCategory.create({ name, sortOrder: data.sortOrder !== undefined ? data.sortOrder : 0 });
  return { category: categoryShape(cat, { questionsCount: 0 }), restored: false };
}

// PUT /admin/faq-categories/:id   { name?, sortOrder? }
async function updateCategory(id, data) {
  const cat = await findCategory(id);
  const values = {};
  if (data.name !== undefined) {
    values.name = clean(data.name);
    await assertUniqueCategory(values.name, cat.id);
  }
  if (data.sortOrder !== undefined) values.sortOrder = data.sortOrder;
  await cat.update(values);
  return categoryShape(cat);
}

// PATCH /admin/faq-categories/:id/status   { isActive }  (a hidden category hides all its FAQs on the website)
async function setCategoryStatus(id, { isActive }) {
  const cat = await findCategory(id);
  await cat.update({ isActive });
  return categoryShape(cat);
}

// DELETE /admin/faq-categories/:id   (soft; only when it has no FAQs)
async function removeCategory(id) {
  const cat = await findCategory(id);
  const count = await Faq.count({ where: { categoryId: cat.id } });
  if (count) {
    throw new ApiError(409, `"${cat.name}" still has ${count} FAQ(s). Move or delete them first.`, { code: 'HAS_FAQS' });
  }
  await cat.destroy();
  return { id: cat.id, name: cat.name };
}

// ======================= PUBLIC (Help Centre) =======================

// GET /faqs?search=   -> active categories with their active FAQs (empty categories are left out)
async function listPublic({ search } = {}) {
  const where = { isActive: true };
  if (search) {
    const like = `%${search}%`;
    where[Op.or] = [{ question: { [Op.like]: like } }, { answer: { [Op.like]: like } }];
  }
  const [cats, faqs] = await Promise.all([
    FaqCategory.findAll({ where: { isActive: true }, order: ORDER }),
    Faq.findAll({ where, order: ORDER, attributes: ['id', 'categoryId', 'question', 'answer', 'sortOrder'] }),
  ]);
  return cats
    .map((c) => ({
      id: c.id,
      name: c.name,
      faqs: faqs.filter((f) => f.categoryId === c.id).map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
    }))
    .filter((c) => c.faqs.length);
}

// POST /faqs/:id/view   (the website calls this when an answer is opened)
async function recordView(id) {
  const faq = await Faq.findOne({
    where: { id, isActive: true },
    include: [{ model: FaqCategory, as: 'category', attributes: [], where: { isActive: true }, required: true }],
  });
  if (!faq) throw faqNotFound();
  await Faq.increment('viewCount', { by: 1, where: { id: faq.id }, silent: true }); // doesn't change updatedAt
  return { id: faq.id };
}

module.exports = {
  stats,
  list,
  getFaq,
  createFaq,
  updateFaq,
  setFaqStatus,
  removeFaq,
  listCategories,
  createCategory,
  updateCategory,
  setCategoryStatus,
  removeCategory,
  listPublic,
  recordView,
};
