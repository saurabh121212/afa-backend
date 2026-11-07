// REVIEWS & RATINGS (see config/reviews.js for the rules).
//
//   public  GET  /listings/:id/reviews, /sellers/:id/reviews      summary (average, count, stars) + published reviews
//           POST /reviews/:id/report                              any logged-in user
//   buyer   GET  /me/reviews/pending ("To Review"), GET/POST /me/reviews, GET/PUT /me/reviews/:id
//   seller  GET  /me/sales/reviews, POST /me/sales/reviews/:id/reply
//   admin   /admin/reviews: stats, list, details, approve (held), hide, restore, dismiss reports
//
// Averages (users.rating_avg / listings.rating_avg) count PUBLISHED reviews only and are worked out
// again whenever a review is published, edited, hidden or restored.
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const directory = require('./userDirectory');
const notifications = require('./notification.service');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { displayId } = require('../utils/displayId');
const { USER_STATUS, USER_TYPE_LABELS } = require('../utils/constants');
const { LISTING_STATUS } = require('../config/listingOptions');
const { SELLER_ORDER_STATUS } = require('../config/orders');
const R = require('../config/reviews');

const { sequelize, Review, ReviewListing, ReviewReport, SellerOrder, Order, OrderItem, Listing, User } = models;
const { REVIEW_STATUS: S, REVIEW_RULES: RULES } = R;
const SELLER_TYPES = ['farmer', 'trader', 'logistics'];
const DAY = 86400000;

const notFound = () => new ApiError(404, 'Review not found', { code: 'REVIEW_NOT_FOUND' });
const conflict = (message, code) => new ApiError(409, message, { code });
const round1 = (n) => Math.round(n * 10) / 10;

// ---------- names ----------
// Individual buyers show as "Thandi D."; businesses with their name
function buyerName(dir) {
  if (!dir || !dir.display_name) return 'AFA Buyer';
  if (dir.subtype === 'business') return dir.display_name;
  const parts = String(dir.display_name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}
function sellerSummary(id, dir) {
  if (!dir) return { id };
  return {
    id,
    displayId: displayId(dir.user_type, id),
    name: dir.user_type === 'farmer' ? dir.sub_name || dir.display_name : dir.display_name,
    userType: dir.user_type,
    userTypeLabel: USER_TYPE_LABELS[dir.user_type],
  };
}

// ---------- averages ----------
function summarize(ratings) {
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  ratings.forEach((r) => {
    breakdown[r] += 1;
  });
  const count = ratings.length;
  const average = count ? round1(ratings.reduce((s, r) => s + r, 0) / count) : null;
  return {
    average,
    count,
    breakdown: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: breakdown[stars], percent: count ? Math.round((breakdown[stars] / count) * 100) : 0 })),
  };
}

async function listingReviewIds(listingId, transaction) {
  const links = await ReviewListing.findAll({ where: { listingId }, attributes: ['reviewId'], transaction });
  return links.map((l) => l.reviewId);
}

// Work out the seller's and the listings' averages again (published reviews only)
async function recompute(sellerId, listingIds, transaction) {
  const sellerRatings = await Review.findAll({ where: { sellerId, status: S.PUBLISHED }, attributes: ['rating'], transaction });
  const s = summarize(sellerRatings.map((r) => Number(r.rating)));
  await User.update({ ratingAvg: s.average, ratingCount: s.count }, { where: { id: sellerId }, transaction });
  for (const listingId of [...new Set(listingIds)]) {
    // eslint-disable-next-line no-await-in-loop
    const ids = await listingReviewIds(listingId, transaction);
    // eslint-disable-next-line no-await-in-loop
    const rows = ids.length ? await Review.findAll({ where: { id: ids, status: S.PUBLISHED }, attributes: ['rating'], transaction }) : [];
    const l = summarize(rows.map((r) => Number(r.rating)));
    // eslint-disable-next-line no-await-in-loop
    await Listing.update({ ratingAvg: l.average, ratingCount: l.count }, { where: { id: listingId }, transaction, paranoid: false });
  }
}

