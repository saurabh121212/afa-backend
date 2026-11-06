// Bell (users + admins), devices (push tokens) and admin broadcasts. Input is already validated.
const asyncHandler = require('../utils/asyncHandler');
const notifications = require('../services/notification.service');
const broadcasts = require('../services/broadcast.service');

const v = (req) => req.validated;
const ok = (res, data, message, status = 200) => res.status(status).json({ success: true, ...(message ? { message } : {}), data });

// The same bell for a user and an admin
const bell = (who) => ({
  list: asyncHandler(async (req, res) => ok(res, await notifications.list(who(req), v(req)))),
  unreadCount: asyncHandler(async (req, res) => ok(res, await notifications.unreadCount(who(req)))),
  read: asyncHandler(async (req, res) => ok(res, await notifications.markRead(who(req), v(req).id))),
  readAll: asyncHandler(async (req, res) => ok(res, await notifications.markAllRead(who(req), v(req)), 'All marked as read')),
  hide: asyncHandler(async (req, res) => ok(res, await notifications.hide(who(req), v(req).id), 'Notification removed')),
});

// ---------- devices ----------
const listDevices = asyncHandler(async (req, res) => ok(res, await notifications.listDevices(req.user)));
const registerDevice = asyncHandler(async (req, res) => ok(res, await notifications.registerDevice(req.user, v(req)), 'Device registered for push notifications', 201));
const removeDevice = asyncHandler(async (req, res) => {
  await notifications.removeDevice(req.user, v(req));
  res.json({ success: true, message: 'Device removed' });
});

// ---------- broadcasts ----------
const createBroadcast = asyncHandler(async (req, res) => {
  const data = await broadcasts.create(req.admin.id, v(req));
  ok(res, data, data.scheduledAt > new Date() ? 'Scheduled' : 'Sending now', 201);
});
const updateBroadcast = asyncHandler(async (req, res) => ok(res, await broadcasts.update(req.admin.id, v(req).id, v(req)), 'Broadcast updated'));
const cancelBroadcast = asyncHandler(async (req, res) => ok(res, await broadcasts.cancel(req.admin.id, v(req).id), 'Broadcast cancelled'));
const previewBroadcast = asyncHandler(async (req, res) => ok(res, await broadcasts.preview(v(req))));
const listBroadcasts = asyncHandler(async (req, res) => ok(res, await broadcasts.list(v(req))));
const getBroadcast = asyncHandler(async (req, res) => ok(res, await broadcasts.getOne(v(req).id)));

module.exports = {
  user: bell((req) => ({ type: 'user', id: req.user.id })),
  admin: bell((req) => ({ type: 'admin', id: req.admin.id })),
  listDevices,
  registerDevice,
  removeDevice,
  createBroadcast,
  updateBroadcast,
  cancelBroadcast,
  previewBroadcast,
  listBroadcasts,
  getBroadcast,
};
