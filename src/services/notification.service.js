// NOTIFICATIONS: the bell (in-app) + push to the user's devices. Nothing can be switched off.
//
// Other services call (after their change is saved; these NEVER throw and never slow the request):
//   notify.toUser(userId, { type, title, body, data })     -> one user (bell + push)
//   notify.toUsers(userIds, { ... })                       -> several users
//   notify.toAdmins({ type, title, body, data })           -> every admin's bell (no push)
//
//   type  -> one of config/notifications TYPES (it sets the category)
//   data  -> what the app needs to open the right screen, e.g. { screen: 'order', orderId: 12 }
//
// Users:  GET /me/notifications, unread count, read one / all, hide one, register / remove a device.
// Admins: the same bell at /admin/notifications.
// Notifications are kept for good; "delete" only hides one for that user.
const models = require('../models');
const ApiError = require('../utils/ApiError');
const push = require('./push.service');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { CATEGORIES, TYPES, PUSH_STATUS } = require('../config/notifications');

const { Notification, DeviceToken, Admin } = models;
const CHUNK = 500;

const clip = (s, n) => {
  const t = String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const chunks = (list, size = CHUNK) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const log = (label) => (err) => console.error(`Notification failed (${label}):`, err.message);

function rowFor(payload) {
  const category = TYPES[payload.type];
  if (!category) throw new Error(`Unknown notification type "${payload.type}"`);
  return {
    category,
    type: payload.type,
    title: clip(payload.title, 150),
    body: clip(payload.body, 1000) || clip(payload.title, 150),
    data: payload.data || null,
    broadcastId: payload.broadcastId || null,
  };
}

// ---------- push ----------
async function unreadCounts(userIds) {
  if (!userIds.length) return new Map();
  const rows = await Notification.count({ where: { userId: userIds, readAt: null }, group: ['userId'] });
  return new Map(rows.map((r) => [r.userId || r.user_id, Number(r.count)]));
}

// Push the given (already saved) notifications to their users' devices; updates push_status.
// -> { sent, failed }
async function pushNotifications(notifications) {
  if (!notifications.length) return { sent: 0, failed: 0 };
  const ids = notifications.map((n) => n.id);
  if (!push.isReady()) {
    await Notification.update({ pushStatus: PUSH_STATUS.OFF }, { where: { id: ids } });
    return { sent: 0, failed: 0 };
  }
  const userIds = [...new Set(notifications.map((n) => n.userId))];
  const [devices, badges] = await Promise.all([
    DeviceToken.findAll({ where: { userId: userIds }, attributes: ['id', 'userId', 'token', 'platform'] }),
    unreadCounts(userIds),
  ]);
  const byUser = new Map();
  devices.forEach((d) => byUser.set(d.userId, [...(byUser.get(d.userId) || []), d]));

  let sent = 0;
  let failed = 0;
  const status = { sent: [], failed: [], none: [] };
  const dead = [];
  const errors = new Map();
  for (const n of notifications) {
    const list = byUser.get(n.userId) || [];
    if (!list.length) {
      status.none.push(n.id);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const out = await push.sendToDevices(list, {
      title: n.title,
      body: n.body,
      data: { notificationId: n.id, type: n.type, category: n.category, ...(n.data || {}) },
      badge: badges.get(n.userId) || 0,
    });
    sent += out.sent;
    failed += out.failed;
    (out.sent ? status.sent : status.failed).push(n.id);
    out.results.forEach((r) => {
      if (r.dead) dead.push(r.id);
      else if (!r.ok) errors.set(r.id, r.error);
    });
  }
  const now = new Date();
  await Promise.all([
    status.sent.length ? Notification.update({ pushStatus: PUSH_STATUS.SENT, pushedAt: now }, { where: { id: status.sent } }) : null,
    status.failed.length ? Notification.update({ pushStatus: PUSH_STATUS.FAILED, pushedAt: now }, { where: { id: status.failed } }) : null,
    status.none.length ? Notification.update({ pushStatus: PUSH_STATUS.NO_DEVICE }, { where: { id: status.none } }) : null,
    // Dead tokens: Firebase no longer knows them -> removed (soft)
    dead.length ? DeviceToken.update({ lastError: 'Token no longer valid (removed)' }, { where: { id: dead } }).then(() => DeviceToken.destroy({ where: { id: dead } })) : null,
    ...[...errors.entries()].map(([id, error]) => DeviceToken.update({ lastError: error }, { where: { id } })),
  ]);
  return { sent, failed };
}

// ---------- creating ----------
// Save for many users at once (in chunks), then push. Returns the saved rows.
async function createForUsers(userIds, payload, { pushNow = true } = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return [];
  const base = rowFor(payload);
  const saved = [];
  for (const part of chunks(ids)) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await Notification.bulkCreate(part.map((userId) => ({ ...base, recipientType: 'user', userId })));
    saved.push(...rows);
  }
  if (pushNow) await pushNotifications(saved);
  return saved;
}

// The three entry points used by the rest of the code: never throw
function toUsers(userIds, payload) {
  return createForUsers(userIds, payload).catch(log(payload.type));
}
const toUser = (userId, payload) => toUsers([userId], payload);

async function createForAdmins(payload) {
  const admins = await Admin.findAll({ attributes: ['id'] });
  if (!admins.length) return [];
  const base = rowFor(payload);
  return Notification.bulkCreate(admins.map((a) => ({ ...base, recipientType: 'admin', adminId: a.id, pushStatus: PUSH_STATUS.OFF })));
}
function toAdmins(payload) {
  return createForAdmins(payload).catch(log(payload.type));
}

// ---------- the bell (users and admins) ----------
// viewer = { type: 'user' | 'admin', id }
const ownerWhere = (viewer) => (viewer.type === 'admin' ? { recipientType: 'admin', adminId: viewer.id } : { recipientType: 'user', userId: viewer.id });

function shape(n) {
  return {
    id: n.id,
    type: n.type,
    category: n.category,
    categoryLabel: CATEGORIES[n.category],
    title: n.title,
    body: n.body,
    data: n.data || {},
    isRead: Boolean(n.readAt),
    readAt: n.readAt,
    broadcastId: n.broadcastId,
    createdAt: n.createdAt,
  };
}

async function counts(viewer) {
  const rows = await Notification.count({ where: { ...ownerWhere(viewer), readAt: null }, group: ['category'] });
  const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, 0]));
  rows.forEach((r) => {
    byCategory[r.category] = Number(r.count);
  });
  return { unreadCount: Object.values(byCategory).reduce((s, v) => s + v, 0), byCategory };
}

