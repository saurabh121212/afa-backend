// GET /me/dashboard  -> the logged-in user's dashboard, by user type:
//   farmer, trader -> seller dashboard (sales, revenue, orders, stock, performance, enquiries, rating, credit score)
//   buyer          -> buyer dashboard (orders, bookings, payments, refunds, addresses, wishlist, messages)
//   logistics      -> service provider dashboard (bookings, revenue, upcoming jobs, services, rating, credit score)
//   financial_institution -> no dashboard (403)
//
// Always live (no cache). Every money figure has a ready "labels" text (E 1,234.50).
// Bookings are seller orders with fulfilment "service" (see config/bookings.js).
const { Op } = require('sequelize');
const models = require('../../models');
const ApiError = require('../../utils/ApiError');
const chat = require('./chatStats');
const P = require('./periods');
const { paidIn, salesOf, performance, countBy } = require('./metrics');
const { round2, num, money } = require('../orderShared');
const { ORDER_STATUS_LABELS, SELLER_ORDER_STATUS_LABELS, ORDER_KINDS, statusLabelFor } = require('../../config/orders');
const { LISTING_STATUS, LISTING_STATUS_LABELS } = require('../../config/listingOptions');
const { todayYmd } = require('../../config/bookings');

const { SellerOrder, Order, OrderItem, Listing, WishlistItem, Refund, Claim, Address, Notification, User, UserDocument, Booking, CreditScore } = models;

const moneyLabels = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, money(v && typeof v === 'object' ? v.value : v)]));
const safe = (p, fallback = 0) => Promise.resolve(p).catch((err) => {
  console.error('Dashboard: chat count failed:', err.message);
  return fallback;
});

const SERVICE = 'service';
const GRADE_LABELS = { excellent: 'Excellent', good: 'Good', fair: 'Fair', building: 'Building' };

// "4.6 (12 reviews)" -> { value: 4.6, count: 12 }; value is null with no published reviews (all-time)
const ratingCard = (u) => ({
  value: u && u.ratingAvg !== null && u.ratingAvg !== undefined && Number(u.ratingCount) > 0 ? round2(u.ratingAvg) : null,
  count: u ? Number(u.ratingCount || 0) : 0,
});

// Small credit score card (null until the first calculation; GET /me/credit-score calculates it)
async function creditScoreSummary(userId) {
  if (!CreditScore) return null;
  const row = await CreditScore.findOne({ where: { userId }, attributes: ['score', 'grade', 'calculatedAt'] }).catch(() => null);
  if (!row) return null;
  return { score: Number(row.score), maxScore: 100, grade: row.grade, gradeLabel: GRADE_LABELS[row.grade] || row.grade, calculatedAt: row.calculatedAt };
}

