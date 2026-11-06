// ADMIN ADVISORIES / ANNOUNCEMENTS: one message to many users, in-app + push (never email).
// Also the scope's "Advisory messaging from AFA Admin" (Weather & Alerts module).
//
//   audience: { type: 'all' }                                     every user who can log in
//             { type: 'filter', userTypes: [...], regionIds: [...] } (empty list = any)
//             { type: 'users', userIds: [...] }                      chosen users
//   sendAt:   empty = now, or a time up to 90 days ahead
//
//   scheduled -> sending -> sent        (cancel / edit only while scheduled)
// The background job sends due broadcasts every minute (and right away for "now").
// The audience is worked out when it is SENT, so users who join before then receive it too.
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const notify = require('./notification.service');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { USER_TYPE_LABELS } = require('../utils/constants');
const {
  BROADCAST_CATEGORIES,
  BROADCAST_STATUS,
  BROADCAST_STATUS_LABELS,
  BROADCAST_USER_STATUSES,
} = require('../config/notifications');

const { Broadcast, Notification, Location } = models;
const B = BROADCAST_STATUS;
const STUCK_MINUTES = 15; // a "sending" broadcast untouched this long is picked up again (server restarted)

const notFound = () => new ApiError(404, 'Broadcast not found', { code: 'BROADCAST_NOT_FOUND' });

// ---------- audience ----------
function cleanAudience(a = {}) {
  if (a.type === 'all') return { type: 'all' };
  if (a.type === 'users') return { type: 'users', userIds: [...new Set((a.userIds || []).map(Number))] };
  return {
    type: 'filter',
    userTypes: [...new Set(a.userTypes || [])],
    regionIds: [...new Set((a.regionIds || []).map(Number))],
  };
}

function recipientsOf(audience) {
  const a = cleanAudience(audience);
  return directory.findUserIdsForAudience({
    statuses: BROADCAST_USER_STATUSES,
    userTypes: a.type === 'filter' ? a.userTypes : [],
    regionIds: a.type === 'filter' ? a.regionIds : [],
    userIds: a.type === 'users' ? a.userIds : [],
  });
}

// Region ids must exist; user ids must be users who can receive it
async function checkAudience(a) {
  if (a.type === 'filter' && a.regionIds.length) {
    const found = await Location.findAll({ where: { id: a.regionIds }, attributes: ['id'] });
    const missing = a.regionIds.filter((id) => !found.some((l) => l.id === id));
    if (missing.length) {
      throw new ApiError(422, 'Some regions were not found', { code: 'VALIDATION_ERROR', errors: [{ field: 'audience.regionIds', message: `Not found: ${missing.join(', ')}` }] });
    }
  }
  if (a.type === 'users') {
    const ids = await recipientsOf(a);
    const missing = a.userIds.filter((id) => !ids.includes(id));
    if (missing.length) {
      throw new ApiError(422, 'Some users cannot receive messages (not found, rejected or suspended)', {
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'audience.userIds', message: `Not allowed: ${missing.join(', ')}` }],
      });
    }
  }
}

async function audienceLabel(a) {
  if (a.type === 'all') return 'All users';
  if (a.type === 'users') return `${a.userIds.length} chosen user${a.userIds.length === 1 ? '' : 's'}`;
  const regions = a.regionIds.length ? await Location.findAll({ where: { id: a.regionIds }, attributes: ['id', 'name'] }) : [];
  const types = a.userTypes.length ? a.userTypes.map((t) => USER_TYPE_LABELS[t] || t).join(', ') : 'All user types';
  return `${types}${regions.length ? ` in ${regions.map((r) => r.name).join(', ')}` : ''}`;
}

// POST /admin/broadcasts/preview   { audience } -> how many users would receive it now
async function preview({ audience }) {
  const a = cleanAudience(audience);
  await checkAudience(a);
  return { recipientCount: (await recipientsOf(a)).length, audienceLabel: await audienceLabel(a) };
}

// ---------- shape ----------
async function shape(b, { withStats = false } = {}) {
  const out = {
    id: b.id,
    category: b.category,
    categoryLabel: BROADCAST_CATEGORIES[b.category],
    title: b.title,
    body: b.body,
    linkUrl: b.linkUrl,
    audience: b.audience,
    audienceLabel: await audienceLabel(cleanAudience(b.audience)),
    status: b.status,
    statusLabel: BROADCAST_STATUS_LABELS[b.status],
    scheduledAt: b.scheduledAt,
    sentAt: b.sentAt,
    recipientCount: b.recipientCount,
    push: { sent: b.pushSentCount, failed: b.pushFailedCount },
    createdBy: b.createdBy,
    createdAt: b.createdAt,
    cancelledAt: b.cancelledAt,
    canEdit: b.status === B.SCHEDULED,
    canCancel: b.status === B.SCHEDULED,
  };
  if (withStats) {
    const read = await Notification.count({ where: { broadcastId: b.id, readAt: { [Op.ne]: null } }, paranoid: false });
    out.readCount = read;
    out.readRate = b.recipientCount ? Math.round((read / b.recipientCount) * 1000) / 10 : 0;
  }
  return out;
}

// ---------- admin CRUD ----------
// POST /admin/broadcasts   { category, title, body, linkUrl?, audience, sendAt? }
async function create(adminId, data) {
  const audience = cleanAudience(data.audience);
  await checkAudience(audience);
  if (!(await recipientsOf(audience)).length) {
    throw new ApiError(422, 'No user matches this audience', { code: 'EMPTY_AUDIENCE', errors: [{ field: 'audience', message: 'No recipients' }] });
  }
  const now = new Date();
  const b = await Broadcast.create({
    category: data.category,
    title: data.title,
    body: data.body,
    linkUrl: data.linkUrl || null,
    audience,
    status: B.SCHEDULED,
    scheduledAt: data.sendAt && data.sendAt > now ? data.sendAt : now,
    createdBy: adminId,
  });
  // "Now": start sending in the background, the request does not wait
  if (b.scheduledAt <= now) setImmediate(() => sendDue().catch((err) => console.error('Broadcast send failed:', err.message)));
  return shape(b);
}

