// ADMIN location management: Region -> Inkhundla -> Umphakatsi.
//
// Rules
//   - Region has no parent; Inkhundla's parent is a Region; Umphakatsi's parent is an Inkhundla
//   - Same name can't appear twice under the same parent (upper/lower case ignored)
//   - Rename only: a location can't be moved to another parent
//   - Disable / enable also applies to everything under it
//   - Delete = SOFT delete (deleted_at), only when neither it nor anything under it is in use
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const { sequelize, Location } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { parseCsv, toCsvLine } = require('../utils/csv');

// Which parent type each type needs
const PARENT_TYPE = { region: null, inkhundla: 'region', umphakatsi: 'inkhundla' };
const TYPE_LABEL = { region: 'Region', inkhundla: 'Inkhundla', umphakatsi: 'Umphakatsi' };

// Every column in the system that points to a location (used by the "in use" check)
const LOCATION_USAGE = [
  { table: 'farmer_profiles', columns: ['region_id', 'inkhundla_id', 'umphakatsi_id'], label: 'farmers' },
  {
    table: 'farmer_profiles',
    columns: ['farm_region_id', 'farm_inkhundla_id', 'farm_umphakatsi_id'],
    label: 'farms',
  },
  { table: 'buyer_profiles', columns: ['region_id', 'inkhundla_id', 'umphakatsi_id'], label: 'buyers' },
  { table: 'trader_profiles', columns: ['region_id', 'inkhundla_id', 'umphakatsi_id'], label: 'traders' },
  {
    table: 'logistics_profiles',
    columns: ['region_id', 'inkhundla_id', 'umphakatsi_id'],
    label: 'logistics providers',
  },
  {
    table: 'fi_profiles',
    columns: ['region_id', 'inkhundla_id', 'umphakatsi_id'],
    label: 'financial institutions',
  },
  { table: 'logistics_coverage_regions', columns: ['region_id'], label: 'logistics coverage areas' },
  { table: 'fi_coverage_regions', columns: ['region_id'], label: 'financial institution coverage areas' },
];

// Clean a name: trim and collapse double spaces
const cleanName = (name) => String(name || '').trim().replace(/\s+/g, ' ');
const sameName = (a, b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

const notFound = () => new ApiError(404, 'Location not found', { code: 'LOCATION_NOT_FOUND' });

// Number of (not deleted) children, added as "childrenCount" on list rows
const childrenCountAttr = [
  sequelize.literal(
    '(SELECT COUNT(*) FROM locations AS c WHERE c.parent_id = `Location`.`id` AND c.deleted_at IS NULL)'
  ),
  'childrenCount',
];

// All ids below a location (children, grandchildren). Not including the location itself.
async function descendantIds(id, transaction) {
  const ids = [];
  let level = [id];
  while (level.length) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await Location.findAll({
      where: { parentId: level },
      attributes: ['id'],
      transaction,
    });
    level = rows.map((r) => r.id);
    ids.push(...level);
  }
  return ids;
}

// Find a sibling with the same name (case-insensitive). paranoid:false -> also deleted ones.
async function findSibling({ name, type, parentId, excludeId = null, includeDeleted = false, transaction }) {
  return Location.findOne({
    where: {
      type,
      parentId: parentId || null,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      [Op.and]: [sqlWhere(fn('LOWER', col('name')), cleanName(name).toLowerCase())],
    },
    paranoid: !includeDeleted,
    transaction,
  });
}

// ---------- GET /admin/locations ----------
async function list(query) {
  const pg = getPagination(query);
  const where = {};
  if (query.type) where.type = query.type;
  if (query.parentId) where.parentId = query.parentId;
  if (typeof query.isActive === 'boolean') where.isActive = query.isActive;
  if (query.search) where.name = { [Op.like]: `%${query.search}%` };

  const { rows, count } = await Location.findAndCountAll({
    where,
    attributes: { include: [childrenCountAttr] },
    include: [{ model: Location, as: 'parent', attributes: ['id', 'name', 'type'] }],
    order: [
      ['type', 'ASC'],
      ['name', 'ASC'],
    ],
    limit: pg.limit,
    offset: pg.offset,
    distinct: true,
  });

  return {
    items: rows.map((r) => {
      const json = r.toJSON();
      json.childrenCount = Number(json.childrenCount);
      return json;
    }),
    pagination: paginationMeta(pg, count),
  };
}