async function listingsOf(review, transaction) {
  const links = await ReviewListing.findAll({ where: { reviewId: review.id }, attributes: ['listingId'], transaction });
  return links.map((l) => l.listingId);
}

// ---------- shapes ----------
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

async function listingNames(ids) {
  if (!ids.length) return new Map();
  const rows = await Listing.findAll({ where: { id: [...new Set(ids)] }, attributes: ['id', 'name'], paranoid: false });
  return new Map(rows.map((l) => [l.id, l.name]));
}

// links: Map reviewId -> [listingId]
async function linksFor(reviews) {
  const ids = reviews.map((r) => r.id);
  const rows = ids.length ? await ReviewListing.findAll({ where: { reviewId: ids }, attributes: ['reviewId', 'listingId'] }) : [];
  const map = new Map();
  rows.forEach((r) => map.set(r.reviewId, [...(map.get(r.reviewId) || []), r.listingId]));
  return map;
}

// Everything a list of reviews needs: names of buyers / sellers / listings
async function context(reviews) {
  const links = await linksFor(reviews);
  const [dirs, names] = await Promise.all([
    directory.findMany([...new Set(reviews.flatMap((r) => [r.buyerId, r.sellerId]))]),
    listingNames([...links.values()].flat()),
  ]);
  return { links, dirs, names };
}

function publicShape(r, ctx) {
  return {
    id: r.id,
    rating: Number(r.rating),
    stars: stars(Number(r.rating)),
    comment: r.comment || null,
    buyer: { name: buyerName(ctx.dirs.get(r.buyerId)) },
    isBooking: Boolean(r.isBooking),
    listings: (ctx.links.get(r.id) || []).map((id) => ({ id, name: ctx.names.get(id) || null })),
    edited: Boolean(r.editedAt),
    createdAt: r.publishedAt || r.createdAt,
    reply: r.reply ? { text: r.reply, repliedAt: r.repliedAt } : null,
  };
}

const editUntil = (r) => new Date(new Date(r.createdAt).getTime() + RULES.editDays * DAY);
const canEdit = (r) => r.status !== S.HIDDEN && Number(r.editCount || 0) < RULES.maxEdits && editUntil(r) > new Date();

async function mineShape(r, ctx, so) {
  const c = ctx || (await context([r]));
  return {
    ...publicShape(r, c),
    sellerOrderId: r.sellerOrderId,
    orderId: r.orderId,
    sellerOrderNumber: so ? so.sellerOrderNumber : undefined,
    seller: sellerSummary(r.sellerId, c.dirs.get(r.sellerId)),
    status: r.status,
    statusLabel: R.REVIEW_STATUS_LABELS[r.status],
    // held: we don't say which word; hidden: the admin's reason
    statusNote:
      r.status === S.HELD
        ? 'Your review will appear once the AFA team has checked it.'
        : r.status === S.HIDDEN
          ? `Hidden by AFA: ${r.hiddenReason || 'it does not follow the review guidelines'}`
          : null,
    canEdit: canEdit(r),
    editUntil: Number(r.editCount || 0) < RULES.maxEdits ? editUntil(r) : null,
    editsLeft: Math.max(0, RULES.maxEdits - Number(r.editCount || 0)),
  };
}

// ---------- the order being reviewed ----------
async function loadOrderForBuyer(user, sellerOrderId, transaction) {
  const so = await SellerOrder.findOne({ where: { id: sellerOrderId }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  if (!so) throw new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });
  const order = await Order.findOne({ where: { id: so.orderId, userId: user.id }, attributes: ['id', 'userId', 'kind'], transaction });
  if (!order) throw new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });
  return { so, order };
}

function reviewBlocker(so) {
  if (so.status !== SELLER_ORDER_STATUS.COMPLETED) return 'You can review an order once it is completed';
  if (!so.completedAt || Date.now() - new Date(so.completedAt).getTime() > RULES.windowDays * DAY) {
    return `Reviews can be written up to ${RULES.windowDays} days after the order is completed`;
  }
  return null;
}