// A rate card: { value, previous, change, trend }; value null = nothing to measure in the period
function rateCard(cur, prev) {
  if (cur === null) return { value: null, previous: prev, change: null, trend: 'flat' };
  const c = P.compare(cur, prev === null ? 0 : prev);
  return prev === null ? { ...c, previous: null, change: null } : c;
}

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
  const [sos, listings, account, creditScore] = await Promise.all([
    SellerOrder.findAll({
      where: { sellerId: user.id, paidAt: { [Op.ne]: null } },
      attributes: ['id', 'status', 'total', 'refundedAmount', 'paidAt', 'confirmBy', 'confirmedAt', 'deliveredAt', 'completedAt', 'cancelledAt', 'cancelledBy', 'claimStatus', 'payoutStatus', 'payoutAmount', 'openCancelRequestId'],
    }),
    Listing.findAll({ where: { userId: user.id }, attributes: ['id', 'name', 'status', 'quantity', 'quantityUnit', 'priceUnit', 'minOrderQuantity', 'vatHold'] }),
    User.findByPk(user.id, { attributes: ['id', 'status', 'vatStatus', 'ratingAvg', 'ratingCount'] }),
    creditScoreSummary(user.id),
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
    rating: ratingCard(account),
  };

  return {
    role: 'seller',
    account: { status: account ? account.status : null, vatStatus: account ? account.vatStatus : null },
    cards,
    labels: moneyLabels({ sales: cards.sales, netSales: cards.netSales, avgOrder: cards.avgOrder, refunds: cards.refunds, payoutReleased: cards.payoutReleased, payoutHeld: cards.payoutHeld }),
    creditScore,
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
    Order.findAll({ where: { userId: user.id }, attributes: ['id', 'orderNumber', 'kind', 'status', 'total', 'paymentMethod', 'paymentDeadline', 'paidAt', 'createdAt'], order: [['createdAt', 'DESC']] }),
    Refund.findAll({ where: { buyerId: user.id }, attributes: ['id', 'amount', 'status', 'bankDetails', 'paidAt', 'createdAt'] }),
    Claim.count({ where: { buyerId: user.id, status: { [Op.in]: ['open', 'rejected', 'escalated', 'awaiting_return'] } } }),
    Address.count({ where: { userId: user.id } }),
    WishlistItem.count({ where: { userId: user.id } }),
    Notification.count({ where: { userId: user.id, readAt: null } }),
    safe(chat.unreadMessages(user.id)),
  ]);
  const orderIds = orders.map((o) => o.id);
  const [toReceive, serviceDone] = orderIds.length
    ? await Promise.all([
      SellerOrder.findAll({ where: { orderId: orderIds, fulfilment: { [Op.ne]: SERVICE }, status: { [Op.in]: ['dispatched', 'ready_for_pickup'] } }, attributes: ['id', 'orderId', 'sellerOrderNumber', 'status', 'fulfilment'] }),
      SellerOrder.findAll({
        where: { orderId: orderIds, fulfilment: SERVICE, status: 'delivered' },
        attributes: ['id', 'orderId', 'sellerOrderNumber', 'status', 'fulfilment', 'completeAfter', 'claimStatus'],
        include: [{ model: Booking, as: 'booking', attributes: ['id', 'bookingNumber'] }],
      }),
    ])
    : [[], []];

  const paid = (from, to) => orders.filter((o) => P.inRange(o.paidAt, from, to));
  const spent = (list) => round2(list.reduce((s, o) => s + num(o.total), 0));
  const refundPaid = (from, to) => round2(refunds.filter((r) => r.status === 'paid' && P.inRange(r.paidAt, from, to)).reduce((s, r) => s + num(r.amount), 0));
  const pending = refunds.filter((r) => r.status !== 'paid');
  const cur = paid(p.from, p.to);
  const prev = paid(p.prevFrom, p.prevTo);
  const kindOf = (o) => o.kind || 'product';

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
        kind: kindOf(o),
        status: o.status,
        statusLabel: ORDER_STATUS_LABELS[o.status],
        total: num(o.total),
        totalLabel: money(o.total),
        paymentMethod: o.paymentMethod,
        paymentDeadline: o.paymentDeadline,
        secondsLeft: o.status === 'awaiting_payment' && o.paymentDeadline ? Math.max(0, Math.floor((new Date(o.paymentDeadline) - nowDate) / 1000)) : null,
      })),
      awaitingPaymentCount: waiting.length,
      toConfirmReceived: toReceive.map((so) => ({ orderId: so.orderId, sellerOrderId: so.id, sellerOrderNumber: so.sellerOrderNumber, status: so.status, statusLabel: statusLabelFor(so) })),
      // bookings marked "Service Done": the buyer confirms or reports a problem (auto-completes at completeAfter)
      toConfirmServiceDone: serviceDone
        .filter((so) => (so.claimStatus || 'none') !== 'active')
        .map((so) => ({
          orderId: so.orderId,
          sellerOrderId: so.id,
          sellerOrderNumber: so.sellerOrderNumber,
          bookingId: so.booking ? so.booking.id : null,
          bookingNumber: so.booking ? so.booking.bookingNumber : null,
          status: so.status,
          statusLabel: statusLabelFor(so),
          completeAfter: so.completeAfter,
        })),
      refundsNeedBankDetails: pending.filter((r) => !r.bankDetails).length,
      openClaims: claims,
    },
    charts: {
      spending: P.series(p, cur, (o) => o.paidAt, { spent: (o) => num(o.total), orders: () => 1 }),
      ordersByStatus: Object.entries(countBy(orders.filter((o) => P.inRange(o.createdAt, p.from, p.to)), (o) => o.status)).map(([status, count]) => ({ status, label: ORDER_STATUS_LABELS[status] || status, count })),
    },
    recentOrders: orders.slice(0, 5).map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      kind: kindOf(o),
      kindLabel: ORDER_KINDS[kindOf(o)] || kindOf(o),
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
      total: num(o.total),
      totalLabel: money(o.total),
      createdAt: o.createdAt,
    })),
    counts: {
      savedAddresses: addresses,
      wishlist,
      unreadNotifications: notifications,
      unreadMessages: messages,
      messagesConnected: chat.connected,
      totalOrders: orders.filter((o) => kindOf(o) === 'product').length,
      totalBookings: orders.filter((o) => kindOf(o) === 'booking').length,
    },
  };
}