// ---------- GET /admin/locations/tree ----------
async function tree({ includeInactive = true } = {}) {
  const rows = await Location.findAll({
    where: includeInactive ? {} : { isActive: true },
    attributes: ['id', 'name', 'type', 'parentId', 'isActive'],
    order: [['name', 'ASC']],
  });

  const byId = new Map(rows.map((r) => [r.id, { ...r.toJSON(), children: [] }]));
  const regions = [];
  byId.forEach((node) => {
    if (node.type === 'region') regions.push(node);
    else if (byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
  });

  return {
    totals: {
      regions: rows.filter((r) => r.type === 'region').length,
      tinkhundla: rows.filter((r) => r.type === 'inkhundla').length,
      imiphakatsi: rows.filter((r) => r.type === 'umphakatsi').length,
    },
    regions,
  };
}

// ---------- GET /admin/locations/:id ----------
async function getById(id) {
  const location = await Location.findByPk(id, {
    include: [
      { model: Location, as: 'parent', attributes: ['id', 'name', 'type', 'isActive'] },
      { model: Location, as: 'children', attributes: ['id', 'name', 'type', 'isActive'] },
    ],
    order: [[{ model: Location, as: 'children' }, 'name', 'ASC']],
  });
  if (!location) throw notFound();
  return location.toJSON();
}

// ---------- POST /admin/locations ----------
async function create({ name, type, parentId }) {
  const clean = cleanName(name);
  const neededParentType = PARENT_TYPE[type];

  // Parent rules
  let parent = null;
  if (neededParentType === null) {
    if (parentId) {
      throw new ApiError(422, 'Validation failed', {
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'parentId', message: 'A region cannot have a parent' }],
      });
    }
  } else {
    if (!parentId) {
      throw new ApiError(422, 'Validation failed', {
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'parentId', message: `Please select the ${TYPE_LABEL[neededParentType]} for this ${TYPE_LABEL[type]}` }],
      });
    }
    parent = await Location.findByPk(parentId);
    if (!parent || parent.type !== neededParentType) {
      throw new ApiError(422, 'Validation failed', {
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'parentId', message: `The parent of an ${TYPE_LABEL[type]} must be a ${TYPE_LABEL[neededParentType]}` }],
      });
    }
    if (!parent.isActive) {
      throw new ApiError(409, `${parent.name} is disabled. Enable it before adding to it.`, {
        code: 'PARENT_DISABLED',
      });
    }
  }

  return sequelize.transaction(async (transaction) => {
    // 1. An active one with the same name -> duplicate
    const active = await findSibling({ name: clean, type, parentId, transaction });
    if (active) {
      throw new ApiError(409, `${TYPE_LABEL[type]} "${active.name}" already exists here`, {
        code: 'DUPLICATE_VALUE',
        errors: [{ field: 'name', message: `${TYPE_LABEL[type]} "${active.name}" already exists here` }],
      });
    }

    // 2. Same name was deleted before -> bring that row back instead of a new one
    const deleted = await findSibling({ name: clean, type, parentId, includeDeleted: true, transaction });
    if (deleted) {
      await deleted.restore({ transaction });
      await deleted.update({ name: clean, isActive: true }, { transaction });
      return { location: deleted.toJSON(), restored: true };
    }

    const location = await Location.create(
      { name: clean, type, parentId: parent ? parent.id : null, isActive: true },
      { transaction }
    );
    return { location: location.toJSON(), restored: false };
  });
}

// ---------- PUT /admin/locations/:id ----------
async function rename(id, { name }) {
  const location = await Location.findByPk(id);
  if (!location) throw notFound();
  const clean = cleanName(name);

  const duplicate = await findSibling({
    name: clean,
    type: location.type,
    parentId: location.parentId,
    excludeId: location.id,
  });
  if (duplicate) {
    throw new ApiError(409, `${TYPE_LABEL[location.type]} "${duplicate.name}" already exists here`, {
      code: 'DUPLICATE_VALUE',
      errors: [{ field: 'name', message: `${TYPE_LABEL[location.type]} "${duplicate.name}" already exists here` }],
    });
  }

  await location.update({ name: clean });
  return location.toJSON();
}