// Status for a new / edited review: published, or held (blocked words, phone, email)
async function moderation(comment) {
  const words = R.parseWordList(await settings.get('review_blocked_words'));
  const reasons = R.holdReasons(comment, words);
  return { status: reasons.length ? S.HELD : S.PUBLISHED, holdReasons: reasons.length ? reasons : null };
}

// ---------- notifications (never throw) ----------
function tellSeller(r) {
  notifications.toUser(r.sellerId, {
    type: 'review.new',
    title: `New ${r.rating}-star review`,
    body: r.comment ? `"${String(r.comment).slice(0, 120)}"` : `A buyer rated ${r.isBooking ? 'your service' : 'your order'} ${stars(r.rating)}.`,
    data: { screen: 'seller_review', reviewId: r.id },
  });
}
function tellAdmins(r, why) {
  notifications.toAdmins({
    type: 'admin.review',
    title: why === 'held' ? 'A review waits for approval' : 'A review was reported',
    body: why === 'held' ? `${r.rating}-star review held: ${(r.holdReasons || []).map((h) => h.label).join(', ')}` : `${r.rating}-star review reported by a user.`,
    data: { screen: 'admin_review', reviewId: r.id },
  });
}

// ======================= BUYER =======================

// GET /me/reviews/pending   completed orders not reviewed yet ("To Review")
async function pending(user, query = {}) {
  const pg = getPagination(query);
  const orders = await Order.findAll({ where: { userId: user.id }, attributes: ['id', 'orderNumber', 'kind'] });
  if (!orders.length) return { items: [], pagination: paginationMeta(pg, 0) };
  const since = new Date(Date.now() - RULES.windowDays * DAY);
  const sos = await SellerOrder.findAll({
    where: { orderId: orders.map((o) => o.id), status: SELLER_ORDER_STATUS.COMPLETED, completedAt: { [Op.gte]: since } },
    attributes: ['id', 'orderId', 'sellerId', 'sellerOrderNumber', 'fulfilment', 'completedAt'],
    order: [['completedAt', 'DESC']],
  });
  const done = sos.length ? await Review.findAll({ where: { sellerOrderId: sos.map((s) => s.id) }, attributes: ['sellerOrderId'], paranoid: false }) : [];
  const reviewed = new Set(done.map((d) => d.sellerOrderId));
  const open = sos.filter((s) => !reviewed.has(s.id));
  const page = open.slice(pg.offset, pg.offset + pg.limit);
  const [items, dirs] = await Promise.all([
    page.length ? OrderItem.findAll({ where: { sellerOrderId: page.map((s) => s.id) }, attributes: ['sellerOrderId', 'listingId', 'name', 'photoUrl'] }) : [],
    directory.findMany(page.map((s) => s.sellerId)),
  ]);
  return {
    items: page.map((s) => ({
      sellerOrderId: s.id,
      orderId: s.orderId,
      sellerOrderNumber: s.sellerOrderNumber,
      isBooking: s.fulfilment === 'service',
      seller: sellerSummary(s.sellerId, dirs.get(s.sellerId)),
      items: items.filter((i) => i.sellerOrderId === s.id).map((i) => ({ listingId: i.listingId, name: i.name, photoUrl: i.photoUrl || null })),
      completedAt: s.completedAt,
      reviewBy: new Date(new Date(s.completedAt).getTime() + RULES.windowDays * DAY),
    })),
    pagination: paginationMeta(pg, open.length),
  };
}

