// ADMIN DASHBOARD: marketplace overview, active users, sales volume, seller performance, reports.
//
//   GET /admin/dashboard                         cards, to-do counters, charts, top sellers (cached 5 minutes)
//   GET /admin/dashboard/seller-performance      every seller in the period, sortable + paged
//   GET /admin/dashboard/reports/:report         CSV: sales-by-seller | sales-by-category | sales-by-region | registrations
//
// ?refresh=true skips the 5-minute cache. Definitions of sales / rates: see metrics.js.
const { Op } = require('sequelize');
const models = require('../../models');
const directory = require('../userDirectory');
const transactions = require('../transaction.service');
const P = require('./periods');
const { paidIn, salesOf, performance, groupBy, countBy, pct } = require('./metrics');
const { toCsvLine } = require('../../utils/csv');
const { getPagination, paginationMeta } = require('../../utils/pagination');
const { round2, num, money } = require('../orderShared');
const { SELLER_ORDER_STATUS_LABELS, PAYMENT_METHODS } = require('../../config/orders');
const { USER_TYPE_LABELS } = require('../../utils/constants');

const { SellerOrder, Order, OrderItem, Refund, User, Listing, Payment, Claim, CancellationRequest, ContactMessage } = models;

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

// ---------- loading (one period + the one before) ----------
async function load(p) {
  const since = { [Op.gte]: p.prevFrom };
  const [sos, orders, refunds, users] = await Promise.all([
    SellerOrder.findAll({
      where: { paidAt: since },
      attributes: ['id', 'orderId', 'sellerId', 'status', 'total', 'refundedAmount', 'paidAt', 'confirmBy', 'confirmedAt', 'deliveredAt', 'cancelledAt', 'cancelledBy', 'claimStatus'],
    }),
    Order.findAll({ where: { paidAt: since }, attributes: ['id', 'userId', 'kind', 'total', 'paymentMethod', 'paidAt'] }),
    Refund.findAll({ where: { createdAt: since }, attributes: ['id', 'amount', 'status', 'createdAt'] }),
    User.findAll({ attributes: ['id', 'userType', 'status', 'createdAt', 'submittedAt', 'approvedAt', 'lastLoginAt'] }),
  ]);
  return { sos, orders, refunds, users };
}

const sum = (list, f) => round2(list.reduce((s, x) => s + num(f(x)), 0));

async function todo() {
  const [registrations, listings, payments, vat, claims, cancelRequests, refunds, contact] = await Promise.all([
    User.count({ where: { status: 'pending_approval' } }),
    Listing.count({ where: { status: 'pending' } }),
    Payment.count({ where: { method: 'bank_transfer', status: 'under_review' } }),
    User.count({ where: { vatStatus: 'pending' } }),
    Claim.count({ where: { status: 'escalated' } }),
    CancellationRequest.count({ where: { status: 'escalated' } }),
    Refund.count({ where: { status: 'pending' } }),
    ContactMessage.count({ where: { status: 'new' } }),
  ]);
  return { registrations, listings, payments, vat, claims, cancelRequests, refunds, contactMessages: contact };
}

// Per seller: sales + performance in the period
async function sellerRows(sos) {
  const bySeller = groupBy(sos, (so) => so.sellerId);
  const ids = [...bySeller.keys()];
  const [dirs, users] = await Promise.all([
    directory.findMany(ids),
    ids.length ? User.findAll({ where: { id: ids }, attributes: ['id', 'userType'] }) : [],
  ]);
  const typeOf = new Map(users.map((u) => [u.id, u.userType]));
  return ids.map((id) => {
    const list = bySeller.get(id);
    const s = salesOf(list);
    const d = dirs.get(id) || {};
    return {
      sellerId: id,
      name: d.display_name || null,
      userType: typeOf.get(id) || d.user_type || null,
      userTypeLabel: USER_TYPE_LABELS[typeOf.get(id) || d.user_type] || null,
      region: d.region_name || null,
      sales: s.gross,
      refunded: s.refunded,
      netSales: s.net,
      avgOrder: s.avgOrder,
      labels: { sales: money(s.gross), refunded: money(s.refunded), netSales: money(s.net), avgOrder: money(s.avgOrder) },
      ...performance(list),
    };
  });
}