// ---------- PATCH /admin/locations/:id/status ----------
// Disable / enable a location AND everything under it.
async function setStatus(id, { isActive }) {
  const location = await Location.findByPk(id, {
    include: [{ model: Location, as: 'parent', attributes: ['id', 'name', 'isActive'] }],
  });
  if (!location) throw notFound();

  if (isActive && location.parent && !location.parent.isActive) {
    throw new ApiError(409, `${location.parent.name} is disabled. Enable it first.`, {
      code: 'PARENT_DISABLED',
    });
  }

  return sequelize.transaction(async (transaction) => {
    const childIds = await descendantIds(location.id, transaction);
    const ids = [location.id, ...childIds];
    const [affected] = await Location.update({ isActive }, { where: { id: ids }, transaction });
    return {
      id: location.id,
      name: location.name,
      isActive,
      affectedCount: affected, // this location + everything under it
    };
  });
}

// How many records use any of these location ids -> [{ label, count }]
async function usageOf(ids, transaction) {
  const usage = [];
  for (const { table, columns, label } of LOCATION_USAGE) {
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

// ---------- DELETE /admin/locations/:id ----------
// SOFT delete of the location and everything under it, only when nothing uses them.
async function remove(id) {
  const location = await Location.findByPk(id);
  if (!location) throw notFound();

  return sequelize.transaction(async (transaction) => {
    const childIds = await descendantIds(location.id, transaction);
    const ids = [location.id, ...childIds];

    const usage = await usageOf(ids, transaction);
    if (usage.length) {
      const summary = usage.map((u) => `${u.count} ${u.label}`).join(', ');
      throw new ApiError(409, `This location is in use (${summary}). Disable it instead.`, {
        code: 'LOCATION_IN_USE',
        errors: usage.map((u) => ({ field: u.label, message: `${u.count} record(s)` })),
      });
    }

    await Location.destroy({ where: { id: ids }, transaction }); // paranoid -> sets deleted_at
    return { id: location.id, name: location.name, deletedCount: ids.length };
  });
}

// ---------- POST /admin/locations/import (CSV) ----------
const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}\s'().,/-]*$/u;
const MAX_IMPORT_ROWS = 5000;

function checkName(value, label, rowNo, errors) {
  if (!value) return;
  if (value.length > 100) errors.push({ row: rowNo, message: `${label} "${value}" is longer than 100 characters` });
  else if (!NAME_RULE.test(value)) errors.push({ row: rowNo, message: `${label} "${value}" has characters that are not allowed` });
}

// Read + check every row first. Nothing is saved if any row is wrong.
function readImportRows(buffer) {
  let table;
  try {
    table = parseCsv(buffer.toString('utf8'));
  } catch (err) {
    throw new ApiError(422, err.message, { code: 'INVALID_CSV' });
  }
  if (!table.length) throw new ApiError(422, 'The CSV file is empty', { code: 'INVALID_CSV' });

  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = {
    region: header.indexOf('region'),
    inkhundla: header.indexOf('inkhundla'),
    umphakatsi: header.indexOf('umphakatsi'),
  };
  if (col.region === -1 || col.inkhundla === -1 || col.umphakatsi === -1) {
    throw new ApiError(422, 'The first row must have the columns: Region, Inkhundla, Umphakatsi', {
      code: 'INVALID_CSV_HEADER',
    });
  }

  const dataRows = table.slice(1);
  if (!dataRows.length) throw new ApiError(422, 'The CSV file has no data rows', { code: 'INVALID_CSV' });
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new ApiError(422, `The CSV file can have at most ${MAX_IMPORT_ROWS} rows`, { code: 'INVALID_CSV' });
  }

  const errors = [];
  const rows = dataRows.map((cells, i) => {
    const rowNo = i + 2; // row 1 is the header
    const region = cleanName(cells[col.region]);
    const inkhundla = cleanName(cells[col.inkhundla]);
    const umphakatsi = cleanName(cells[col.umphakatsi]);

    if (!region) errors.push({ row: rowNo, message: 'Region is empty' });
    if (umphakatsi && !inkhundla) errors.push({ row: rowNo, message: 'Umphakatsi needs an Inkhundla' });
    checkName(region, 'Region', rowNo, errors);
    checkName(inkhundla, 'Inkhundla', rowNo, errors);
    checkName(umphakatsi, 'Umphakatsi', rowNo, errors);
    return { rowNo, region, inkhundla, umphakatsi };
  });

  if (errors.length) {
    throw new ApiError(422, `The CSV file has ${errors.length} problem(s). Nothing was imported.`, {
      code: 'CSV_ROW_ERRORS',
      errors: errors.slice(0, 200).map((e) => ({ field: `row ${e.row}`, message: e.message })),
    });
  }
  return rows;
}