// POST /me/reviews   { sellerOrderId, rating, comment? }
async function create(user, data) {
  const mod = await moderation(data.comment);
  const review = await sequelize.transaction(async (transaction) => {
    const { so, order } = await loadOrderForBuyer(user, data.sellerOrderId, transaction);
    const existing = await Review.findOne({ where: { sellerOrderId: so.id }, transaction, paranoid: false });
    if (existing) throw conflict('You already reviewed this order. You can edit your review once within 7 days.', 'ALREADY_REVIEWED');
    const blocker = reviewBlocker(so);
    if (blocker) throw conflict(blocker, 'REVIEW_NOT_ALLOWED');

    const now = new Date();
    const r = await Review.create(
      {
        sellerOrderId: so.id,
        orderId: order.id,
        buyerId: user.id,
        sellerId: so.sellerId,
        isBooking: so.fulfilment === 'service',
        rating: data.rating,
        comment: data.comment || null,
        status: mod.status,
        holdReasons: mod.holdReasons,
        publishedAt: mod.status === S.PUBLISHED ? now : null,
      },
      { transaction }
    );
    const items = await OrderItem.findAll({ where: { sellerOrderId: so.id }, attributes: ['listingId'], transaction });
    const listingIds = [...new Set(items.map((i) => i.listingId).filter(Boolean))];
    if (listingIds.length) await ReviewListing.bulkCreate(listingIds.map((listingId) => ({ reviewId: r.id, listingId })), { transaction });
    if (mod.status === S.PUBLISHED) await recompute(so.sellerId, listingIds, transaction);
    r.sellerOrderNumber = so.sellerOrderNumber;
    return r;
  });
  if (review.status === S.PUBLISHED) tellSeller(review);
  else tellAdmins(review, 'held');
  return mineShape(review, null, { sellerOrderNumber: review.sellerOrderNumber });
}

async function findMine(user, id, transaction) {
  const r = await Review.findOne({ where: { id, buyerId: user.id }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  if (!r) throw notFound();
  return r;
}

// PUT /me/reviews/:id   { rating?, comment? }   once, within 7 days
async function update(user, id, data) {
  const mod = data.comment !== undefined ? await moderation(data.comment) : null;
  const { review, wasPublished } = await sequelize.transaction(async (transaction) => {
    const r = await findMine(user, id, transaction);
    if (r.status === S.HIDDEN) throw conflict('This review was hidden by AFA and cannot be changed', 'REVIEW_HIDDEN');
    if (Number(r.editCount || 0) >= RULES.maxEdits) throw conflict('You have already edited this review once', 'EDIT_NOT_ALLOWED');
    if (editUntil(r) <= new Date()) throw conflict(`Reviews can only be edited within ${RULES.editDays} days of writing them`, 'EDIT_NOT_ALLOWED');
    const before = r.status;
    const values = { editCount: Number(r.editCount || 0) + 1, editedAt: new Date() };
    if (data.rating !== undefined) values.rating = data.rating;
    if (data.comment !== undefined) {
      values.comment = data.comment || null;
      values.status = mod.status;
      values.holdReasons = mod.holdReasons;
      if (mod.status === S.PUBLISHED && !r.publishedAt) values.publishedAt = new Date();
    }
    await r.update(values, { transaction });
    if (before === S.PUBLISHED || r.status === S.PUBLISHED) await recompute(r.sellerId, await listingsOf(r, transaction), transaction);
    return { review: r, wasPublished: before === S.PUBLISHED };
  });
  if (review.status === S.HELD && wasPublished) tellAdmins(review, 'held');
  return mineShape(review);
}

// GET /me/reviews   (?status=&page=&limit=)
async function listMine(user, query = {}) {
  const pg = getPagination(query);
  const where = { buyerId: user.id };
  if (query.status) where.status = query.status;
  const { rows, count } = await Review.findAndCountAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: pg.limit, offset: pg.offset });
  const ctx = await context(rows);
  const sos = rows.length ? await SellerOrder.findAll({ where: { id: rows.map((r) => r.sellerOrderId) }, attributes: ['id', 'sellerOrderNumber'] }) : [];
  const soMap = new Map(sos.map((s) => [s.id, s]));
  return { items: await Promise.all(rows.map((r) => mineShape(r, ctx, soMap.get(r.sellerOrderId)))), pagination: paginationMeta(pg, count) };
}

