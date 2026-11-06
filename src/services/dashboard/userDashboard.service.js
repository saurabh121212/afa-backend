// GET /me/dashboard  -> the logged-in user's dashboard, by user type:
//   farmer, trader -> seller dashboard (sales, revenue, orders, stock, performance, enquiries)
//   buyer          -> buyer dashboard (orders, payments, refunds, addresses, wishlist, messages)
//   logistics      -> account + listings + SAMPLE bookings (isSample: true) until bookings are built
//   financial_institution -> no dashboard (403)
//
// Always live (no cache). Every money figure has a ready "labels" text (E 1,234.50).
const { Op } = require('sequelize');
const models = require('../../models');
const ApiError = require('../../utils/ApiError');
const chat = require('./chatStats');
const P = require('./periods');
const { paidIn, salesOf, performance, countBy } = require('./metrics');
const { round2, num, money } = require('../orderShared');
const { ORDER_STATUS_LABELS, SELLER_ORDER_STATUS_LABELS } = require('../../config/orders');
const { LISTING_STATUS, LISTING_STATUS_LABELS } = require('../../config/listingOptions');

const { SellerOrder, Order, OrderItem, Listing, WishlistItem, Refund, Claim, Address, Notification, User, UserDocument } = models;

const moneyLabels = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, money(v && typeof v === 'object' ? v.value : v)]));
const safe = (p, fallback = 0) => Promise.resolve(p).catch((err) => {
  console.error('Dashboard: chat count failed:', err.message);
  return fallback;
});

// ---------- low stock ----------
// At or below 2x the minimum order, or 10 when the listing has no minimum. null quantity = not tracked.
function stockState(l) {
  if (l.quantity === null || l.quantity === undefined) return 'untracked';
  const q = num(l.quantity);
  if (q <= 0) return 'out';
  const limit = l.minOrderQuantity ? num(l.minOrderQuantity) * 2 : 10;
  return q <= limit ? 'low' : 'ok';
}

