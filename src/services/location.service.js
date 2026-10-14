// Location lookups for dropdowns + checking a Region -> Inkhundla -> Umphakatsi chain.
const { Op } = require('sequelize');
const { Location } = require('../models');
const ApiError = require('../utils/ApiError');

// GET /locations?type=region   or   GET /locations?parentId=5
async function list({ type, parentId }) {
  if (!type && !parentId) {
    throw new ApiError(422, 'Validation failed', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'type', message: 'Send either type=region or parentId=<id>' }],
    });
  }
  const where = { isActive: true };
  if (type) where.type = type;
  if (parentId) where.parentId = parentId;

  return Location.findAll({
    where,
    attributes: ['id', 'name', 'type', 'parentId'],
    order: [['name', 'ASC']],
  });
}

// ======================= PUBLIC LOOKUPS (no login) =======================
// Only ACTIVE locations are listed. Deleted ones never appear (soft delete).

const PUBLIC_ATTRS = ['id', 'name', 'type', 'parentId'];
const TYPE_LABEL = { region: 'Region', inkhundla: 'Inkhundla', umphakatsi: 'Umphakatsi' };

// GET /locations/regions
function listRegions() {
  return Location.findAll({
    where: { type: 'region', isActive: true },
    attributes: PUBLIC_ATTRS,
    order: [['name', 'ASC']],
  });
}

// GET /locations/regions/:id/tinkhundla      (parentType 'region')
// GET /locations/tinkhundla/:id/imiphakatsi  (parentType 'inkhundla')
// The parent must exist, be active and have the right type, otherwise 404.
async function listChildren(parentId, parentType) {
  const parent = await Location.findOne({
    where: { id: parentId, type: parentType, isActive: true },
    attributes: PUBLIC_ATTRS,
  });
  if (!parent) {
    throw new ApiError(404, `${TYPE_LABEL[parentType]} not found`, { code: 'LOCATION_NOT_FOUND' });
  }
  const items = await Location.findAll({
    where: { parentId, isActive: true },
    attributes: PUBLIC_ATTRS,
    order: [['name', 'ASC']],
  });
  return { parent, items };
}

// GET /locations/tree -> all active locations nested (apps can load it once and cache it)
async function activeTree() {
  const rows = await Location.findAll({
    where: { isActive: true },
    attributes: PUBLIC_ATTRS,
    order: [['name', 'ASC']],
  });
  const byId = new Map(rows.map((r) => [r.id, { ...r.toJSON(), children: [] }]));
  const regions = [];
  byId.forEach((node) => {
    if (node.type === 'region') regions.push(node);
    else if (byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
  });
  // Imiphakatsi have no children: remove the empty list to keep the response small
  byId.forEach((node) => {
    if (node.type === 'umphakatsi') delete node.children;
  });
  return regions;
}

// Builds { region, inkhundla, umphakatsi } + "Fonteyn, Mbabane East, Hhohho" for one location
function withChain(location) {
  const chain = [];
  for (let l = location; l; l = l.parent) chain.push(l);
  const byType = {};
  chain.forEach((l) => {
    byType[l.type] = { id: l.id, name: l.name };
  });
  return {
    id: location.id,
    name: location.name,
    type: location.type,
    parentId: location.parentId,
    isActive: location.isActive,
    region: byType.region || null,
    inkhundla: byType.inkhundla || null,
    umphakatsi: byType.umphakatsi || null,
    fullName: chain.map((l) => l.name).join(', '),
  };
}

const parentInclude = () => ({
  model: Location,
  as: 'parent',
  attributes: [...PUBLIC_ATTRS, 'isActive'],
  include: [{ model: Location, as: 'parent', attributes: [...PUBLIC_ATTRS, 'isActive'] }],
});

// GET /locations/:id -> one location with its Region / Inkhundla names.
// Disabled locations ARE returned (with isActive: false) so the app can still
// show the saved address of users registered there. Deleted ones are not.
async function getById(id) {
  const location = await Location.findByPk(id, {
    attributes: [...PUBLIC_ATTRS, 'isActive'],
    include: [parentInclude()],
  });
  if (!location) throw new ApiError(404, 'Location not found', { code: 'LOCATION_NOT_FOUND' });
  return withChain(location);
}

// GET /locations/search?q=mba&type=umphakatsi&limit=20 -> name search (autocomplete)
async function search({ q, type, limit = 20 }) {
  const where = { isActive: true, name: { [Op.like]: `%${q}%` } };
  if (type) where.type = type;
  const rows = await Location.findAll({
    where,
    attributes: [...PUBLIC_ATTRS, 'isActive'],
    include: [parentInclude()],
    order: [
      ['name', 'ASC'],
      ['type', 'ASC'],
    ],
    limit,
  });
  return rows.map(withChain);
}

// Checks that the selected ids exist, have the right type, and belong together.
//   ids    = { region: 1, inkhundla: 5, umphakatsi: 9 }  (any may be missing)
//   fields = { region: 'regionId', inkhundla: 'inkhundlaId', umphakatsi: 'umphakatsiId' }
// Throws 422 with a message per wrong field.
async function assertValidChain(ids, fields) {
  const wanted = [ids.region, ids.inkhundla, ids.umphakatsi].filter(Boolean);
  if (!wanted.length) return;

  const rows = await Location.findAll({ where: { id: wanted, isActive: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const errors = [];

  const region = ids.region ? byId.get(ids.region) : null;
  if (ids.region && (!region || region.type !== 'region')) {
    errors.push({ field: fields.region, message: 'Selected region does not exist' });
  }

  const inkhundla = ids.inkhundla ? byId.get(ids.inkhundla) : null;
  if (ids.inkhundla) {
    if (!inkhundla || inkhundla.type !== 'inkhundla') {
      errors.push({ field: fields.inkhundla, message: 'Selected Inkhundla does not exist' });
    } else if (!ids.region) {
      errors.push({ field: fields.region, message: 'Select a region first' });
    } else if (inkhundla.parentId !== ids.region) {
      errors.push({ field: fields.inkhundla, message: 'Inkhundla does not belong to the selected region' });
    }
  }

  const umphakatsi = ids.umphakatsi ? byId.get(ids.umphakatsi) : null;
  if (ids.umphakatsi) {
    if (!umphakatsi || umphakatsi.type !== 'umphakatsi') {
      errors.push({ field: fields.umphakatsi, message: 'Selected Umphakatsi does not exist' });
    } else if (!ids.inkhundla) {
      errors.push({ field: fields.inkhundla, message: 'Select an Inkhundla first' });
    } else if (umphakatsi.parentId !== ids.inkhundla) {
      errors.push({ field: fields.umphakatsi, message: 'Umphakatsi does not belong to the selected Inkhundla' });
    }
  }

  if (errors.length) {
    throw new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors });
  }
}

// Checks a list of REGION ids (e.g. logistics "regions served").
// Throws 422 naming the ids that are not active regions.
async function assertRegions(ids, field) {
  if (!ids || !ids.length) return;
  const rows = await Location.findAll({
    where: { id: ids, type: 'region', isActive: true },
    attributes: ['id'],
  });
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new ApiError(422, 'Validation failed', {
      code: 'VALIDATION_ERROR',
      errors: [{ field, message: `These are not valid regions: ${missing.join(', ')}` }],
    });
  }
}

module.exports = {
  list,
  listRegions,
  listChildren,
  activeTree,
  getById,
  search,
  assertValidChain,
  assertRegions,
};