// GET /me/reviews/:id
async function getMine(user, id) {
  const r = await findMine(user, id);
  const so = await SellerOrder.findOne({ where: { id: r.sellerOrderId }, attributes: ['id', 'sellerOrderNumber'] });
  return mineShape(r, null, so);
}

// ======================= SELLER =======================

// GET /me/sales/reviews   (?rating=&replied=true|false&page=)  published reviews about me + my summary
async function received(user, query = {}) {
  const pg = getPagination(query);
  const where = { sellerId: user.id, status: S.PUBLISHED };
  if (query.rating) where.rating = query.rating;
  if (query.replied === true) where.reply = { [Op.ne]: null };
  if (query.replied === false) where.reply = null;
  const [all, page] = await Promise.all([
    Review.findAll({ where: { sellerId: user.id, status: S.PUBLISHED }, attributes: ['rating', 'reply'] }),
    Review.findAndCountAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: pg.limit, offset: pg.offset }),
  ]);
  const ctx = await context(page.rows);
  const sos = page.rows.length ? await SellerOrder.findAll({ where: { id: page.rows.map((r) => r.sellerOrderId) }, attributes: ['id', 'sellerOrderNumber'] }) : [];
  const soMap = new Map(sos.map((s) => [s.id, s]));
  return {
    summary: { ...summarize(all.map((r) => Number(r.rating))), awaitingReply: all.filter((r) => !r.reply).length },
    items: page.rows.map((r) => ({
      ...publicShape(r, ctx),
      sellerOrderId: r.sellerOrderId,
      orderId: r.orderId,
      sellerOrderNumber: (soMap.get(r.sellerOrderId) || {}).sellerOrderNumber || null,
      canReply: !r.reply,
    })),
    pagination: paginationMeta(pg, page.count),
  };
}

// POST /me/sales/reviews/:id/reply   { reply }   one public reply
async function reply(user, id, data) {
  const words = R.parseWordList(await settings.get('review_blocked_words'));
  const found = R.holdReasons(data.reply, words).filter((h) => h.code === 'blocked_words');
  if (found.length) {
    throw new ApiError(422, 'Please keep your reply polite: remove the blocked words', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'reply', message: 'Your reply contains words that are not allowed' }],
    });
  }
  const r = await sequelize.transaction(async (transaction) => {
    const rv = await Review.findOne({ where: { id, sellerId: user.id, status: S.PUBLISHED }, transaction, lock: transaction.LOCK.UPDATE });
    if (!rv) throw notFound();
    if (rv.reply) throw conflict('You have already replied to this review', 'ALREADY_REPLIED');
    await rv.update({ reply: data.reply, repliedAt: new Date() }, { transaction });
    return rv;
  });
  notifications.toUser(r.buyerId, {
    type: 'review.reply',
    title: 'The seller replied to your review',
    body: String(data.reply).slice(0, 140),
    data: { screen: 'my_review', reviewId: r.id },
  });
  const ctx = await context([r]);
  return { ...publicShape(r, ctx), canReply: false };
}

// ======================= PUBLIC =======================

function publicOrder(sort) {
  if (sort === 'highest') return [['rating', 'DESC'], ['createdAt', 'DESC']];
  if (sort === 'lowest') return [['rating', 'ASC'], ['createdAt', 'DESC']];
  return [['createdAt', 'DESC'], ['id', 'DESC']];
}

async function publicList(baseWhere, query) {
  const pg = getPagination(query);
  const where = { ...baseWhere, status: S.PUBLISHED };
  const [all, page] = await Promise.all([
    Review.findAll({ where, attributes: ['rating'] }),
    Review.findAndCountAll({
      where: { ...where, ...(query.rating ? { rating: query.rating } : {}), ...(query.withComment ? { comment: { [Op.ne]: null } } : {}) },
      order: publicOrder(query.sort),
      limit: pg.limit,
      offset: pg.offset,
    }),
  ]);
  const ctx = await context(page.rows);
  return { summary: summarize(all.map((r) => Number(r.rating))), items: page.rows.map((r) => publicShape(r, ctx)), pagination: paginationMeta(pg, page.count) };
}