// Sales per buyer region (paid checkouts), biggest first
async function salesByRegion(orders) {
  const buyers = await directory.findMany([...new Set(orders.map((o) => o.userId))]);
  const map = new Map();
  orders.forEach((o) => {
    const name = (buyers.get(o.userId) || {}).region_name || 'Unknown';
    const r = map.get(name) || { region: name, orders: 0, buyers: new Set(), sales: 0 };
    r.orders += 1;
    r.buyers.add(o.userId);
    r.sales = round2(r.sales + num(o.total));
    map.set(name, r);
  });
  return [...map.values()]
    .sort((a, b) => b.sales - a.sales)
    .map((r) => ({ region: r.region, orders: r.orders, buyers: r.buyers.size, sales: r.sales, salesLabel: money(r.sales) }));
}

// ---------- GET /admin/dashboard ----------
async function build(p) {
  const { sos, orders, refunds, users } = await load(p);
  const curSo = paidIn(sos, p.from, p.to);
  const prevSo = paidIn(sos, p.prevFrom, p.prevTo);
  const curOrders = orders.filter((o) => P.inRange(o.paidAt, p.from, p.to));
  const prevOrders = orders.filter((o) => P.inRange(o.paidAt, p.prevFrom, p.prevTo));
  const cur = salesOf(curSo);
  const prev = salesOf(prevSo);
  const refundIn = (from, to) => sum(refunds.filter((r) => P.inRange(r.createdAt, from, to)), (r) => r.amount);
  const usersIn = (field, from, to) => users.filter((u) => P.inRange(u[field], from, to)).length;
  const aov = (list) => (list.length ? round2(sum(list, (o) => o.total) / list.length) : 0);

  const liveSo = curSo.filter((so) => so.status !== 'cancelled');
  const [todos, money_, regionRows, items, sellers] = await Promise.all([
    todo(),
    transactions.adminStats({}),
    directory.countByTypeAndRegion(),
    liveSo.length ? OrderItem.findAll({ where: { sellerOrderId: liveSo.map((so) => so.id) }, attributes: ['categoryName', 'quantity', 'lineTotal'] }) : [],
    sellerRows(curSo),
  ]);

  const regionSales = await salesByRegion(curOrders);

  // Top categories
  const cats = new Map();
  items.forEach((i) => {
    const name = i.categoryName || 'Other';
    const c = cats.get(name) || { category: name, lines: 0, sales: 0 };
    c.lines += 1;
    c.sales = round2(c.sales + num(i.lineTotal));
    cats.set(name, c);
  });

  const approved = users.filter((u) => u.status === 'approved');
  const cards = {
    sales: P.compare(cur.gross, prev.gross),
    netSales: P.compare(cur.net, prev.net),
    orders: P.compare(curOrders.length, prevOrders.length),
    avgOrder: P.compare(aov(curOrders), aov(prevOrders)),
    refunds: P.compare(refundIn(p.from, p.to), refundIn(p.prevFrom, p.prevTo)),
    activeUsers: P.compare(usersIn('lastLoginAt', p.from, p.to), usersIn('lastLoginAt', p.prevFrom, p.prevTo)),
    newRegistrations: P.compare(usersIn('submittedAt', p.from, p.to), usersIn('submittedAt', p.prevFrom, p.prevTo)),
    approvedUsers: { value: approved.length },
    activeSellers: P.compare(new Set(curSo.map((so) => so.sellerId)).size, new Set(prevSo.map((so) => so.sellerId)).size),
    // service bookings (included in sales and orders above)
    bookings: P.compare(curOrders.filter((o) => o.kind === 'booking').length, prevOrders.filter((o) => o.kind === 'booking').length),
    bookingSales: P.compare(sum(curOrders.filter((o) => o.kind === 'booking'), (o) => o.total), sum(prevOrders.filter((o) => o.kind === 'booking'), (o) => o.total)),
    moneyHeld: { value: money_.balanceHeld },
  };

  const byType = countBy(approved, (u) => u.userType);
  const regions = new Map();
  regionRows
    .filter((r) => r.status === 'approved')
    .forEach((r) => {
      const name = r.region_name || 'Unknown';
      regions.set(name, (regions.get(name) || 0) + r.total);
    });

  return {
    cards,
    labels: Object.fromEntries(['sales', 'netSales', 'avgOrder', 'refunds', 'moneyHeld', 'bookingSales'].map((k) => [k, money(cards[k].value)])),
    todo: todos,
    charts: {
      sales: P.series(p, curSo.filter((so) => so.status !== 'cancelled'), (so) => so.paidAt, { sales: (so) => num(so.total), orders: () => 1 }),
      registrations: P.series(p, users, (u) => u.submittedAt, { registrations: () => 1 }),
      ordersByStatus: Object.entries(countBy(curSo, (so) => so.status)).map(([status, count]) => ({ status, label: SELLER_ORDER_STATUS_LABELS[status] || status, count })),
      paymentMethods: [...groupBy(curOrders, (o) => o.paymentMethod).entries()].map(([method, list]) => ({
        method,
        label: PAYMENT_METHODS[method] || method,
        orders: list.length,
        amount: sum(list, (o) => o.total),
        share: pct(list.length, curOrders.length),
      })),
      usersByType: Object.entries(byType).map(([type, count]) => ({ userType: type, label: USER_TYPE_LABELS[type] || type, count })),
      usersByRegion: [...regions.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count),
      topCategories: [...cats.values()].sort((a, b) => b.sales - a.sales).slice(0, 10).map((c) => ({ ...c, salesLabel: money(c.sales) })),
      topRegions: regionSales.slice(0, 10),
    },
    topSellers: sellers.sort((a, b) => b.sales - a.sales).slice(0, 10),
  };
}

