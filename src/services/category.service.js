// PUBLIC category lookups (no login): marketplace tabs, listing forms, website filters.
// Only ACTIVE categories are listed. Deleted ones never appear (soft delete).
// A sub-category is only shown when its main category is active too.
const { Op } = require('sequelize');
const { Category } = require('../models');
const ApiError = require('../utils/ApiError');
const { APPLIES_TO_LABELS } = require('../config/categories');

// ---------- shared helpers (also used by adminCategory.service) ----------

// DB stores "public/categories/x.png" (relative to UPLOAD_DIR) -> URL "/uploads/categories/x.png"
function iconUrl(iconPath) {
  if (!iconPath) return null;
  return `/uploads/${String(iconPath).replace(/^public\//, '')}`;
}

// Main categories that show in a tab: their own value, or "both"
const appliesToFilter = (type) => (type ? { appliesTo: { [Op.in]: [type, 'both'] } } : {});

const ORDER = [
  ['sortOrder', 'ASC'],
  ['name', 'ASC'],
];

const notFound = (label = 'Category') => new ApiError(404, `${label} not found`, { code: 'CATEGORY_NOT_FOUND' });

// VAT: a sub-category with vatApplicable = null follows its main category.
// Pass the main category for a sub-category (null / missing main -> treated as "no VAT").
function isVatApplicable(c, main) {
  if (c.vatApplicable === true || c.vatApplicable === false) return c.vatApplicable;
  if (c.parentId && main) return main.vatApplicable === true;
  return false;
}

function vatLabel(c, main) {
  const yes = isVatApplicable(c, main);
  const text = yes ? 'VAT applicable' : 'Not VAT applicable';
  return c.parentId && (c.vatApplicable === null || c.vatApplicable === undefined) ? `Same as main category (${text})` : text;
}

// Public shape (no admin-only fields). For a sub-category pass its main category.
function toPublic(c, main = null) {
  const value = c.parentId ? main && main.appliesTo : c.appliesTo;
  return {
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    slug: c.slug,
    appliesTo: value || null,
    appliesToLabel: value ? APPLIES_TO_LABELS[value] : null,
    isVatApplicable: isVatApplicable(c, main),
    description: c.description,
    iconUrl: iconUrl(c.iconPath),
  };
}

// ---------- GET /categories?type=product|service ----------
// Active main categories with their active sub-categories (load once in the app and cache)
async function tree({ type } = {}) {
  const mains = await Category.findAll({
    where: { parentId: null, isActive: true, ...appliesToFilter(type) },
    order: ORDER,
  });
  if (!mains.length) return [];

  const subs = await Category.findAll({
    where: { parentId: mains.map((m) => m.id), isActive: true },
    order: ORDER,
  });
  const subsByParent = new Map();
  subs.forEach((s) => {
    if (!subsByParent.has(s.parentId)) subsByParent.set(s.parentId, []);
    subsByParent.get(s.parentId).push(s);
  });

  return mains.map((m) => ({
    ...toPublic(m),
    subCategories: (subsByParent.get(m.id) || []).map((s) => toPublic(s, m)),
  }));
}

// Active main category, or 404
async function findActiveMain(id) {
  const main = await Category.findOne({ where: { id, parentId: null, isActive: true } });
  if (!main) throw notFound('Main category');
  return main;
}

// ---------- GET /categories/:id/sub-categories ----------
async function listSubCategories(id) {
  const main = await findActiveMain(id);
  const subs = await Category.findAll({ where: { parentId: main.id, isActive: true }, order: ORDER });
  return {
    category: toPublic(main),
    items: subs.map((s) => toPublic(s, main)),
  };
}

// ---------- GET /categories/:id ----------
// One active category. Main -> with its sub-categories. Sub -> with its main category.
async function getById(id) {
  const category = await Category.findOne({ where: { id, isActive: true } });
  if (!category) throw notFound();

  if (!category.parentId) {
    const subs = await Category.findAll({ where: { parentId: category.id, isActive: true }, order: ORDER });
    return {
      ...toPublic(category),
      level: 'main',
      subCategories: subs.map((s) => toPublic(s, category)),
    };
  }

  const parent = await Category.findOne({ where: { id: category.parentId, isActive: true } });
  if (!parent) throw notFound(); // main category is disabled -> sub-category is hidden too
  return {
    ...toPublic(category, parent),
    level: 'sub',
    parent: toPublic(parent),
  };
}

module.exports = { tree, listSubCategories, getById, iconUrl, appliesToFilter, ORDER, isVatApplicable, vatLabel };