// GET /listings/:id/reviews   (?rating=&withComment=true&sort=newest|highest|lowest&page=)
async function forListing(listingId, query = {}) {
  const listing = await Listing.findOne({ where: { id: listingId, status: LISTING_STATUS.ACTIVE }, attributes: ['id', 'name'] });
  if (!listing) throw new ApiError(404, 'Listing not found', { code: 'LISTING_NOT_FOUND' });
  const ids = await listingReviewIds(listing.id);
  return { listing: { id: listing.id, name: listing.name }, ...(await publicList({ id: ids.length ? ids : [0] }, query)) };
}

// GET /sellers/:id/reviews
async function forSeller(sellerId, query = {}) {
  const seller = await User.findOne({ where: { id: sellerId, status: USER_STATUS.APPROVED }, attributes: ['id', 'userType'] });
  if (!seller || !SELLER_TYPES.includes(seller.userType)) throw new ApiError(404, 'Seller not found', { code: 'SELLER_NOT_FOUND' });
  const dirs = await directory.findMany([seller.id]);
  return { seller: sellerSummary(seller.id, dirs.get(seller.id)), ...(await publicList({ sellerId: seller.id }, query)) };
}

// POST /reviews/:id/report   { reason, note? }   any logged-in user, once per review
async function report(user, id, data) {
  const r = await sequelize.transaction(async (transaction) => {
    const rv = await Review.findOne({ where: { id, status: S.PUBLISHED }, transaction, lock: transaction.LOCK.UPDATE });
    if (!rv) throw notFound();
    if (rv.buyerId === user.id) throw conflict('You cannot report your own review. You can edit it instead.', 'OWN_REVIEW');
    const dup = await ReviewReport.findOne({ where: { reviewId: rv.id, reporterId: user.id }, transaction });
    if (dup) throw conflict('You have already reported this review. The AFA team will check it.', 'ALREADY_REPORTED');
    await ReviewReport.create({ reviewId: rv.id, reporterId: user.id, reason: data.reason, note: data.note || null }, { transaction });
    await rv.update({ openReports: Number(rv.openReports || 0) + 1, lastReportedAt: new Date() }, { transaction });
    return rv;
  });
  if (Number(r.openReports) === 1) tellAdmins(r, 'reported'); // once per batch of reports
  return { reported: true };
}

// ======================= ADMIN =======================

const ADMIN_SORTS = {
  newest: [['createdAt', 'DESC'], ['id', 'DESC']],
  oldest: [['createdAt', 'ASC'], ['id', 'ASC']],
  most_reported: [['openReports', 'DESC'], ['lastReportedAt', 'DESC']],
  lowest: [['rating', 'ASC'], ['createdAt', 'DESC']],
};

async function adminShape(r, ctx) {
  return {
    ...publicShape(r, ctx),
    buyer: { id: r.buyerId, name: (ctx.dirs.get(r.buyerId) || {}).display_name || null },
    seller: sellerSummary(r.sellerId, ctx.dirs.get(r.sellerId)),
    sellerOrderId: r.sellerOrderId,
    orderId: r.orderId,
    status: r.status,
    statusLabel: R.REVIEW_STATUS_LABELS[r.status],
    holdReasons: r.holdReasons || [],
    hiddenReason: r.hiddenReason || null,
    hiddenAt: r.hiddenAt || null,
    openReports: Number(r.openReports || 0),
    lastReportedAt: r.lastReportedAt || null,
    editCount: Number(r.editCount || 0),
    actions: {
      canApprove: r.status === S.HELD,
      canHide: r.status !== S.HIDDEN,
      canRestore: r.status === S.HIDDEN,
      canDismissReports: Number(r.openReports || 0) > 0 && r.status === S.PUBLISHED,
    },
  };
}