async function findScheduled(id) {
  const b = await Broadcast.findByPk(id);
  if (!b) throw notFound();
  if (b.status !== B.SCHEDULED) {
    throw new ApiError(409, `This broadcast is ${BROADCAST_STATUS_LABELS[b.status].toLowerCase()} and can no longer be changed`, { code: 'BROADCAST_NOT_SCHEDULED' });
  }
  return b;
}

// PUT /admin/broadcasts/:id   (scheduled only; same fields as create, all optional)
async function update(adminId, id, data) {
  const b = await findScheduled(id);
  const values = { updatedBy: adminId };
  ['category', 'title', 'body'].forEach((k) => {
    if (data[k] !== undefined) values[k] = data[k];
  });
  if (data.linkUrl !== undefined) values.linkUrl = data.linkUrl || null;
  if (data.audience !== undefined) {
    values.audience = cleanAudience(data.audience);
    await checkAudience(values.audience);
  }
  if (data.sendAt !== undefined) values.scheduledAt = data.sendAt && data.sendAt > new Date() ? data.sendAt : new Date();
  await b.update(values);
  if (b.scheduledAt <= new Date()) setImmediate(() => sendDue().catch((err) => console.error('Broadcast send failed:', err.message)));
  return shape(b);
}

// POST /admin/broadcasts/:id/cancel
async function cancel(adminId, id) {
  const b = await findScheduled(id);
  await b.update({ status: B.CANCELLED, cancelledAt: new Date(), cancelledBy: adminId });
  return shape(b);
}

// GET /admin/broadcasts?status=&category=&search=&page=
async function list(query = {}) {
  const pg = getPagination(query);
  const where = {};
  if (query.status) where.status = query.status;
  if (query.category) where.category = query.category;
  if (query.search) where.title = { [Op.like]: `%${query.search}%` };
  const { rows, count } = await Broadcast.findAndCountAll({ where, order: [['scheduledAt', 'DESC'], ['id', 'DESC']], limit: pg.limit, offset: pg.offset });
  const counts = Object.fromEntries(Object.values(B).map((s) => [s, 0]));
  (await Broadcast.findAll({ attributes: ['status'] })).forEach((r) => {
    counts[r.status] += 1;
  });
  return { items: await Promise.all(rows.map((b) => shape(b))), counts, pagination: paginationMeta(pg, count) };
}

// GET /admin/broadcasts/:id   (+ how many read it)
async function getOne(id) {
  const b = await Broadcast.findByPk(id);
  if (!b) throw notFound();
  return shape(b, { withStats: true });
}

// ---------- sending (job) ----------
async function sendOne(b) {
  const userIds = await recipientsOf(b.audience);
  // Already delivered ones (a run that stopped half-way) are not sent twice
  const done = new Set(
    (await Notification.findAll({ where: { broadcastId: b.id }, attributes: ['userId'], paranoid: false })).map((n) => n.userId)
  );
  const todo = userIds.filter((id) => !done.has(id));
  const saved = await notify.createForUsers(
    todo,
    {
      type: b.category === 'advisory' ? 'broadcast.advisory' : 'broadcast.announcement',
      title: b.title,
      body: b.body,
      data: { screen: 'broadcast', broadcastId: b.id, ...(b.linkUrl ? { linkUrl: b.linkUrl } : {}) },
      broadcastId: b.id,
    },
    { pushNow: false }
  );
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < saved.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const out = await notify.pushNotifications(saved.slice(i, i + 200));
    sent += out.sent;
    failed += out.failed;
    // eslint-disable-next-line no-await-in-loop
    await b.update({ pushSentCount: b.pushSentCount + out.sent, pushFailedCount: b.pushFailedCount + out.failed }); // keeps "sending" fresh
  }
  await b.update({ status: B.SENT, sentAt: new Date(), recipientCount: done.size + saved.length });
  return { recipients: saved.length, sent, failed };
}

let sending = false;
// Send every due broadcast (and pick up one left half-way by a restart). Returns how many were sent.
async function sendDue() {
  if (sending) return 0;
  sending = true;
  let count = 0;
  try {
    const now = new Date();
    const stuck = new Date(now.getTime() - STUCK_MINUTES * 60 * 1000);
    const due = await Broadcast.findAll({
      where: {
        [Op.or]: [
          { status: B.SCHEDULED, scheduledAt: { [Op.lte]: now } },
          { status: B.SENDING, updatedAt: { [Op.lt]: stuck } },
        ],
      },
      order: [['scheduledAt', 'ASC']],
      limit: 5,
    });
    for (const b of due) {
      // Claim it (another server / run may have taken it)
      // eslint-disable-next-line no-await-in-loop
      const [claimed] = await Broadcast.update(
        { status: B.SENDING, startedAt: b.startedAt || new Date() },
        { where: { id: b.id, status: b.status, updatedAt: b.updatedAt } }
      );
      if (!claimed) continue;
      // eslint-disable-next-line no-await-in-loop
      await b.reload();
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendOne(b);
        count += 1;
      } catch (err) {
        console.error(`Broadcast ${b.id} failed (will retry in ${STUCK_MINUTES} min):`, err.message);
      }
    }
  } finally {
    sending = false;
  }
  return count;
}

module.exports = { preview, create, update, cancel, list, getOne, sendDue, cleanAudience };
