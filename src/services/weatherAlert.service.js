// Weather alerts written by the admin (Admin › Settings › Weather › Alerts).
//
// Status (worked out from the dates, never stored):
//   upcoming -> starts in the future
//   active   -> started, not ended (shown to users)
//   ended    -> end time passed, or the admin ended it early (ended_at)
//
// Users see the ACTIVE alerts that cover their region (profile region, and a farmer's farm region).
// An alert without regions covers all of Eswatini; a user without a region only sees those.
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');

const { WeatherAlert, Location, Admin } = models;

const SEVERITY_LABELS = { advisory: 'Advisory', warning: 'Warning', severe: 'Severe' };
const STATUS_LABELS = { upcoming: 'Upcoming', active: 'Active', ended: 'Ended' };
const MAX_DAYS = 30; // longest an alert can run
const PROFILE_MODELS = { farmer: 'FarmerProfile', buyer: 'BuyerProfile', trader: 'TraderProfile', logistics: 'LogisticsProfile', financial_institution: 'FiProfile' };

function statusOf(a, now = new Date()) {
  if (a.endedAt || new Date(a.endsAt) <= now) return 'ended';
  if (new Date(a.startsAt) > now) return 'upcoming';
  return 'active';
}

const regionList = (ids) => (Array.isArray(ids) && ids.length ? ids.map(Number) : null);

async function regionNames() {
  const rows = await Location.findAll({ where: { type: 'region' }, attributes: ['id', 'name'], paranoid: false });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function shape(a, names, { admin = false } = {}) {
  const ids = regionList(a.regionIds);
  const status = statusOf(a);
  const out = {
    id: a.id,
    title: a.title,
    severity: a.severity,
    severityLabel: SEVERITY_LABELS[a.severity],
    message: a.message,
    allRegions: !ids,
    regions: ids ? ids.map((id) => ({ id, name: names.get(id) || `Region #${id}` })) : [],
    startsAt: a.startsAt,
    endsAt: a.endedAt && new Date(a.endedAt) < new Date(a.endsAt) ? a.endedAt : a.endsAt,
    status,
    statusLabel: STATUS_LABELS[status],
    updatedAt: a.updatedAt,
  };
  if (admin) {
    out.plannedEndsAt = a.endsAt;
    out.endedEarlyAt = a.endedAt;
    out.createdAt = a.createdAt;
    out.createdBy = a.createdByAdmin ? { id: a.createdByAdmin.id, name: a.createdByAdmin.name } : null;
  }
  return out;
}

// Most severe first, then the one ending soonest
const SEVERITY_ORDER = { severe: 0, warning: 1, advisory: 2 };
const bySeverity = (x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || new Date(x.endsAt) - new Date(y.endsAt);

// ---------- validation shared by create / update ----------
async function checkRegions(ids) {
  const list = regionList(ids);
  if (!list) return null;
  const unique = [...new Set(list)];
  const found = await Location.findAll({ where: { id: unique, type: 'region' }, attributes: ['id'] });
  if (found.length !== unique.length) {
    throw new ApiError(422, 'Validation failed', { errors: [{ field: 'regionIds', message: 'Choose regions from the list' }] });
  }
  return unique;
}

function checkWindow(startsAt, endsAt, { isNew }) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const errors = [];
  if (end <= start) errors.push({ field: 'endsAt', message: 'The end must be after the start' });
  else if ((end - start) / 86400000 > MAX_DAYS) errors.push({ field: 'endsAt', message: `An alert can run for at most ${MAX_DAYS} days` });
  if (isNew && end <= new Date()) errors.push({ field: 'endsAt', message: 'The end must be in the future' });
  if (errors.length) throw new ApiError(422, 'Validation failed', { errors });
}

async function findAlert(id) {
  const alert = await WeatherAlert.findByPk(id, { include: [{ model: Admin, as: 'createdByAdmin', attributes: ['id', 'name'] }] });
  if (!alert) throw new ApiError(404, 'Weather alert not found', { code: 'WEATHER_ALERT_NOT_FOUND' });
  return alert;
}

// ======================= PUBLIC =======================
// GET /weather/alerts   every active alert (the public website: visitors have no region)
async function publicActive() {
  const now = new Date();
  const rows = await WeatherAlert.findAll({
    where: { startsAt: { [Op.lte]: now }, endsAt: { [Op.gt]: now }, endedAt: null },
  });
  const names = await regionNames();
  const items = rows.map((a) => shape(a, names)).sort(bySeverity);
  return { count: items.length, items };
}

// ======================= USERS =======================
// GET /me/weather/alerts
async function forUser(user) {
  const Model = models[PROFILE_MODELS[user.userType]];
  const profile = Model ? await Model.findOne({ where: { userId: user.id } }) : null;
  const mine = new Set([profile?.regionId, profile?.farmRegionId].filter(Boolean).map(Number));

  const now = new Date();
  const rows = await WeatherAlert.findAll({
    where: { startsAt: { [Op.lte]: now }, endsAt: { [Op.gt]: now }, endedAt: null },
  });
  const names = await regionNames();
  const items = rows
    .filter((a) => {
      const ids = regionList(a.regionIds);
      return !ids || ids.some((id) => mine.has(id));
    })
    .map((a) => shape(a, names))
    .sort(bySeverity);
  return { count: items.length, items };
}

// ======================= ADMIN =======================
// GET /admin/weather/alerts?status=&page=&limit=
async function list({ status, page, limit } = {}) {
  const now = new Date();
  const where = {};
  if (status === 'active') Object.assign(where, { startsAt: { [Op.lte]: now }, endsAt: { [Op.gt]: now }, endedAt: null });
  if (status === 'upcoming') Object.assign(where, { startsAt: { [Op.gt]: now }, endedAt: null });
  if (status === 'ended') where[Op.or] = [{ endsAt: { [Op.lte]: now } }, { endedAt: { [Op.ne]: null } }];

  const p = getPagination({ page, limit });
  const { rows, count } = await WeatherAlert.findAndCountAll({
    where,
    include: [{ model: Admin, as: 'createdByAdmin', attributes: ['id', 'name'] }],
    order: [['startsAt', 'DESC'], ['id', 'DESC']],
    limit: p.limit,
    offset: p.offset,
  });
  const names = await regionNames();

  // Counts for the filter tabs
  const [active, upcoming] = await Promise.all([
    WeatherAlert.count({ where: { startsAt: { [Op.lte]: now }, endsAt: { [Op.gt]: now }, endedAt: null } }),
    WeatherAlert.count({ where: { startsAt: { [Op.gt]: now }, endedAt: null } }),
  ]);

  return {
    items: rows.map((a) => shape(a, names, { admin: true })),
    counts: { active, upcoming },
    severities: Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label })),
    maxDays: MAX_DAYS,
    pagination: paginationMeta(p, count),
  };
}