async function overview(query = {}) {
  const p = P.resolve(query);
  const key = JSON.stringify([p.key, p.from.toISOString().slice(0, 10), p.to.toISOString().slice(0, 10)]);
  const hit = cache.get(key);
  if (!query.refresh && hit && Date.now() - hit.at < CACHE_MS) {
    return { ...hit.data, cached: true, cacheAgeSeconds: Math.round((Date.now() - hit.at) / 1000) };
  }
  const data = { period: P.periodShape(p), generatedAt: new Date(), ...(await build(p)) };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return { ...data, cached: false, cacheAgeSeconds: 0 };
}

// ---------- GET /admin/dashboard/seller-performance ----------
// ?period&from&to&sort=sales|orders|netSales|onTimeConfirmRate|cancellationRate|claimRate&order=asc|desc&userType=&search=&page=
const SORTS = ['sales', 'netSales', 'orders', 'avgOrder', 'onTimeConfirmRate', 'cancellationRate', 'claimRate', 'refunded'];

async function sellerPerformance(query = {}) {
  const p = P.resolve(query);
  const sos = await SellerOrder.findAll({
    where: { paidAt: { [Op.gte]: p.from, [Op.lte]: p.to } },
    attributes: ['id', 'sellerId', 'status', 'total', 'refundedAmount', 'paidAt', 'confirmBy', 'confirmedAt', 'deliveredAt', 'cancelledAt', 'cancelledBy', 'claimStatus'],
  });
  let rows = await sellerRows(sos);
  if (query.userType) rows = rows.filter((r) => r.userType === query.userType);
  if (query.search) rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(String(query.search).toLowerCase()));
  const sort = SORTS.includes(query.sort) ? query.sort : 'sales';
  const dir = query.order === 'asc' ? 1 : -1;
  rows.sort((a, b) => dir * ((a[sort] === null ? -1 : a[sort]) - (b[sort] === null ? -1 : b[sort])) || a.sellerId - b.sellerId);
  const pg = getPagination(query);
  return { period: P.periodShape(p), sort, order: dir === 1 ? 'asc' : 'desc', items: rows.slice(pg.offset, pg.offset + pg.limit), pagination: paginationMeta(pg, rows.length) };
}

// ---------- GET /admin/dashboard/reports/:report (CSV) ----------
const REPORTS = ['sales-by-seller', 'sales-by-category', 'sales-by-region', 'registrations'];
const csv = (head, rows) => `${[toCsvLine(head), ...rows.map(toCsvLine)].join('\r\n')}\r\n`;
const fmt = (n) => (n === null || n === undefined ? '' : Number(n).toFixed(2));

