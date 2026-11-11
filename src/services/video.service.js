// CMS Video Gallery (Admin "Content Management" -> Videos) - admin management + the public page.
//
//   isActive true  -> on the website (/gallery)
//   isActive false -> hidden, only admins see it
// The link can be YouTube (watch, youtu.be, shorts, embed, live) or any https video page. For YouTube
// the API also returns the thumbnail and the player address, so the website and apps don't need to
// work them out.
const { Op } = require('sequelize');
const { Video } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');

const notFound = () => new ApiError(404, 'Video not found', { code: 'VIDEO_NOT_FOUND' });

// ---------- YouTube ----------

// The 11-character video id of a YouTube link, or null for anything else
function youTubeId(link) {
  let url;
  try {
    url = new URL(String(link || '').trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const [first, second] = url.pathname.split('/').filter(Boolean);
  let id = null;
  if (host === 'youtu.be') id = first;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (first === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(first)) id = second;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// YouTube's own picture of the video (every video has this size)
const thumbnailUrl = (id) => (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null);
// The player, without YouTube's tracking cookies until the visitor presses play
const embedUrl = (id) => (id ? `https://www.youtube-nocookie.com/embed/${id}` : null);

// ---------- output ----------

const toPublic = (v) => ({
  id: v.id,
  title: v.title,
  description: v.description,
  link: v.link,
  youtubeId: v.youtubeId,
  thumbnailUrl: thumbnailUrl(v.youtubeId),
  embedUrl: embedUrl(v.youtubeId),
  sortOrder: v.sortOrder,
});

const toAdmin = (v) => ({
  ...toPublic(v),
  isActive: v.isActive,
  statusLabel: v.isActive ? 'Active' : 'Hidden',
  visibleOnWebsite: v.isActive,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

// ======================= ADMIN =======================

// GET /admin/videos/stats   (Total / Active / Hidden cards)
async function stats() {
  const [total, active] = await Promise.all([Video.count(), Video.count({ where: { isActive: true } })]);
  return { totalVideos: total, active, hidden: total - active };
}

// GET /admin/videos?isActive=&search=&page=&limit=   (hidden videos included)
async function list(query) {
  const pg = getPagination(query);
  const where = {};
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    const like = `%${query.search}%`;
    where[Op.or] = [{ title: { [Op.like]: like } }, { description: { [Op.like]: like } }];
  }
  const { rows, count } = await Video.findAndCountAll({
    where,
    order: [['sortOrder', 'ASC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map(toAdmin), pagination: paginationMeta(pg, count) };
}

async function findOr404(id) {
  const video = await Video.findByPk(id);
  if (!video) throw notFound();
  return video;
}

// GET /admin/videos/:id
const getById = async (id) => toAdmin(await findOr404(id));

const FIELDS = ['title', 'description', 'link', 'isActive', 'sortOrder'];

function pickValues(data) {
  const values = {};
  FIELDS.forEach((f) => {
    if (data[f] !== undefined) values[f] = data[f];
  });
  if (values.link !== undefined) values.youtubeId = youTubeId(values.link);
  return values;
}

// POST /admin/videos   { title, description, link, isActive?, sortOrder? }
async function create(data, adminId) {
  const video = await Video.create({ ...pickValues(data), createdBy: adminId, updatedBy: adminId });
  return toAdmin(video);
}

// PUT /admin/videos/:id   (send only what changes)
async function update(id, data, adminId) {
  const video = await findOr404(id);
  await video.update({ ...pickValues(data), updatedBy: adminId });
  return toAdmin(video);
}

// PATCH /admin/videos/:id/status   { isActive }
async function setStatus(id, { isActive }, adminId) {
  const video = await findOr404(id);
  await video.update({ isActive, updatedBy: adminId });
  return toAdmin(video);
}

// DELETE /admin/videos/:id   (soft delete)
async function remove(id) {
  const video = await findOr404(id);
  await video.destroy();
  return { id: video.id, title: video.title };
}

// ======================= PUBLIC =======================

// GET /videos?search=&page=&limit=   -> active videos only, in display order
async function listPublic(query = {}) {
  const pg = getPagination(query);
  const where = { isActive: true };
  if (query.search) {
    const like = `%${query.search}%`;
    where[Op.or] = [{ title: { [Op.like]: like } }, { description: { [Op.like]: like } }];
  }
  const { rows, count } = await Video.findAndCountAll({
    where,
    order: [['sortOrder', 'ASC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map(toPublic), pagination: paginationMeta(pg, count) };
}

module.exports = { stats, list, getById, create, update, setStatus, remove, listPublic, youTubeId };
