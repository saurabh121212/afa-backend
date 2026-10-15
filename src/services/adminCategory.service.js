// ADMIN category management: Main category -> Sub-category.
//
// Rules
//   - A main category has "appliesTo" (product | service | both). Sub-categories use their main's value.
//   - The same name can't appear twice under the same main category (or twice as a main category).
//     Upper / lower case is ignored.
//   - A sub-category can't be moved to another main category (create a new one instead).
//   - Disable / enable a main category also applies to its sub-categories.
//   - Delete = SOFT delete (deleted_at). A main category can only be deleted when it has
//     no sub-categories left. Categories used by listings can't be deleted (disable instead).
//   - Adding a name that was deleted before brings that row back (restore) instead of a new one.
const path = require('path');
const fs = require('fs/promises');
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const config = require('../config');
const { sequelize, Category } = require('../models');
const ApiError = require('../utils/ApiError');
const { parseCsv, toCsvLine } = require('../utils/csv');
const { fileMatchesKind, kindForMimeType, formatLabels } = require('../utils/fileTypes');
const {
  APPLIES_TO,
  APPLIES_TO_LABELS,
  CATEGORY_NAME_RULE,
  CATEGORY_NAME_MAX,
  CATEGORY_ICON,
  CATEGORY_IMPORT_MAX_ROWS,
} = require('../config/categories');
const { iconUrl, ORDER } = require('./category.service');

// Tables that point to a category (used by the "in use" check before delete).
// Listings count even when the listing itself was deleted (soft delete keeps the row).
const CATEGORY_USAGE = [{ table: 'listings', columns: ['category_id', 'sub_category_id'], label: 'listings' }];

// ---------- helpers ----------
const cleanName = (name) => String(name || '').trim().replace(/\s+/g, ' ');
const levelLabel = (parentId) => (parentId ? 'Sub-category' : 'Main category');
const notFound = () => new ApiError(404, 'Category not found', { code: 'CATEGORY_NOT_FOUND' });

const validationError = (field, message) =>
  new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors: [{ field, message }] });

