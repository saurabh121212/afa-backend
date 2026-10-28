// System Settings (admin) + one place for the rest of the app to read them.
//
//   Admin screens : list(), update(), reset()
//   Other modules : get('vat_rate'), getAll()  -> always a valid value (default if never changed)
//
// Defaults live in config/settings.js; a row in "settings" exists only after the admin changes it.
// Values are kept in memory and refreshed whenever the admin saves (single API process).
const { SETTINGS, SETTING_GROUPS } = require('../config/settings');
const { Setting, Admin, sequelize } = require('../models');
const ApiError = require('../utils/ApiError');

let cache = null; // { key: value } for every setting

// A stored value that no longer fits the rules (e.g. a range was changed) falls back to the default
function clean(key, value) {
  const def = SETTINGS[key];
  if (def.type === 'boolean') return typeof value === 'boolean' ? value : def.default;
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n) || n < def.min || n > def.max) return def.default;
  return n;
}

async function getAll() {
  if (cache) return { ...cache };
  const rows = await Setting.findAll({ attributes: ['settingKey', 'value'] });
  const stored = Object.fromEntries(rows.map((r) => [r.settingKey, r.value]));
  const values = {};
  for (const key of Object.keys(SETTINGS)) {
    values[key] = key in stored ? clean(key, stored[key]) : SETTINGS[key].default;
  }
  cache = values;
  return { ...values };
}

// One value, e.g. await settings.get('vat_rate') -> 15
async function get(key) {
  if (!SETTINGS[key]) throw new Error(`Unknown setting "${key}"`);
  return (await getAll())[key];
}

function clearCache() {
  cache = null;
}

// ---------- Admin ----------

const valueLabel = (def, value) => {
  if (def.type === 'boolean') return value ? 'Yes' : 'No';
  return def.unit === '%' ? `${value}%` : `${value} ${def.unit || ''}`.trim();
};

function shape(key, value, row) {
  const def = SETTINGS[key];
  return {
    key,
    label: def.label,
    description: def.description,
    group: def.group,
    type: def.type,
    value,
    valueLabel: valueLabel(def, value),
    default: def.default,
    isDefault: value === def.default,
    ...(def.type === 'number' ? { min: def.min, max: def.max, decimals: def.decimals, unit: def.unit || null } : {}),
    updatedAt: row ? row.updatedAt : null,
    updatedBy: row && row.updatedByAdmin ? { id: row.updatedByAdmin.id, name: row.updatedByAdmin.name } : null,
  };
}

// GET /admin/settings -> grouped for the screen + a flat { key: value } map
async function list() {
  const [values, rows] = await Promise.all([
    getAll(),
    Setting.findAll({ include: [{ model: Admin, as: 'updatedByAdmin', attributes: ['id', 'name'] }] }),
  ]);
  const rowByKey = Object.fromEntries(rows.map((r) => [r.settingKey, r]));

  const groups = Object.entries(SETTING_GROUPS).map(([group, label]) => ({
    group,
    label,
    settings: Object.keys(SETTINGS)
      .filter((key) => SETTINGS[key].group === group)
      .map((key) => shape(key, values[key], rowByKey[key])),
  }));

  return { groups: groups.filter((g) => g.settings.length), values };
}

async function save(changes, adminId) {
  await sequelize.transaction(async (transaction) => {
    for (const [key, value] of Object.entries(changes)) {
      const row = await Setting.findOne({ where: { settingKey: key }, transaction, lock: transaction.LOCK.UPDATE });
      if (row) await row.update({ value, updatedBy: adminId }, { transaction });
      else await Setting.create({ settingKey: key, value, updatedBy: adminId }, { transaction });
    }
  });
  clearCache();
}

// PUT /admin/settings  { vat_rate: 15, vat_on_delivery_fee: false, ... }  (send only what changes)
async function update(data, adminId) {
  const changes = {};
  for (const key of Object.keys(SETTINGS)) {
    if (data[key] !== undefined) changes[key] = data[key];
  }
  if (!Object.keys(changes).length) {
    throw new ApiError(422, 'Send at least one setting to change', { code: 'NOTHING_TO_UPDATE' });
  }
  const before = await getAll();
  await save(changes, adminId);
  const after = await list();
  const changed = Object.keys(changes).filter((key) => before[key] !== after.values[key]);
  return { ...after, changed };
}

// POST /admin/settings/:key/reset -> back to the default value
async function reset(key, adminId) {
  await save({ [key]: SETTINGS[key].default }, adminId);
  const all = await list();
  const setting = all.groups.flatMap((g) => g.settings).find((s) => s.key === key);
  return setting;
}

module.exports = { get, getAll, clearCache, list, update, reset };
