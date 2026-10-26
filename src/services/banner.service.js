// CMS Banners (Figma "Content Management" -> Banners) - admin management + public display.
//
// Status is worked out from the on/off switch and the dates:
//   inactive  -> switched off by the admin
//   scheduled -> on, start date in the future
//   expired   -> on, end date passed
//   active    -> on, started, not ended  -> shown on the website (only when it has an image)
const path = require('path');
const fs = require('fs/promises');
const { Op } = require('sequelize');
const config = require('../config');
const { Banner } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { fileMatchesKind, kindForMimeType, formatLabels } = require('../utils/fileTypes');
const { BANNER_PLACEMENTS, BANNER_IMAGE } = require('../config/cms');

const notFound = () => new ApiError(404, 'Banner not found', { code: 'BANNER_NOT_FOUND' });
const imageUrl = (p) => (p ? `/uploads/${String(p).replace(/^public\//, '')}` : null);

function statusOf(b, now = new Date()) {
  if (!b.isActive) return 'inactive';
  if (b.startsAt && new Date(b.startsAt) > now) return 'scheduled';
  if (b.endsAt && new Date(b.endsAt) < now) return 'expired';
  return 'active';
}
const STATUS_LABELS = { active: 'Active', scheduled: 'Scheduled', expired: 'Expired', inactive: 'Inactive' };

// SQL conditions for each status (same rules as statusOf)
function statusWhere(status, now = new Date()) {
  const started = { [Op.or]: [{ startsAt: null }, { startsAt: { [Op.lte]: now } }] };
  const notEnded = { [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gte]: now } }] };
  switch (status) {
    case 'inactive':
      return { isActive: false };
    case 'scheduled':
      return { isActive: true, startsAt: { [Op.gt]: now } };
    case 'expired':
      return { isActive: true, endsAt: { [Op.lt]: now } };
    case 'active':
      return { isActive: true, [Op.and]: [started, notEnded] };
    default:
      return {};
  }
}

function toAdmin(b) {
  const status = statusOf(b);
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    buttonText: b.buttonText,
    linkUrl: b.linkUrl,
    placement: b.placement,
    placementLabel: BANNER_PLACEMENTS[b.placement] || b.placement,
    imageUrl: imageUrl(b.imagePath),
    startsAt: b.startsAt,
    endsAt: b.endsAt, // null = "No end date"
    isActive: b.isActive,
    sortOrder: b.sortOrder,
    status,
    statusLabel: STATUS_LABELS[status],
    visibleOnWebsite: status === 'active' && Boolean(b.imagePath),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

const toPublic = (b) => ({
  id: b.id,
  title: b.title,
  subtitle: b.subtitle,
  buttonText: b.buttonText,
  linkUrl: b.linkUrl,
  placement: b.placement,
  imageUrl: imageUrl(b.imagePath),
  sortOrder: b.sortOrder,
});

// End date must be after the start date (using saved values for whatever wasn't sent)
function checkDates(startsAt, endsAt) {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new ApiError(422, 'Validation failed', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'endsAt', message: 'End date must be after the start date' }],
    });
  }
}

// ======================= ADMIN =======================

// GET /admin/banners/stats   (Total / Active / Scheduled / Expired cards)
async function stats() {
  const now = new Date();
  const [total, active, scheduled, expired, inactive] = await Promise.all([
    Banner.count(),
    Banner.count({ where: statusWhere('active', now) }),
    Banner.count({ where: statusWhere('scheduled', now) }),
    Banner.count({ where: statusWhere('expired', now) }),
    Banner.count({ where: statusWhere('inactive', now) }),
  ]);
  return { totalBanners: total, active, scheduled, expired, inactive };
}