async function report(name, query = {}) {
  const p = P.resolve(query);
  const range = `${p.from.toISOString().slice(0, 10)}_${p.to.toISOString().slice(0, 10)}`;
  if (name === 'sales-by-seller') {
    const { items } = await sellerPerformance({ ...query, page: 1, limit: 100000 });
    return {
      filename: `afa-sales-by-seller-${range}.csv`,
      content: csv(
        ['Seller', 'Type', 'Region', 'Orders', 'Sales (E)', 'Refunded (E)', 'Net Sales (E)', 'Avg Order (E)', 'On-time Confirm %', 'Avg Hours to Confirm', 'Cancelled by Seller', 'Auto-cancelled', 'Cancellation %', 'Claims', 'Claim %'],
        items.map((r) => [r.name, r.userTypeLabel, r.region, r.orders, fmt(r.sales), fmt(r.refunded), fmt(r.netSales), fmt(r.avgOrder), r.onTimeConfirmRate, r.avgConfirmHours, r.cancelledBySeller, r.autoCancelled, r.cancellationRate, r.claims, r.claimRate])
      ),
    };
  }
  if (name === 'sales-by-region') {
    const orders = await Order.findAll({ where: { paidAt: { [Op.gte]: p.from, [Op.lte]: p.to } }, attributes: ['id', 'userId', 'total'] });
    const rows = await salesByRegion(orders);
    return {
      filename: `afa-sales-by-region-${range}.csv`,
      content: csv(['Buyer Region', 'Orders', 'Buyers', 'Sales (E)'], rows.map((r) => [r.region, r.orders, r.buyers, fmt(r.sales)])),
    };
  }
  if (name === 'sales-by-category') {
    const sos = await SellerOrder.findAll({ where: { paidAt: { [Op.gte]: p.from, [Op.lte]: p.to }, status: { [Op.ne]: 'cancelled' } }, attributes: ['id'] });
    const items = sos.length ? await OrderItem.findAll({ where: { sellerOrderId: sos.map((s) => s.id) }, attributes: ['categoryName', 'subCategoryName', 'quantity', 'lineTotal', 'vatAmount'] }) : [];
    const rows = new Map();
    items.forEach((i) => {
      const k = `${i.categoryName || 'Other'}|${i.subCategoryName || ''}`;
      const r = rows.get(k) || { category: i.categoryName || 'Other', sub: i.subCategoryName || '', lines: 0, sales: 0, vat: 0 };
      r.lines += 1;
      r.sales = round2(r.sales + num(i.lineTotal));
      r.vat = round2(r.vat + num(i.vatAmount));
      rows.set(k, r);
    });
    return {
      filename: `afa-sales-by-category-${range}.csv`,
      content: csv(['Category', 'Sub-category', 'Order Lines', 'Sales excl. VAT (E)', 'VAT (E)'], [...rows.values()].sort((a, b) => b.sales - a.sales).map((r) => [r.category, r.sub, r.lines, fmt(r.sales), fmt(r.vat)])),
    };
  }
  // registrations: per bucket and user type
  const users = await User.findAll({ where: { submittedAt: { [Op.gte]: p.from, [Op.lte]: p.to } }, attributes: ['userType', 'status', 'submittedAt'] });
  const types = Object.keys(USER_TYPE_LABELS);
  const series = P.series(p, users, (u) => u.submittedAt, {
    total: () => 1,
    approved: (u) => (u.status === 'approved' ? 1 : 0),
    ...Object.fromEntries(types.map((t) => [t, (u) => (u.userType === t ? 1 : 0)])),
  });
  return {
    filename: `afa-registrations-${range}.csv`,
    content: csv(['Period', 'Submitted', 'Approved now', ...types.map((t) => USER_TYPE_LABELS[t])], series.map((b) => [b.label, b.total, b.approved, ...types.map((t) => b[t])])),
  };
}

module.exports = { overview, sellerPerformance, report, REPORTS, SORTS, cache };