// ======================= LOGISTICS (service provider) =======================
const UNAVAILABLE = ['booked', 'maintenance']; // listing availability values that mean "not bookable right now"
const UPCOMING_STATUSES = ['paid', 'confirmed', 'in_progress'];

async function logistics(user, p) {
  const [account, docs, listings, unread, creditScore, sos] = await Promise.all([
    User.findByPk(user.id, { attributes: ['id', 'status', 'approvedAt', 'kycVerifiedAt', 'ratingAvg', 'ratingCount'] }),
    UserDocument.findAll({ where: { userId: user.id }, attributes: ['status'] }),
    Listing.findAll({ where: { userId: user.id }, attributes: ['id', 'name', 'status', 'availability'] }),
    Notification.count({ where: { userId: user.id, readAt: null } }),
    creditScoreSummary(user.id),
    SellerOrder.findAll({
      where: { sellerId: user.id, fulfilment: SERVICE, paidAt: { [Op.ne]: null } },
      attributes: ['id', 'orderId', 'sellerOrderNumber', 'fulfilment', 'status', 'total', 'refundedAmount', 'paidAt', 'confirmBy', 'confirmedAt', 'startedAt', 'deliveredAt', 'completedAt', 'cancelledAt', 'cancelledBy', 'claimStatus', 'payoutStatus', 'payoutAmount', 'openCancelRequestId'],
    }),
  ]);

  const soIds = sos.map((so) => so.id);
  const now = paidIn(sos, p.from, p.to);
  const before = paidIn(sos, p.prevFrom, p.prevTo);
  const cur = salesOf(now);
  const prev = salesOf(before);
  const liveNowIds = now.filter((so) => so.status !== 'cancelled').map((so) => so.id);

  const [bookings, refunds, items] = await Promise.all([
    soIds.length ? Booking.findAll({ where: { sellerOrderId: soIds }, attributes: ['id', 'bookingNumber', 'sellerOrderId', 'listingId', 'bookingType', 'startDate', 'endDate', 'startTime'] }) : [],
    soIds.length ? Refund.findAll({ where: { sellerOrderId: soIds, createdAt: { [Op.gte]: p.prevFrom } }, attributes: ['amount', 'createdAt'] }) : [],
    soIds.length ? OrderItem.findAll({ where: { sellerOrderId: soIds }, attributes: ['sellerOrderId', 'listingId', 'name', 'quantity', 'lineTotal'] }) : [],
  ]);
  const bookingOf = new Map(bookings.map((b) => [b.sellerOrderId, b]));
  const itemOf = new Map(items.map((i) => [i.sellerOrderId, i]));

  const refundSum = (from, to) => round2(refunds.filter((r) => P.inRange(r.createdAt, from, to)).reduce((s, r) => s + num(r.amount), 0));
  const released = (from, to) =>
    round2(sos.filter((so) => so.payoutStatus === 'released' && P.inRange(so.completedAt || so.cancelledAt, from, to)).reduce((s, so) => s + num(so.payoutAmount), 0));
  const payoutHeld = round2(sos.filter((so) => so.payoutStatus === 'held').reduce((s, so) => s + num(so.payoutAmount), 0));
  // completed / (completed + cancelled), of the bookings paid in the period; null when none has finished yet
  const completion = (list) => {
    const done = list.filter((so) => so.status === 'completed').length;
    const cancelled = list.filter((so) => so.status === 'cancelled').length;
    return done + cancelled ? Math.round((done / (done + cancelled)) * 1000) / 10 : null;
  };

  const cards = {
    bookings: P.compare(cur.orders, prev.orders),
    revenue: P.compare(cur.gross, prev.gross),
    netRevenue: P.compare(cur.net, prev.net),
    avgBooking: P.compare(cur.avgOrder, prev.avgOrder),
    refunds: P.compare(refundSum(p.from, p.to), refundSum(p.prevFrom, p.prevTo)),
    completionRate: rateCard(completion(now), completion(before)),
    payoutReleased: P.compare(released(p.from, p.to), released(p.prevFrom, p.prevTo)),
    payoutHeld: { value: payoutHeld },
    avgRating: ratingCard(account),
  };

  // Upcoming jobs: not finished yet, by start date (jobs already in progress first)
  const today = todayYmd();
  const upcomingAll = sos
    .filter((so) => UPCOMING_STATUSES.includes(so.status))
    .map((so) => ({ so, b: bookingOf.get(so.id), i: itemOf.get(so.id) }))
    .filter((x) => x.b && (x.so.status === 'in_progress' || String(x.b.endDate) >= today))
    .sort((a, c) => (a.so.status === 'in_progress' ? 0 : 1) - (c.so.status === 'in_progress' ? 0 : 1) || String(a.b.startDate).localeCompare(String(c.b.startDate)) || a.so.id - c.so.id);
  const upcoming = upcomingAll.slice(0, 5).map(({ so, b, i }) => ({
    orderId: so.orderId,
    sellerOrderId: so.id,
    sellerOrderNumber: so.sellerOrderNumber,
    bookingId: b.id,
    bookingNumber: b.bookingNumber,
    listingId: b.listingId,
    service: i ? i.name : null,
    bookingType: b.bookingType,
    startDate: b.startDate,
    endDate: b.endDate,
    startTime: b.startTime || null,
    status: so.status,
    statusLabel: statusLabelFor(so),
    total: num(so.total),
    totalLabel: money(so.total),
  }));

  // Top services (by revenue of bookings paid in the period)
  const top = new Map();
  items
    .filter((i) => liveNowIds.includes(i.sellerOrderId))
    .forEach((i) => {
      const t = top.get(i.listingId) || { listingId: i.listingId, name: i.name, bookings: 0, revenue: 0 };
      t.bookings += 1;
      t.revenue = round2(t.revenue + num(i.lineTotal));
      top.set(i.listingId, t);
    });
  const topServices = [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((t) => ({ ...t, revenueLabel: money(t.revenue) }));

  const byStatus = countBy(listings, (l) => l.status);
  const active = listings.filter((l) => l.status === LISTING_STATUS.ACTIVE);

  return {
    role: 'logistics',
    account: {
      status: account ? account.status : null,
      approvedAt: account ? account.approvedAt : null,
      verified: Boolean(account && account.kycVerifiedAt),
      documents: countBy(docs, (d) => d.status),
    },
    cards,
    labels: moneyLabels({ revenue: cards.revenue, netRevenue: cards.netRevenue, avgBooking: cards.avgBooking, refunds: cards.refunds, payoutReleased: cards.payoutReleased, payoutHeld: cards.payoutHeld }),
    creditScore,
    attention: {
      toConfirm: sos.filter((so) => so.status === 'paid').length,
      lateToConfirm: sos.filter((so) => so.status === 'paid' && so.confirmBy && new Date(so.confirmBy) < new Date()).length,
      startingToday: sos.filter((so) => so.status === 'confirmed' && bookingOf.get(so.id) && String(bookingOf.get(so.id).startDate) === today).length,
      inProgress: sos.filter((so) => so.status === 'in_progress').length,
      awaitingBuyerConfirmation: sos.filter((so) => so.status === 'delivered').length,
      cancelRequests: sos.filter((so) => so.openCancelRequestId).length,
      openClaims: sos.filter((so) => so.claimStatus === 'active').length,
      listingsRejected: byStatus[LISTING_STATUS.REJECTED] || 0,
      listingsPending: byStatus[LISTING_STATUS.PENDING] || 0,
    },
    upcoming,
    charts: {
      bookings: P.series(p, now.filter((so) => so.status !== 'cancelled'), (so) => so.paidAt, { bookings: () => 1, revenue: (so) => num(so.total) }),
      bookingsByStatus: Object.entries(countBy(now, (so) => so.status)).map(([status, count]) => ({ status, label: statusLabelFor({ fulfilment: SERVICE, status }), count })),
      topServices,
    },
    performance: performance(now),
    listings: {
      total: listings.length,
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, label: LISTING_STATUS_LABELS[status] || status, count })),
      notAvailableNow: active.filter((l) => UNAVAILABLE.includes(l.availability)).length,
    },
    counts: { unreadNotifications: unread, totalBookings: sos.length },
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