// GET /admin/banners?placement=&status=&search=&page=&limit=
async function list(query) {
  const pg = getPagination(query);
  const where = { ...statusWhere(query.status) };
  if (query.placement) where.placement = query.placement;
  if (query.search) where.title = { [Op.like]: `%${query.search}%` };

  const { rows, count } = await Banner.findAndCountAll({
    where,
    order: [['placement', 'ASC'], ['sortOrder', 'ASC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map(toAdmin), pagination: paginationMeta(pg, count) };
}

async function findOr404(id, transaction) {
  const banner = await Banner.findByPk(id, { transaction });
  if (!banner) throw notFound();
  return banner;
}

// GET /admin/banners/:id
const getById = async (id) => toAdmin(await findOr404(id));

const FIELDS = ['title', 'subtitle', 'buttonText', 'linkUrl', 'placement', 'startsAt', 'endsAt', 'isActive', 'sortOrder'];
const CLEARABLE = ['subtitle', 'buttonText', 'linkUrl', 'startsAt', 'endsAt'];

function pickValues(data, rawBody) {
  const values = {};
  FIELDS.forEach((f) => {
    if (data[f] !== undefined) values[f] = data[f];
  });
  CLEARABLE.forEach((f) => {
    if (rawBody[f] === null || rawBody[f] === '') values[f] = null;
  });
  return values;
}

// POST /admin/banners   (then POST /admin/banners/:id/image to add the picture)
async function create(data, rawBody, adminId) {
  const values = pickValues(data, rawBody);
  checkDates(values.startsAt, values.endsAt);
  const banner = await Banner.create({ ...values, createdBy: adminId, updatedBy: adminId });
  return toAdmin(banner);
}

// PUT /admin/banners/:id   (send only what changes; null clears subtitle / button / link / dates)
async function update(id, data, rawBody, adminId) {
  const banner = await findOr404(id);
  const values = pickValues(data, rawBody);
  const pick = (f) => (values[f] !== undefined ? values[f] : banner[f]);
  checkDates(pick('startsAt'), pick('endsAt'));
  await banner.update({ ...values, updatedBy: adminId });
  return toAdmin(banner);
}

// PATCH /admin/banners/:id/status   { isActive }
async function setStatus(id, { isActive }, adminId) {
  const banner = await findOr404(id);
  await banner.update({ isActive, updatedBy: adminId });
  return toAdmin(banner);
}

// POST /admin/banners/:id/image   (form-data "file")
const uploadRoot = () => path.resolve(config.upload.dir);
const removeFile = (full) => fs.unlink(full).catch(() => {});

async function setImage(id, file, adminId) {
  const banner = await Banner.findByPk(id);
  if (!banner) {
    await removeFile(file.path);
    throw notFound();
  }
  const kind = kindForMimeType(file.mimetype, BANNER_IMAGE.formats);
  if (!kind || !(await fileMatchesKind(file.path, kind))) {
    await removeFile(file.path);
    throw new ApiError(415, `This file is not a valid image. Allowed: ${formatLabels(BANNER_IMAGE.formats)}`, {
      code: 'INVALID_FILE_CONTENT',
    });
  }
  const oldPath = banner.imagePath;
  const relative = path.relative(uploadRoot(), file.path).split(path.sep).join('/');
  await banner.update({ imagePath: relative, updatedBy: adminId });
  // The replaced picture file is no longer used
  if (oldPath && oldPath !== relative) {
    const full = path.resolve(uploadRoot(), oldPath);
    if (full.startsWith(uploadRoot() + path.sep)) await removeFile(full);
  }
  return toAdmin(banner);
}

// DELETE /admin/banners/:id   (soft delete; the image file is kept)
async function remove(id) {
  const banner = await findOr404(id);
  await banner.destroy();
  return { id: banner.id, title: banner.title };
}

// ======================= PUBLIC =======================

// GET /banners?placement=homepage_hero   -> only banners live right now, with an image, in display order
async function listPublic({ placement } = {}) {
  const rows = await Banner.findAll({
    where: { ...statusWhere('active'), imagePath: { [Op.ne]: null }, ...(placement ? { placement } : {}) },
    order: [['placement', 'ASC'], ['sortOrder', 'ASC'], ['id', 'DESC']],
  });
  return rows.map(toPublic);
}

module.exports = {
  stats,
  list,
  getById,
  create,
  update,
  setStatus,
  setImage,
  remove,
  listPublic,
  statusOf,
};