// GET /admin/reviews/stats
async function stats() {
  const rows = await Review.findAll({ attributes: ['rating', 'status', 'openReports'] });
  const by = (st) => rows.filter((r) => r.status === st);
  return {
    total: rows.length,
    published: by(S.PUBLISHED).length,
    held: by(S.HELD).length,
    hidden: by(S.HIDDEN).length,
    reported: rows.filter((r) => Number(r.openReports) > 0 && r.status !== S.HIDDEN).length,
    toCheck: by(S.HELD).length + rows.filter((r) => Number(r.openReports) > 0 && r.status === S.PUBLISHED).length,
    summary: summarize(by(S.PUBLISHED).map((r) => Number(r.rating))),
  };
}

// GET /admin/reviews   (?status=&rating=&reported=true&sellerId=&buyerId=&search=&from=&to=&sort=&page=)
async function adminList(query = {}) {
  const pg = getPagination(query);
  const where = {};
  if (query.status) where.status = query.status;
  if (query.rating) where.rating = query.rating;
  if (query.reported) where.openReports = { [Op.gt]: 0 };
  if (query.sellerId) where.sellerId = query.sellerId;
  if (query.buyerId) where.buyerId = query.buyerId;
  if (query.search) where.comment = { [Op.like]: `%${query.search}%` };
  if (query.from || query.to) {
    where.createdAt = { ...(query.from ? { [Op.gte]: new Date(`${query.from}T00:00:00+02:00`) } : {}), ...(query.to ? { [Op.lte]: new Date(`${query.to}T23:59:59+02:00`) } : {}) };
  }
  const { rows, count } = await Review.findAndCountAll({ where, order: ADMIN_SORTS[query.sort] || ADMIN_SORTS.newest, limit: pg.limit, offset: pg.offset });
  const ctx = await context(rows);
  return { items: await Promise.all(rows.map((r) => adminShape(r, ctx))), pagination: paginationMeta(pg, count) };
}