// "Grains & Cereals" -> "grains-and-cereals"
function slugify(name) {
  const slug = cleanName(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // remove accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug || 'category';
}

// base, base-2, base-3 ... first one not in "used"
function pickSlug(base, used) {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// A slug no other category uses (also checks deleted ones, the column is unique)
async function slugFor(name, { excludeId = null, transaction } = {}) {
  const base = slugify(name);
  const rows = await Category.findAll({
    where: {
      slug: { [Op.like]: `${base}%` },
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
    attributes: ['slug'],
    paranoid: false,
    transaction,
  });
  return pickSlug(base, new Set(rows.map((r) => r.slug)));
}

// Same name under the same parent (case-insensitive). includeDeleted -> also soft-deleted rows.
function findSibling({ name, parentId, excludeId = null, includeDeleted = false, transaction }) {
  return Category.findOne({
    where: {
      parentId: parentId || null,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      [Op.and]: [sqlWhere(fn('LOWER', col('name')), cleanName(name).toLowerCase())],
    },
    paranoid: !includeDeleted,
    transaction,
  });
}

const duplicateError = (parentId, existingName) => {
  const msg = `${levelLabel(parentId)} "${existingName}" already exists${parentId ? ' under this main category' : ''}`;
  return new ApiError(409, msg, { code: 'DUPLICATE_VALUE', errors: [{ field: 'name', message: msg }] });
};

// Listings per category (not deleted, any status) -> Map(categoryId -> count)
async function listingCounts(ids) {
  const counts = new Map();
  if (!ids.length) return counts;
  const rows = await sequelize.query(
    `SELECT category_id AS id, COUNT(*) AS total FROM listings
      WHERE deleted_at IS NULL AND category_id IN (:ids) GROUP BY category_id
     UNION ALL
     SELECT sub_category_id AS id, COUNT(*) AS total FROM listings
      WHERE deleted_at IS NULL AND sub_category_id IN (:ids) GROUP BY sub_category_id`,
    { replacements: { ids }, type: sequelize.QueryTypes.SELECT }
  );
  rows.forEach((r) => counts.set(Number(r.id), (counts.get(Number(r.id)) || 0) + Number(r.total)));
  return counts;
}

// Admin shape. "appliesTo" of a sub-category = its main category's value.
function toAdmin(c, { mainAppliesTo, listings = 0 } = {}) {
  const value = c.parentId ? mainAppliesTo : c.appliesTo;
  return {
    id: c.id,
    parentId: c.parentId,
    level: c.parentId ? 'sub' : 'main',
    name: c.name,
    slug: c.slug,
    appliesTo: value || null,
    appliesToLabel: value ? APPLIES_TO_LABELS[value] : null,
    description: c.description,
    iconUrl: iconUrl(c.iconPath),
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    listingsCount: listings,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ---------- GET /admin/categories/stats ----------
async function stats() {
  const rows = await Category.findAll({ attributes: ['id', 'parentId', 'appliesTo', 'isActive'] });
  const mains = rows.filter((r) => !r.parentId);
  const subs = rows.filter((r) => r.parentId);
  const mainById = new Map(mains.map((m) => [m.id, m]));

  const forTab = (tab) => {
    const tabMains = mains.filter((m) => m.appliesTo === tab || m.appliesTo === 'both');
    const ids = new Set(tabMains.map((m) => m.id));
    return { mainCategories: tabMains.length, subCategories: subs.filter((s) => ids.has(s.parentId)).length };
  };

  return {
    mainCategories: mains.length,
    subCategories: subs.filter((s) => mainById.has(s.parentId)).length,
    inactive: rows.filter((r) => !r.isActive).length,
    products: forTab('product'),
    services: forTab('service'),
  };
}

// ---------- GET /admin/categories?type=&search=&isActive= ----------
// The tree for one tab: main categories, each with its sub-categories.
// Search: a matching main category shows all its sub-categories;
// otherwise only the matching sub-categories are shown under their main category.
async function list({ type, search, isActive } = {}) {
  const mainWhere = { parentId: null };
  if (type) mainWhere.appliesTo = { [Op.in]: [type, 'both'] };
  const mains = await Category.findAll({ where: mainWhere, order: ORDER });

  const subs = mains.length
    ? await Category.findAll({ where: { parentId: mains.map((m) => m.id) }, order: ORDER })
    : [];
  const counts = await listingCounts([...mains, ...subs].map((c) => c.id));

  const term = search ? search.toLowerCase() : null;
  const matches = (c) => !term || c.name.toLowerCase().includes(term);
  const statusOk = (c) => typeof isActive !== 'boolean' || c.isActive === isActive;

  const items = [];
  mains.forEach((m) => {
    const allSubs = subs.filter((s) => s.parentId === m.id);
    const mainHit = matches(m);
    const shownSubs = allSubs.filter((s) => statusOk(s) && (mainHit || matches(s)));
    if (!mainHit && !shownSubs.length) return; // nothing matches the search
    if (!statusOk(m) && !shownSubs.length) return; // status filter

    items.push({
      ...toAdmin(m, { listings: counts.get(m.id) || 0 }),
      subCategoriesCount: allSubs.length,
      subCategories: shownSubs.map((s) =>
        toAdmin(s, { mainAppliesTo: m.appliesTo, listings: counts.get(s.id) || 0 })
      ),
    });
  });

  return {
    items,
    totals: {
      mainCategories: items.length,
      subCategories: items.reduce((n, m) => n + m.subCategories.length, 0),
    },
  };
}

// ---------- GET /admin/categories/:id ----------
async function getById(id) {
  const category = await Category.findByPk(id);
  if (!category) throw notFound();

  if (!category.parentId) {
    const subs = await Category.findAll({ where: { parentId: category.id }, order: ORDER });
    return {
      ...toAdmin(category),
      subCategoriesCount: subs.length,
      subCategories: subs.map((s) => toAdmin(s, { mainAppliesTo: category.appliesTo })),
    };
  }

  const parent = await Category.findByPk(category.parentId);
  return {
    ...toAdmin(category, { mainAppliesTo: parent ? parent.appliesTo : null }),
    parent: parent ? toAdmin(parent) : null,
  };
}

// Main category for a new sub-category: must exist, be a main category and be active
async function loadParent(parentId, transaction) {
  const parent = await Category.findByPk(parentId, { transaction });
  if (!parent || parent.parentId) {
    throw validationError('parentId', 'Please select an existing main category');
  }
  if (!parent.isActive) {
    throw new ApiError(409, `${parent.name} is disabled. Enable it before adding sub-categories.`, {
      code: 'PARENT_DISABLED',
    });
  }
  return parent;
}

// ---------- POST /admin/categories ----------
//   Main category: { name, appliesTo, description?, sortOrder? }
//   Sub-category:  { name, parentId, description?, sortOrder? }   (appliesTo is ignored)
async function create({ name, parentId, appliesTo, description, sortOrder }) {
  const clean = cleanName(name);
  const isSub = Boolean(parentId);
  if (!isSub && !appliesTo) {
    throw validationError('appliesTo', `Please choose what this main category applies to: ${APPLIES_TO.join(', ')}`);
  }

  return sequelize.transaction(async (transaction) => {
    const parent = isSub ? await loadParent(parentId, transaction) : null;
    const pid = parent ? parent.id : null;

    // 1. Same name already here -> duplicate
    const active = await findSibling({ name: clean, parentId: pid, transaction });
    if (active) throw duplicateError(pid, active.name);

    const values = {
      name: clean,
      appliesTo: isSub ? null : appliesTo,
      ...(description !== undefined ? { description: description || null } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      isActive: true,
    };

    // 2. Same name was deleted before -> bring that row back
    const deleted = await findSibling({ name: clean, parentId: pid, includeDeleted: true, transaction });
    if (deleted) {
      await deleted.restore({ transaction });
      await deleted.update(values, { transaction });
      return { category: toAdmin(deleted, { mainAppliesTo: parent && parent.appliesTo }), restored: true };
    }

    const category = await Category.create(
      { ...values, parentId: pid, slug: await slugFor(clean, { transaction }) },
      { transaction }
    );
    return { category: toAdmin(category, { mainAppliesTo: parent && parent.appliesTo }), restored: false };
  });
}

// ---------- PUT /admin/categories/:id ----------
// Any of: name, appliesTo (main only), description, sortOrder
async function update(id, { name, appliesTo, description, sortOrder }) {
  return sequelize.transaction(async (transaction) => {
    const category = await Category.findByPk(id, { transaction });
    if (!category) throw notFound();
    const values = {};

    if (name !== undefined) {
      const clean = cleanName(name);
      if (clean !== category.name) {
        const duplicate = await findSibling({
          name: clean,
          parentId: category.parentId,
          excludeId: category.id,
          transaction,
        });
        if (duplicate) throw duplicateError(category.parentId, duplicate.name);
        values.name = clean;
        if (slugify(clean) !== slugify(category.name)) {
          values.slug = await slugFor(clean, { excludeId: category.id, transaction });
        }
      }
    }
    if (appliesTo !== undefined && !category.parentId) values.appliesTo = appliesTo;
    if (description !== undefined) values.description = description || null;
    if (sortOrder !== undefined) values.sortOrder = sortOrder;

    await category.update(values, { transaction });

    const parent = category.parentId ? await Category.findByPk(category.parentId, { transaction }) : null;
    return toAdmin(category, { mainAppliesTo: parent && parent.appliesTo });
  });
}

// ---------- POST /admin/categories/:id/icon ----------
const uploadRoot = () => path.resolve(config.upload.dir);
const removeFile = (fullPath) => fs.unlink(fullPath).catch(() => {}); // already gone -> fine

async function setIcon(id, file) {
  const category = await Category.findByPk(id);
  if (!category) {
    await removeFile(file.path);
    throw notFound();
  }

  // The first bytes must really be a PNG / JPG (a renamed file is refused)
  const kind = kindForMimeType(file.mimetype, CATEGORY_ICON.formats);
  if (!kind || !(await fileMatchesKind(file.path, kind))) {
    await removeFile(file.path);
    throw new ApiError(415, `This file is not a valid image. Allowed: ${formatLabels(CATEGORY_ICON.formats)}`, {
      code: 'INVALID_FILE_CONTENT',
    });
  }

  const oldPath = category.iconPath;
  const relativePath = path.relative(uploadRoot(), file.path).split(path.sep).join('/');
  await category.update({ iconPath: relativePath });

  // The old icon image is replaced, so its file is no longer needed
  if (oldPath && oldPath !== relativePath) {
    const full = path.resolve(uploadRoot(), oldPath);
    if (full.startsWith(uploadRoot() + path.sep)) await removeFile(full);
  }

  const parent = category.parentId ? await Category.findByPk(category.parentId) : null;
  return toAdmin(category, { mainAppliesTo: parent && parent.appliesTo });
}

// ---------- PATCH /admin/categories/:id/status ----------
// Main category -> also all its sub-categories. Sub-category -> only itself (main must be active).
async function setStatus(id, { isActive }) {
  const category = await Category.findByPk(id);
  if (!category) throw notFound();

  if (category.parentId && isActive) {
    const parent = await Category.findByPk(category.parentId);
    if (parent && !parent.isActive) {
      throw new ApiError(409, `${parent.name} is disabled. Enable the main category first.`, {
        code: 'PARENT_DISABLED',
      });
    }
  }

  return sequelize.transaction(async (transaction) => {
    const where = category.parentId
      ? { id: category.id }
      : { [Op.or]: [{ id: category.id }, { parentId: category.id }] };
    const [affected] = await Category.update({ isActive }, { where, transaction });
    return { id: category.id, name: category.name, level: category.parentId ? 'sub' : 'main', isActive, affectedCount: affected };
  });
}

// How many records use these category ids -> [{ label, count }]
async function usageOf(ids, transaction) {
  const usage = [];
  for (const { table, columns, label } of CATEGORY_USAGE) {
    const conditions = columns.map((c) => `\`${c}\` IN (:ids)`).join(' OR ');
    // eslint-disable-next-line no-await-in-loop
    const [rows] = await sequelize.query(`SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${conditions}`, {
      replacements: { ids },
      transaction,
    });
    const count = Number(rows[0].total);
    if (count) usage.push({ label, count });
  }
  return usage;
}

// ---------- DELETE /admin/categories/:id ----------
// SOFT delete. A main category needs all its sub-categories deleted first.
async function remove(id) {
  const category = await Category.findByPk(id);
  if (!category) throw notFound();

  return sequelize.transaction(async (transaction) => {
    if (!category.parentId) {
      const subCount = await Category.count({ where: { parentId: category.id }, transaction });
      if (subCount) {
        throw new ApiError(
          409,
          `${category.name} still has ${subCount} sub-categor${subCount === 1 ? 'y' : 'ies'}. Delete them first.`,
          { code: 'HAS_SUB_CATEGORIES', errors: [{ field: 'subCategories', message: `${subCount} sub-category(s)` }] }
        );
      }
    }

    const usage = await usageOf([category.id], transaction);
    if (usage.length) {
      const summary = usage.map((u) => `${u.count} ${u.label}`).join(', ');
      throw new ApiError(409, `This category is in use (${summary}). Disable it instead.`, {
        code: 'CATEGORY_IN_USE',
        errors: usage.map((u) => ({ field: u.label, message: `${u.count} record(s)` })),
      });
    }

    await category.destroy({ transaction }); // paranoid -> sets deleted_at
    return { id: category.id, name: category.name, level: category.parentId ? 'sub' : 'main' };
  });
}

// ======================= CSV IMPORT =======================
// Columns: Main Category, Sub-Category, Applies To
//   - A row with only a main category adds the main category.
//   - "Applies To" is needed for a NEW main category: product, service or both
//     (Products / Services / "Products & Services" also work).
//   - Every row is checked first. If any row is wrong, nothing is saved.

const APPLIES_TO_WORDS = {
  product: 'product',
  products: 'product',
  service: 'service',
  services: 'service',
  both: 'both',
  'products & services': 'both',
  'products and services': 'both',
  'product & service': 'both',
  'product and service': 'both',
};

// "Sub-Category", "sub category", "SubCategory" -> "subcategory"
const headerKey = (h) => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

function checkName(value, label, rowNo, errors) {
  if (!value) return;
  if (value.length > CATEGORY_NAME_MAX) {
    errors.push({ row: rowNo, message: `${label} "${value}" is longer than ${CATEGORY_NAME_MAX} characters` });
  } else if (!CATEGORY_NAME_RULE.test(value)) {
    errors.push({ row: rowNo, message: `${label} "${value}" has characters that are not allowed` });
  }
}

// Read + check every row. Returns { rows, mainAppliesTo: Map(lowerName -> value) }
function readImportRows(buffer) {
  let table;
  try {
    table = parseCsv(buffer.toString('utf8'));
  } catch (err) {
    throw new ApiError(422, err.message, { code: 'INVALID_CSV' });
  }
  if (!table.length) throw new ApiError(422, 'The CSV file is empty', { code: 'INVALID_CSV' });

  const header = table[0].map(headerKey);
  const col = {
    main: header.indexOf('maincategory'),
    sub: header.indexOf('subcategory'),
    appliesTo: header.indexOf('appliesto'),
  };
  if (col.main === -1 || col.sub === -1 || col.appliesTo === -1) {
    throw new ApiError(422, 'The first row must have the columns: Main Category, Sub-Category, Applies To', {
      code: 'INVALID_CSV_HEADER',
    });
  }

  const dataRows = table.slice(1);
  if (!dataRows.length) throw new ApiError(422, 'The CSV file has no data rows', { code: 'INVALID_CSV' });
  if (dataRows.length > CATEGORY_IMPORT_MAX_ROWS) {
    throw new ApiError(422, `The CSV file can have at most ${CATEGORY_IMPORT_MAX_ROWS} rows`, { code: 'INVALID_CSV' });
  }

  const errors = [];
  const mainAppliesTo = new Map(); // lower main name -> { value, row }
  const rows = dataRows.map((cells, i) => {
    const rowNo = i + 2; // row 1 is the header
    const main = cleanName(cells[col.main]);
    const sub = cleanName(cells[col.sub]);
    const rawApplies = cleanName(cells[col.appliesTo]).toLowerCase();

    if (!main) errors.push({ row: rowNo, message: 'Main Category is empty' });
    checkName(main, 'Main Category', rowNo, errors);
    checkName(sub, 'Sub-Category', rowNo, errors);

    let appliesTo = null;
    if (rawApplies) {
      appliesTo = APPLIES_TO_WORDS[rawApplies] || null;
      if (!appliesTo) {
        errors.push({ row: rowNo, message: `Applies To "${rawApplies}" is not valid. Use product, service or both` });
      } else if (main) {
        const seen = mainAppliesTo.get(main.toLowerCase());
        if (seen && seen.value !== appliesTo) {
          errors.push({
            row: rowNo,
            message: `"${main}" has Applies To "${appliesTo}" here but "${seen.value}" on row ${seen.row}`,
          });
        } else if (!seen) {
          mainAppliesTo.set(main.toLowerCase(), { value: appliesTo, row: rowNo });
        }
      }
    }
    return { rowNo, main, sub, appliesTo };
  });

  return { rows, mainAppliesTo, errors };
}

const rowErrorsResponse = (errors) =>
  new ApiError(422, `The CSV file has ${errors.length} problem(s). Nothing was imported.`, {
    code: 'CSV_ROW_ERRORS',
    errors: errors.slice(0, 200).map((e) => ({ field: `row ${e.row}`, message: e.message })),
  });

// dryRun = true -> only report what WOULD happen, save nothing
async function importCsv(buffer, { dryRun = false } = {}) {
  const { rows, mainAppliesTo, errors } = readImportRows(buffer);
  if (errors.length) throw rowErrorsResponse(errors);

  const transaction = await sequelize.transaction();
  try {
    // Every category, also deleted ones (a deleted name is brought back)
    const existing = await Category.findAll({ paranoid: false, transaction });
    const key = (parentId, name) => `${parentId || 0}|${name.toLowerCase()}`;
    const index = new Map(existing.map((c) => [key(c.parentId, c.name), c]));
    const usedSlugs = new Set(existing.map((c) => c.slug));

    // Checks that need the database: existing main categories vs. "Applies To" in the file
    const dbErrors = [];
    const reportedMain = new Set();
    rows.forEach((r) => {
      const lower = r.main.toLowerCase();
      if (reportedMain.has(lower)) return;
      const found = index.get(key(null, r.main));
      const given = mainAppliesTo.get(lower);
      if (found && !found.deletedAt) {
        if (given && found.appliesTo !== given.value) {
          reportedMain.add(lower);
          dbErrors.push({
            row: given.row,
            message: `"${found.name}" already exists with Applies To "${found.appliesTo}". Change it from the admin screen, not the CSV.`,
          });
        }
      } else if (!given) {
        reportedMain.add(lower);
        dbErrors.push({ row: r.rowNo, message: `"${r.main}" is a new main category: Applies To is required` });
      }
    });
    if (dbErrors.length) throw rowErrorsResponse(dbErrors);

    const report = {
      dryRun,
      totalRows: rows.length,
      created: { mainCategories: 0, subCategories: 0 },
      restored: 0,
      alreadyExisting: 0,
      skippedDisabled: [], // sub-categories whose main category is disabled
    };
    const handled = new Set(); // each category is counted once, even if it's on many rows
    let fakeId = 0; // ids for "would be created" rows in a dry run

    const ensure = async (parent, name, appliesTo) => {
      const k = key(parent ? parent.id : null, name);
      const found = index.get(k);
      if (handled.has(k)) return found;
      handled.add(k);

      if (found && !found.deletedAt) {
        report.alreadyExisting += 1;
        return found;
      }
      if (found && found.deletedAt) {
        report.restored += 1;
        const values = { isActive: true, ...(parent ? {} : { appliesTo }) };
        if (!dryRun) {
          await found.restore({ transaction });
          await found.update(values, { transaction });
        }
        Object.assign(found, values, { deletedAt: null });
        return found;
      }

      report.created[parent ? 'subCategories' : 'mainCategories'] += 1;
      const slug = pickSlug(slugify(name), usedSlugs);
      usedSlugs.add(slug);
      fakeId -= 1;
      const values = {
        name,
        slug,
        parentId: parent ? parent.id : null,
        appliesTo: parent ? null : appliesTo,
        isActive: true,
      };
      const row = dryRun ? { id: fakeId, ...values } : await Category.create(values, { transaction });
      index.set(k, row);
      return row;
    };

    /* eslint-disable no-await-in-loop, no-continue */
    for (const r of rows) {
      const given = mainAppliesTo.get(r.main.toLowerCase());
      const main = await ensure(null, r.main, given ? given.value : null);
      if (!r.sub) continue;
      if (!main.isActive) {
        report.skippedDisabled.push({ row: r.rowNo, message: `Main category "${main.name}" is disabled` });
        continue;
      }
      await ensure(main, r.sub, null);
    }
    /* eslint-enable no-await-in-loop, no-continue */

    if (dryRun) await transaction.rollback();
    else await transaction.commit();
    return report;
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    throw err;
  }
}

// ---------- GET /admin/categories/import/template ----------
function importTemplate() {
  return [
    toCsvLine(['Main Category', 'Sub-Category', 'Applies To']),
    toCsvLine(['Example Product Category', 'Example Sub-Category 1', 'product']),
    toCsvLine(['Example Product Category', 'Example Sub-Category 2', '']),
    toCsvLine(['Example Service Category', 'Example Service Sub-Category', 'service']),
    toCsvLine(['Example Category For Both', '', 'both']),
    '',
  ].join('\r\n');
}

module.exports = {
  stats,
  list,
  getById,
  create,
  update,
  setIcon,
  setStatus,
  remove,
  importCsv,
  importTemplate,
  // exported for tests
  slugify,
  pickSlug,
  readImportRows,
};