// ======================= SELLER (farmer, trader) =======================
async function seller(user, p) {
  const [sos, listings, account] = await Promise.all([
    SellerOrder.findAll({
      where: { sellerId: user.id, paidAt: { [Op.ne]: null } },
      attributes: ['id', 'status', 'total', 'refundedAmount', 'paidAt', 'confirmBy', 'confirmedAt', 'deliveredAt', 'completedAt', 'cancelledAt', 'cancelledBy', 'claimStatus', 'payoutStatus', 'payoutAmount', 'openCancelRequestId'],
    }),
    Listing.findAll({ where: { userId: user.id }, attributes: ['id', 'name', 'status', 'quantity', 'quantityUnit', 'priceUnit', 'minOrderQuantity', 'vatHold'] }),
    User.findByPk(user.id, { attributes: ['id', 'status', 'vatStatus'] }),
  ]);
  const now = sos.length ? paidIn(sos, p.from, p.to) : [];
  const before = sos.length ? paidIn(sos, p.prevFrom, p.prevTo) : [];
  const cur = salesOf(now);
  const prev = salesOf(before);
  const soIds = sos.map((so) => so.id);
  const listingIds = listings.map((l) => l.id);

  const [refunds, items, wishlist, enquiries, unread] = await Promise.all([
    soIds.length ? Refund.findAll({ where: { sellerOrderId: soIds, createdAt: { [Op.gte]: p.prevFrom } }, attributes: ['amount', 'createdAt'] }) : [],
    now.length ? OrderItem.findAll({ where: { sellerOrderId: now.filter((so) => so.status !== 'cancelled').map((so) => so.id) }, attributes: ['listingId', 'name', 'unitLabel', 'quantity', 'lineTotal'] }) : [],
    listingIds.length ? WishlistItem.findAll({ where: { listingId: listingIds }, attributes: ['listingId', 'createdAt'] }) : [],
    safe(chat.enquiriesInPeriod(user.id, p.from, p.to)),
    safe(chat.unreadMessages(user.id)),
  ]);
  const refundSum = (from, to) => round2(refunds.filter((r) => P.inRange(r.createdAt, from, to)).reduce((s, r) => s + num(r.amount), 0));
  const released = (from, to) =>
    round2(sos.filter((so) => so.payoutStatus === 'released' && P.inRange(so.completedAt || so.cancelledAt, from, to)).reduce((s, so) => s + num(so.payoutAmount), 0));
  const payoutHeld = round2(sos.filter((so) => so.payoutStatus === 'held').reduce((s, so) => s + num(so.payoutAmount), 0));

  // Top listings (by sales in the period)
  const top = new Map();
  items.forEach((i) => {
    const t = top.get(i.listingId) || { listingId: i.listingId, name: i.name, unitLabel: i.unitLabel, quantity: 0, revenue: 0 };
    t.quantity = round2(t.quantity + num(i.quantity));
    t.revenue = round2(t.revenue + num(i.lineTotal));
    top.set(i.listingId, t);
  });
  const topListings = [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((t) => ({ ...t, revenueLabel: money(t.revenue) }));

  // Stock
  const visible = listings.filter((l) => [LISTING_STATUS.ACTIVE, LISTING_STATUS.PAUSED].includes(l.status));
  const states = visible.map((l) => ({ l, s: stockState(l) }));
  const byStatus = Object.fromEntries(Object.values(LISTING_STATUS).map((s) => [s, 0]));
  listings.forEach((l) => {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
  });

  const perf = performance(now);
  const cards = {
    sales: P.compare(cur.gross, prev.gross),
    netSales: P.compare(cur.net, prev.net),
    orders: P.compare(cur.orders, prev.orders),
    avgOrder: P.compare(cur.avgOrder, prev.avgOrder),
    refunds: P.compare(refundSum(p.from, p.to), refundSum(p.prevFrom, p.prevTo)),
    payoutReleased: P.compare(released(p.from, p.to), released(p.prevFrom, p.prevTo)),
    payoutHeld: { value: payoutHeld },
  };

  return {
    role: 'seller',
    account: { status: account ? account.status : null, vatStatus: account ? account.vatStatus : null },
    cards,
    labels: moneyLabels({ sales: cards.sales, netSales: cards.netSales, avgOrder: cards.avgOrder, refunds: cards.refunds, payoutReleased: cards.payoutReleased, payoutHeld: cards.payoutHeld }),
    attention: {
      toConfirm: sos.filter((so) => so.status === 'paid').length,
      lateToConfirm: sos.filter((so) => so.status === 'paid' && so.confirmBy && new Date(so.confirmBy) < new Date()).length,
      toDispatch: sos.filter((so) => ['confirmed', 'packed'].includes(so.status)).length,
      cancelRequests: sos.filter((so) => so.openCancelRequestId).length,
      openClaims: sos.filter((so) => so.claimStatus === 'active').length,
      listingsRejected: byStatus[LISTING_STATUS.REJECTED] || 0,
      listingsPending: byStatus[LISTING_STATUS.PENDING] || 0,
      listingsHiddenForVat: listings.filter((l) => l.vatHold).length,
    },
    charts: {
      sales: P.series(p, now.filter((so) => so.status !== 'cancelled'), (so) => so.paidAt, { sales: (so) => num(so.total), orders: () => 1 }),
      ordersByStatus: Object.entries(countBy(now, (so) => so.status)).map(([status, count]) => ({ status, label: SELLER_ORDER_STATUS_LABELS[status] || status, count })),
      topListings,
    },
    stock: {
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, label: LISTING_STATUS_LABELS[status] || status, count })),
      total: listings.length,
      lowStock: states.filter((x) => x.s === 'low').length,
      outOfStock: states.filter((x) => x.s === 'out').length,
      lowStockItems: states
        .filter((x) => ['low', 'out'].includes(x.s))
        .sort((a, b) => num(a.l.quantity) - num(b.l.quantity))
        .slice(0, 10)
        .map(({ l, s }) => ({ id: l.id, name: l.name, quantity: num(l.quantity), unit: l.quantityUnit || l.priceUnit, minOrderQuantity: l.minOrderQuantity === null ? null : num(l.minOrderQuantity), state: s })),
    },
    performance: {
      ...perf,
      wishlistSaves: { total: wishlist.length, inPeriod: wishlist.filter((w) => P.inRange(w.createdAt, p.from, p.to)).length },
      enquiries: { inPeriod: enquiries, unread, connected: chat.connected },
    },
  };
}