// dryRun = true -> only report what WOULD happen, save nothing
async function importCsv(buffer, { dryRun = false } = {}) {
  const rows = readImportRows(buffer);

  const transaction = await sequelize.transaction();
  try {
    // All existing locations, also deleted ones (a deleted name is brought back)
    const existing = await Location.findAll({ paranoid: false, transaction });
    const key = (type, parentId, name) => `${type}|${parentId || 0}|${name.toLowerCase()}`;
    const index = new Map(existing.map((l) => [key(l.type, l.parentId, l.name), l]));

    const report = {
      dryRun,
      totalRows: rows.length,
      created: { regions: 0, tinkhundla: 0, imiphakatsi: 0 },
      restored: 0,
      alreadyExisting: 0,
      skippedDisabled: [], // rows whose parent is disabled
    };
    const createdLabel = { region: 'regions', inkhundla: 'tinkhundla', umphakatsi: 'imiphakatsi' };
    const handled = new Set(); // each location is counted once, even if it's on many rows
    let fakeId = 0; // ids for "would be created" rows in a dry run

    // Find or create one location; returns the row (or a stand-in in dry run)
    const ensure = async (type, parent, name) => {
      const k = key(type, parent ? parent.id : null, name);
      const found = index.get(k);
      if (handled.has(k)) return found;
      handled.add(k);

      if (found && !found.deletedAt) {
        report.alreadyExisting += 1;
        return found;
      }
      if (found && found.deletedAt) {
        report.restored += 1;
        if (!dryRun) {
          await found.restore({ transaction });
          await found.update({ isActive: true }, { transaction });
        }
        found.deletedAt = null;
        found.isActive = true;
        return found;
      }
      report.created[createdLabel[type]] += 1;
      fakeId -= 1;
      const row = dryRun
        ? { id: fakeId, type, name, isActive: true }
        : await Location.create({ name, type, parentId: parent ? parent.id : null, isActive: true }, { transaction });
      index.set(k, row);
      return row;
    };

    /* eslint-disable no-await-in-loop, no-continue */
    for (const r of rows) {
      const region = await ensure('region', null, r.region);
      if (!r.inkhundla) continue;
      if (!region.isActive) {
        report.skippedDisabled.push({ row: r.rowNo, message: `Region "${region.name}" is disabled` });
        continue;
      }

      const ink = await ensure('inkhundla', region, r.inkhundla);
      if (!r.umphakatsi) continue;
      if (!ink.isActive) {
        report.skippedDisabled.push({ row: r.rowNo, message: `Inkhundla "${ink.name}" is disabled` });
        continue;
      }

      await ensure('umphakatsi', ink, r.umphakatsi);
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

// ---------- GET /admin/locations/import/template ----------
function importTemplate() {
  return [
    toCsvLine(['Region', 'Inkhundla', 'Umphakatsi']),
    toCsvLine(['Hhohho', 'Mbabane East', 'Example Umphakatsi 1']),
    toCsvLine(['Hhohho', 'Mbabane East', 'Example Umphakatsi 2']),
    toCsvLine(['Manzini', 'Example Inkhundla', '']),
    '',
  ].join('\r\n');
}

module.exports = { list, tree, getById, create, rename, setStatus, remove, importCsv, importTemplate };