async function adminLoad(id, transaction) {
  const r = await Review.findOne({ where: { id }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  if (!r) throw notFound();
  return r;
}

// GET /admin/reviews/:id   with its reports
async function adminGet(id) {
  const r = await adminLoad(id);
  const [ctx, reports, so] = await Promise.all([
    context([r]),
    ReviewReport.findAll({ where: { reviewId: r.id }, order: [['createdAt', 'DESC']] }),
    SellerOrder.findOne({ where: { id: r.sellerOrderId }, attributes: ['id', 'sellerOrderNumber', 'completedAt'] }),
  ]);
  const reporters = await directory.findMany(reports.map((p) => p.reporterId));
  return {
    ...(await adminShape(r, ctx)),
    sellerOrderNumber: so ? so.sellerOrderNumber : null,
    orderCompletedAt: so ? so.completedAt : null,
    reports: reports.map((p) => ({
      id: p.id,
      reporter: { id: p.reporterId, name: (reporters.get(p.reporterId) || {}).display_name || null, userType: (reporters.get(p.reporterId) || {}).user_type || null },
      reason: p.reason,
      reasonLabel: R.REPORT_REASONS[p.reason],
      note: p.note || null,
      status: p.status,
      resolution: p.resolution || null,
      createdAt: p.createdAt,
      resolvedAt: p.resolvedAt || null,
    })),
  };
}

async function resolveReports(r, admin, resolution, transaction) {
  await ReviewReport.update(
    { status: R.REPORT_STATUS.RESOLVED, resolution, resolvedAt: new Date(), resolvedBy: admin.id },
    { where: { reviewId: r.id, status: R.REPORT_STATUS.OPEN }, transaction }
  );
  if (Number(r.openReports)) await r.update({ openReports: 0 }, { transaction });
}

// POST /admin/reviews/:id/approve   held -> published
async function approve(admin, id) {
  const r = await sequelize.transaction(async (transaction) => {
    const rv = await adminLoad(id, transaction);
    if (rv.status !== S.HELD) throw conflict('Only reviews waiting for approval can be approved', 'INVALID_REVIEW_STATUS');
    await rv.update({ status: S.PUBLISHED, publishedAt: rv.publishedAt || new Date() }, { transaction });
    await recompute(rv.sellerId, await listingsOf(rv, transaction), transaction);
    return rv;
  });
  notifications.toUser(r.buyerId, { type: 'review.published', title: 'Your review is published', body: 'Thank you. Your review is now visible to everyone.', data: { screen: 'my_review', reviewId: r.id } });
  tellSeller(r);
  return adminGet(r.id);
}

// POST /admin/reviews/:id/hide   { reason }   published / held -> hidden; open reports resolved
async function hide(admin, id, data) {
  const r = await sequelize.transaction(async (transaction) => {
    const rv = await adminLoad(id, transaction);
    if (rv.status === S.HIDDEN) throw conflict('This review is already hidden', 'INVALID_REVIEW_STATUS');
    const wasPublished = rv.status === S.PUBLISHED;
    await rv.update({ status: S.HIDDEN, hiddenReason: data.reason, hiddenAt: new Date(), hiddenBy: admin.id }, { transaction });
    await resolveReports(rv, admin, 'hidden', transaction);
    if (wasPublished) await recompute(rv.sellerId, await listingsOf(rv, transaction), transaction);
    return rv;
  });
  notifications.toUser(r.buyerId, {
    type: 'review.hidden',
    title: 'Your review was hidden',
    body: `Reason: ${data.reason}`,
    data: { screen: 'my_review', reviewId: r.id },
  });
  return adminGet(r.id);
}

// POST /admin/reviews/:id/restore   hidden -> published
async function restore(admin, id) {
  const r = await sequelize.transaction(async (transaction) => {
    const rv = await adminLoad(id, transaction);
    if (rv.status !== S.HIDDEN) throw conflict('Only hidden reviews can be restored', 'INVALID_REVIEW_STATUS');
    await rv.update({ status: S.PUBLISHED, hiddenReason: null, hiddenAt: null, hiddenBy: null, publishedAt: rv.publishedAt || new Date() }, { transaction });
    await recompute(rv.sellerId, await listingsOf(rv, transaction), transaction);
    return rv;
  });
  return adminGet(r.id);
}

// POST /admin/reviews/:id/dismiss-reports   keep the review, close its reports
async function dismissReports(admin, id) {
  await sequelize.transaction(async (transaction) => {
    const rv = await adminLoad(id, transaction);
    if (!Number(rv.openReports)) throw conflict('This review has no open reports', 'NO_OPEN_REPORTS');
    await resolveReports(rv, admin, 'kept', transaction);
  });
  return adminGet(id);
}

// ---------- for other modules ----------
// Buyer: "rate your order" after it completes (never throws)
async function requestReview(sellerOrderId) {
  try {
    const so = await SellerOrder.findOne({ where: { id: sellerOrderId }, attributes: ['id', 'orderId', 'sellerOrderNumber', 'fulfilment', 'status'] });
    if (!so || so.status !== SELLER_ORDER_STATUS.COMPLETED) return;
    const order = await Order.findOne({ where: { id: so.orderId }, attributes: ['id', 'userId'] });
    if (!order) return;
    notifications.toUser(order.userId, {
      type: 'review.request',
      title: so.fulfilment === 'service' ? 'How was the service?' : 'How was your order?',
      body: `Rate ${so.sellerOrderNumber} to help other buyers. You have ${RULES.windowDays} days.`,
      data: { screen: 'write_review', sellerOrderId: so.id, orderId: order.id },
    });
  } catch (err) {
    console.error('[reviews] requestReview failed', err.message);
  }
}

// Seller card: completed orders
const ordersCompleted = (sellerId) => SellerOrder.count({ where: { sellerId, status: SELLER_ORDER_STATUS.COMPLETED } });

module.exports = {
  // public
  forListing,
  forSeller,
  report,
  // buyer
  pending,
  create,
  update,
  listMine,
  getMine,
  // seller
  received,
  reply,
  // admin
  stats,
  adminList,
  adminGet,
  approve,
  hide,
  restore,
  dismissReports,
  // other modules
  requestReview,
  ordersCompleted,
  summarize,
  recompute,
  reviewBlocker,
};