// ======================= BUYER =======================
async function buyer(user, p) {
  const nowDate = new Date();
  const [orders, refunds, claims, addresses, wishlist, notifications, messages] = await Promise.all([
    Order.findAll({ where: { userId: user.id }, attributes: ['id', 'orderNumber', 'status', 'total', 'paymentMethod', 'paymentDeadline', 'paidAt', 'createdAt'], order: [['createdAt', 'DESC']] }),
    Refund.findAll({ where: { buyerId: user.id }, attributes: ['id', 'amount', 'status', 'bankDetails', 'paidAt', 'createdAt'] }),
    Claim.count({ where: { buyerId: user.id, status: { [Op.in]: ['open', 'rejected', 'escalated', 'awaiting_return'] } } }),
    Address.count({ where: { userId: user.id } }),
    WishlistItem.count({ where: { userId: user.id } }),
    Notification.count({ where: { userId: user.id, readAt: null } }),
    safe(chat.unreadMessages(user.id)),
  ]);
  const orderIds = orders.map((o) => o.id);
  const toReceive = orderIds.length
    ? await SellerOrder.findAll({ where: { orderId: orderIds, status: { [Op.in]: ['dispatched', 'ready_for_pickup'] } }, attributes: ['id', 'orderId', 'sellerOrderNumber', 'status'] })
    : [];

  const paid = (from, to) => orders.filter((o) => P.inRange(o.paidAt, from, to));
  const spent = (list) => round2(list.reduce((s, o) => s + num(o.total), 0));
  const refundPaid = (from, to) => round2(refunds.filter((r) => r.status === 'paid' && P.inRange(r.paidAt, from, to)).reduce((s, r) => s + num(r.amount), 0));
  const pending = refunds.filter((r) => r.status !== 'paid');
  const cur = paid(p.from, p.to);
  const prev = paid(p.prevFrom, p.prevTo);

  const cards = {
    orders: P.compare(cur.length, prev.length),
    spent: P.compare(spent(cur), spent(prev)),
    refundsReceived: P.compare(refundPaid(p.from, p.to), refundPaid(p.prevFrom, p.prevTo)),
    refundsPending: { value: round2(pending.reduce((s, r) => s + num(r.amount), 0)), count: pending.length },
  };
  const waiting = orders.filter((o) => ['awaiting_payment', 'under_review'].includes(o.status));
  return {
    role: 'buyer',
    cards,
    labels: moneyLabels({ spent: cards.spent, refundsReceived: cards.refundsReceived, refundsPending: cards.refundsPending }),
    attention: {
      awaitingPayment: waiting.slice(0, 5).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        statusLabel: ORDER_STATUS_LABELS[o.status],
        total: num(o.total),
        totalLabel: money(o.total),
        paymentMethod: o.paymentMethod,
        paymentDeadline: o.paymentDeadline,
        secondsLeft: o.status === 'awaiting_payment' && o.paymentDeadline ? Math.max(0, Math.floor((new Date(o.paymentDeadline) - nowDate) / 1000)) : null,
      })),
      awaitingPaymentCount: waiting.length,
      toConfirmReceived: toReceive.map((so) => ({ orderId: so.orderId, sellerOrderId: so.id, sellerOrderNumber: so.sellerOrderNumber, status: so.status, statusLabel: SELLER_ORDER_STATUS_LABELS[so.status] })),
      refundsNeedBankDetails: pending.filter((r) => !r.bankDetails).length,
      openClaims: claims,
    },
    charts: {
      spending: P.series(p, cur, (o) => o.paidAt, { spent: (o) => num(o.total), orders: () => 1 }),
      ordersByStatus: Object.entries(countBy(orders.filter((o) => P.inRange(o.createdAt, p.from, p.to)), (o) => o.status)).map(([status, count]) => ({ status, label: ORDER_STATUS_LABELS[status] || status, count })),
    },
    recentOrders: orders.slice(0, 5).map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status, statusLabel: ORDER_STATUS_LABELS[o.status], total: num(o.total), totalLabel: money(o.total), createdAt: o.createdAt })),
    counts: { savedAddresses: addresses, wishlist, unreadNotifications: notifications, unreadMessages: messages, messagesConnected: chat.connected, totalOrders: orders.length },
  };
}

// ======================= LOGISTICS =======================
// Stable pseudo-random numbers (same user + same day = same sample), clearly marked as sample data
function sampleNumber(seed, min, max) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return min + (h % (max - min + 1));
}

async function logistics(user, p) {
  const [account, docs, listings, unread] = await Promise.all([
    User.findByPk(user.id, { attributes: ['id', 'status', 'approvedAt'] }),
    UserDocument.findAll({ where: { userId: user.id }, attributes: ['status'] }),
    Listing.findAll({ where: { userId: user.id }, attributes: ['id', 'status'] }),
    Notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  const byStatus = countBy(listings, (l) => l.status);
  const sampleSeries = P.series(p, [], () => null, { bookings: () => 0, revenue: () => 0 }).map((b) => {
    const bookings = sampleNumber(`${user.id}-${b.key}-b`, 0, p.bucket === 'day' ? 4 : p.bucket === 'week' ? 18 : 60);
    return { ...b, bookings, revenue: bookings * sampleNumber(`${user.id}-${b.key}-r`, 350, 1200) };
  });
  const bookings = sampleSeries.reduce((s, b) => s + b.bookings, 0);
  const revenue = sampleSeries.reduce((s, b) => s + b.revenue, 0);
  return {
    role: 'logistics',
    account: {
      status: account ? account.status : null,
      approvedAt: account ? account.approvedAt : null,
      documents: countBy(docs, (d) => d.status),
    },
    listings: {
      total: listings.length,
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, label: LISTING_STATUS_LABELS[status] || status, count })),
    },
    counts: { unreadNotifications: unread },
    sample: {
      isSample: true,
      note: 'Sample data. Real figures appear here once service bookings (transport, warehousing, equipment leasing) are live.',
      cards: {
        bookings: { value: bookings },
        revenue: { value: revenue, label: money(revenue) },
        completionRate: { value: sampleNumber(`${user.id}-${p.key}-c`, 82, 98) },
        avgRating: { value: sampleNumber(`${user.id}-${p.key}-a`, 38, 49) / 10 },
      },
      charts: { bookings: sampleSeries },
    },
  };
}

// ======================= entry =======================
async function forUser(user, query = {}) {
  const p = P.resolve(query);
  let data;
  if (['farmer', 'trader'].includes(user.userType)) data = await seller(user, p);
  else if (user.userType === 'buyer') data = await buyer(user, p);
  else if (user.userType === 'logistics') data = await logistics(user, p);
  else throw new ApiError(403, 'There is no dashboard for this account type', { code: 'DASHBOARD_NOT_AVAILABLE' });
  return { userType: user.userType, period: P.periodShape(p), generatedAt: new Date(), ...data };
}

module.exports = { forUser, stockState };