// GET .../notifications?category=&unread=true&page=&limit=
async function list(viewer, query = {}) {
  const pg = getPagination(query);
  const where = { ...ownerWhere(viewer) };
  if (query.category) where.category = query.category;
  if (query.unread === true) where.readAt = null;
  const [{ rows, count }, c] = await Promise.all([
    Notification.findAndCountAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: pg.limit, offset: pg.offset }),
    counts(viewer),
  ]);
  return { items: rows.map(shape), ...c, pagination: paginationMeta(pg, count) };
}

// GET .../notifications/unread-count
const unreadCount = (viewer) => counts(viewer);

async function findOwn(viewer, id) {
  const n = await Notification.findOne({ where: { id, ...ownerWhere(viewer) } });
  if (!n) throw new ApiError(404, 'Notification not found', { code: 'NOTIFICATION_NOT_FOUND' });
  return n;
}

// POST .../notifications/:id/read
async function markRead(viewer, id) {
  const n = await findOwn(viewer, id);
  if (!n.readAt) await n.update({ readAt: new Date() });
  return { notification: shape(n), ...(await counts(viewer)) };
}

// POST .../notifications/read-all   { category? }
async function markAllRead(viewer, { category } = {}) {
  const where = { ...ownerWhere(viewer), readAt: null };
  if (category) where.category = category;
  const [updated] = await Notification.update({ readAt: new Date() }, { where });
  return { updated, ...(await counts(viewer)) };
}

// DELETE .../notifications/:id   (hidden for this user; kept in the database)
async function hide(viewer, id) {
  const n = await findOwn(viewer, id);
  await n.destroy();
  return counts(viewer);
}

// ---------- devices (users) ----------
const deviceShape = (d) => ({
  id: d.id,
  platform: d.platform,
  deviceName: d.deviceName,
  appVersion: d.appVersion,
  token: `${String(d.token).slice(0, 12)}…${String(d.token).slice(-6)}`,
  lastSeenAt: d.lastSeenAt,
  createdAt: d.createdAt,
});

// POST /me/devices   { token, platform, deviceName?, appVersion? }
// Call after every login and whenever Firebase gives the app a new token. A token used before by
// another account on the same phone moves to this user.
async function registerDevice(user, { token, platform, deviceName = null, appVersion = null }) {
  const now = new Date();
  const values = { userId: user.id, platform, deviceName, appVersion, lastSeenAt: now, lastError: null };
  const existing = await DeviceToken.findOne({ where: { token }, paranoid: false });
  let device;
  if (existing) {
    if (existing.deletedAt) await existing.restore();
    device = await existing.update(values);
  } else {
    device = await DeviceToken.create({ ...values, token });
  }
  return { device: deviceShape(device), pushEnabled: push.isReady() };
}

// DELETE /me/devices   { token }   (call on logout, BEFORE the token is thrown away)
async function removeDevice(user, { token }) {
  const n = await DeviceToken.destroy({ where: { token, userId: user.id } });
  if (!n) throw new ApiError(404, 'Device not found', { code: 'DEVICE_NOT_FOUND' });
}

// GET /me/devices
async function listDevices(user) {
  const rows = await DeviceToken.findAll({ where: { userId: user.id }, order: [['lastSeenAt', 'DESC']] });
  return { items: rows.map(deviceShape), pushEnabled: push.isReady() };
}

module.exports = {
  toUser,
  toUsers,
  toAdmins,
  createForUsers,
  pushNotifications,
  list,
  unreadCount,
  markRead,
  markAllRead,
  hide,
  registerDevice,
  removeDevice,
  listDevices,
  shape,
};
