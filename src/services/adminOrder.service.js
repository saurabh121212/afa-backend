// ADMIN: Orders & Transactions (/admin/orders) and the payment review queue (/admin/payments).
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const { sellerShape } = require('./marketplace.service');
const { toCsvLine } = require('../utils/csv');
const { getPagination, paginationMeta } = require('../utils/pagination');
const shared = require('./orderShared');
const { ORDER_STATUS, ORDER_STATUS_LABELS, SELLER_ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS_LABELS } = require('../config/orders');

const { sequelize, Order, SellerOrder, Payment, User, CancellationRequest, Claim, Refund } = models;
const cancellations = require('./cancellation.service');
const claims = require('./claim.service');
const refunds = require('./refund.service');
const invoices = require('./invoice.service');
const { num, money, round2, totalsShape, sellerOrderShape, paymentShape, sortedPayments, timeline, fullIncludes, loadOrder, orderNotFound, isLate } = shared;

// ---------- orders ----------
async function buildWhere(query = {}) {
  const where = {};
  if (query.status) where.status = query.status;
  if (query.kind) where.kind = query.kind; // product | booking
  if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
  if (query.from || query.to) {
    where.createdAt = { ...(query.from ? { [Op.gte]: query.from } : {}), ...(query.to ? { [Op.lte]: query.to } : {}) };
  }
  if (query.sellerId) {
    const sos = await SellerOrder.findAll({ where: { sellerId: query.sellerId }, attributes: ['orderId'] });
    where.id = sos.map((s) => s.orderId).concat(0);
  }
  if (query.search) {
    const buyerIds = await directory.findUserIdsByName(query.search);
    const sellerOrders = await SellerOrder.findAll({ where: { sellerOrderNumber: { [Op.like]: `%${query.search}%` } }, attributes: ['orderId'] });
    where[Op.or] = [
      { orderNumber: { [Op.like]: `%${query.search}%` } },
      ...(buyerIds.length ? [{ userId: buyerIds }] : []),
      ...(sellerOrders.length ? [{ id: sellerOrders.map((s) => s.orderId) }] : []),
    ];
  }
  return where;
}