// POST /admin/weather/alerts
async function create(data, adminId) {
  checkWindow(data.startsAt, data.endsAt, { isNew: true });
  const regionIds = await checkRegions(data.regionIds);
  const alert = await WeatherAlert.create({
    title: data.title,
    severity: data.severity,
    message: data.message,
    regionIds,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    createdBy: adminId,
    updatedBy: adminId,
  });
  return shape(await findAlert(alert.id), await regionNames(), { admin: true });
}

// PATCH /admin/weather/alerts/:id
async function update(id, data, adminId) {
  const alert = await findAlert(id);
  if (statusOf(alert) === 'ended') {
    throw new ApiError(409, 'This alert has ended and can no longer be changed', { code: 'WEATHER_ALERT_ENDED' });
  }
  const startsAt = data.startsAt ?? alert.startsAt;
  const endsAt = data.endsAt ?? alert.endsAt;
  checkWindow(startsAt, endsAt, { isNew: data.endsAt !== undefined });
  const patch = { updatedBy: adminId };
  ['title', 'severity', 'message', 'startsAt', 'endsAt'].forEach((k) => {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  if (data.regionIds !== undefined) patch.regionIds = await checkRegions(data.regionIds);
  await alert.update(patch);
  return shape(await findAlert(id), await regionNames(), { admin: true });
}

// POST /admin/weather/alerts/:id/end   (stop showing it now)
async function end(id, adminId) {
  const alert = await findAlert(id);
  if (statusOf(alert) === 'ended') {
    throw new ApiError(409, 'This alert has already ended', { code: 'WEATHER_ALERT_ENDED' });
  }
  await alert.update({ endedAt: new Date(), updatedBy: adminId });
  return shape(await findAlert(id), await regionNames(), { admin: true });
}

// DELETE /admin/weather/alerts/:id
async function remove(id) {
  const alert = await findAlert(id);
  await alert.destroy();
  return { id: alert.id, title: alert.title };
}

module.exports = { publicActive, forUser, list, create, update, end, remove, SEVERITY_LABELS, MAX_DAYS };