async function shapeMany(orders, { full = false } = {}) {
  const userIds = [
    ...new Set(orders.flatMap((o) => [o.userId, ...(o.sellerOrders || []).map((so) => so.sellerId)])),
  ];
  const [dirs, users] = await Promise.all([
    directory.findMany(userIds),
    User.findAll({ where: { id: orders.map((o) => o.userId) }, attributes: ['id', 'email', 'mobile'] }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  return orders.map((o) => {
    const buyerDir = dirs.get(o.userId);
    const buyerUser = userById.get(o.userId);
    const sellerOrders = (o.sellerOrders || []).slice().sort((a, b) => a.id - b.id);
    const out = {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
      placedAt: o.createdAt,
      paidAt: o.paidAt,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      cancelledBy: o.cancelledBy,
      paymentMethod: o.paymentMethod,
      paymentMethodLabel: PAYMENT_METHODS[o.paymentMethod],
      paymentDeadline: o.paymentDeadline,
      buyer: {
        id: o.userId,
        name: buyerDir ? buyerDir.display_name : null,
        email: buyerUser ? buyerUser.email : null,
        mobile: buyerUser ? buyerUser.mobile : null,
      },
      totals: totalsShape(o),
      sellerOrders: sellerOrders.map((so) => ({
        ...sellerOrderShape(so, { view: 'admin', seller: sellerShape(so.sellerId, dirs.get(so.sellerId)), history: full ? o.history || [] : [] }),
        ...(full ? {} : { items: undefined, timeline: undefined, itemsCount: (so.items || []).length }),
      })),
      hasLateSellerOrder: sellerOrders.some(isLate),
    };
    if (full) {
      out.deliveryAddress = o.deliveryAddress;
      out.payments = sortedPayments(o).map((p) => paymentShape(p, { view: 'admin' }));
      out.timeline = timeline(o.history || []);
      out.termsAcceptedAt = o.termsAcceptedAt;
    } else {
      const latest = sortedPayments(o)[0];
      out.latestPayment = latest ? paymentShape(latest, { view: 'admin' }) : null;
    }
    return out;
  });
}

// GET /admin/orders/stats
async function stats() {
  const grouped = await Order.findAll({
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total'], [sequelize.fn('SUM', sequelize.col('total')), 'amount']],
    group: ['status'],
    raw: true,
  });
  const byStatus = Object.fromEntries(Object.values(ORDER_STATUS).map((s) => [s, { count: 0, amount: 0 }]));
  grouped.forEach((g) => {
    byStatus[g.status] = { count: Number(g.total), amount: round2(g.amount || 0) };
  });
  const [lateSellerOrders, paymentsToReview, cancelRequestsToDecide, claimsToDecide, refundsToPay] = await Promise.all([
    SellerOrder.count({ where: { status: SELLER_ORDER_STATUS.PAID, confirmBy: { [Op.lt]: new Date() } } }),
    Payment.count({ where: { method: 'bank_transfer', status: 'under_review' } }),
    CancellationRequest.count({ where: { status: 'escalated' } }),
    Claim.count({ where: { status: 'escalated' } }),
    Refund.count({ where: { status: 'pending' } }),
  ]);
  return {
    totalOrders: Object.values(byStatus).reduce((n, s) => n + s.count, 0),
    awaitingPayment: byStatus.awaiting_payment.count,
    paymentUnderReview: byStatus.under_review.count,
    paid: byStatus.paid.count,
    cancelled: byStatus.cancelled.count,
    paidValue: byStatus.paid.amount,
    paidValueLabel: money(byStatus.paid.amount),
    lateSellerOrders,
    paymentsToReview,
    cancelRequestsToDecide,
    claimsToDecide,
    refundsToPay,
  };
}

// GET /admin/orders
async function list(query = {}) {
  const pg = getPagination(query);
  const { rows, count } = await Order.findAndCountAll({
    where: await buildWhere(query),
    order: [['createdAt', query.sort === 'oldest' ? 'ASC' : 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  const full = rows.length
    ? await Order.findAll({ where: { id: rows.map((r) => r.id) }, include: fullIncludes(), order: [['createdAt', query.sort === 'oldest' ? 'ASC' : 'DESC'], ['id', 'DESC']] })
    : [];
  return { items: await shapeMany(full), pagination: paginationMeta(pg, count) };
}

// GET /admin/orders/:id   (+ cancellation requests, claims and refunds)
async function getById(id) {
  const order = await loadOrder({ id });
  if (!order) throw orderNotFound();
  const shaped = (await shapeMany([order], { full: true }))[0];
  const soIds = shaped.sellerOrders.map((so) => so.id);
  const [requests, claimRows, refundRows, documents] = await Promise.all([
    cancellations.requestsFor(soIds),
    claims.claimsFor({ type: 'admin' }, soIds),
    refunds.shapeMany((order.refunds || []).slice().sort((a, b) => b.id - a.id), { view: 'admin' }),
    invoices.documentsFor({ type: 'admin' }, order.id),
  ]);
  shaped.sellerOrders = shaped.sellerOrders.map((so) => ({
    ...so,
    cancelRequests: requests.filter((r) => r.sellerOrder.id === so.id),
    claims: claimRows.filter((c) => c.sellerOrder.id === so.id),
    remainingRefundable: shared.round2(so.total - so.refundedAmount),
    actions: {
      canCancel: !['awaiting_payment', 'completed', 'cancelled'].includes(so.status),
      canRefund: Boolean(so.dates.paidAt) && so.total - so.refundedAmount > 0,
    },
  }));
  shaped.refunds = refundRows;
  shaped.documents = documents;
  shaped.refundedTotal = shared.round2(refundRows.reduce((s, r) => s + r.amount, 0));
  return shaped;
}

// GET /admin/orders/export
async function exportCsv(query = {}) {
  const rows = await Order.findAll({ where: await buildWhere(query), include: fullIncludes(), order: [['createdAt', 'DESC']], limit: 5000 });
  const shaped = await shapeMany(rows);
  const lines = [
    toCsvLine(['Order Number', 'Placed At', 'Buyer', 'Status', 'Payment Method', 'Paid At', 'Sellers', 'Subtotal (E)', 'Delivery (E)', 'VAT (E)', 'Total (E)']),
    ...shaped.map((o) =>
      toCsvLine([
        o.orderNumber,
        new Date(o.placedAt).toISOString(),
        o.buyer.name || o.buyer.email || '',
        o.statusLabel,
        o.paymentMethodLabel,
        o.paidAt ? new Date(o.paidAt).toISOString() : '',
        o.sellerOrders.map((so) => `${so.sellerOrderNumber} ${so.seller && so.seller.name ? so.seller.name : ''} (${so.statusLabel})`).join('; '),
        o.totals.subtotal.toFixed(2),
        o.totals.deliveryTotal.toFixed(2),
        o.totals.vatTotal.toFixed(2),
        o.totals.total.toFixed(2),
      ])
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// ---------- payments (review queue) ----------
async function paymentStats() {
  const grouped = await Payment.findAll({
    attributes: ['method', 'status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['method', 'status'],
    raw: true,
  });
  const count = (method, status) => {
    const row = grouped.find((g) => g.method === method && g.status === status);
    return row ? Number(row.total) : 0;
  };
  return {
    toReview: count('bank_transfer', 'under_review'),
    bankConfirmed: count('bank_transfer', 'succeeded'),
    bankRejected: count('bank_transfer', 'rejected'),
    onlineSucceeded: count('online', 'succeeded'),
    onlineFailed: count('online', 'failed'),
    onlinePending: count('online', 'pending'),
  };
}

async function paymentRows(rows) {
  const orders = await Order.findAll({ where: { id: [...new Set(rows.map((p) => p.orderId))] }, attributes: ['id', 'orderNumber', 'userId', 'status', 'total', 'paymentDeadline'] });
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const dirs = await directory.findMany(orders.map((o) => o.userId));
  return rows.map((p) => {
    const o = orderById.get(p.orderId);
    const dir = o ? dirs.get(o.userId) : null;
    return {
      ...paymentShape(p, { view: 'admin' }),
      order: o
        ? { id: o.id, orderNumber: o.orderNumber, status: o.status, statusLabel: ORDER_STATUS_LABELS[o.status], total: num(o.total), totalLabel: money(o.total), paymentDeadline: o.paymentDeadline }
        : null,
      buyer: o ? { id: o.userId, name: dir ? dir.display_name : null } : null,
      amountMatches: p.amountPaid === null ? null : round2(p.amountPaid) >= round2(p.amount),
    };
  });
}

// GET /admin/payments?status=under_review&method=&search=&page=
async function listPayments(query = {}) {
  const pg = getPagination(query);
  const where = {};
  if (query.status) where.status = query.status;
  if (query.method) where.method = query.method;
  if (query.search) {
    const orders = await Order.findAll({ where: { orderNumber: { [Op.like]: `%${query.search}%` } }, attributes: ['id'] });
    where.orderId = orders.map((o) => o.id).concat(0);
  }
  const { rows, count } = await Payment.findAndCountAll({
    where,
    // Waiting ones: oldest first (first in, first checked)
    order: [['createdAt', query.status === 'under_review' ? 'ASC' : 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: await paymentRows(rows), pagination: paginationMeta(pg, count) };
}

// GET /admin/payments/:id
async function getPayment(id) {
  const payment = await Payment.findByPk(id);
  if (!payment) throw new ApiError(404, 'Payment not found', { code: 'PAYMENT_NOT_FOUND' });
  return (await paymentRows([payment]))[0];
}

module.exports = { stats, list, getById, exportCsv, paymentStats, listPayments, getPayment, PAYMENT_STATUS_LABELS };
