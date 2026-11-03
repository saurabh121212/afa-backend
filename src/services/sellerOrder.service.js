// SELLER order screens (/me/sales) + the status flow of a seller order.
//
//   Paid (New order) -> Confirmed -> Packed / Harvested
//     -> Dispatched (delivery)  -> Delivered      \
//     -> Ready for pickup (pickup) -> Collected   -> claim window -> Completed (payout released)
//
// The buyer can also mark Delivered / Collected ("I received it").
// Delivered / Collected starts the claim window: the longest of the items' refund policies
// (farm produce 24 hours, farming products 7 days). The background job then completes it.
// Sellers only see orders that are PAID (or later).
// Phase 4: no status change while the buyer's cancellation request waits for an answer;
// not completed while a claim is active (payout stays held).
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const { toCsvLine } = require('../utils/csv');
const { getPagination, paginationMeta } = require('../utils/pagination');
const shared = require('./orderShared');
const {
  SELLER_ORDER_STATUS,
  SELLER_ORDER_STATUS_LABELS,
  SELLER_TRANSITIONS,
  STATUS_TIME_FIELD,
  CLAIM_WINDOW_HOURS,
} = require('../config/orders');

const { sequelize, Order, SellerOrder, OrderItem, OrderStatusHistory, User } = models;
const cancellations = require('./cancellation.service');
const claims = require('./claim.service');
const { num, money, addHours, recordHistory, sellerOrderShape, isLate } = shared;
const SO = SELLER_ORDER_STATUS;
const orderNotify = require('./orderNotify.service');

const notFound = () => new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });

// ---------- status change (shared with the buyer's "I received it") ----------

// Hours of the claim window for a seller order (longest item wins)
async function claimHours(sellerOrderId, transaction) {
  const items = await OrderItem.findAll({ where: { sellerOrderId }, attributes: ['refundPolicy'], transaction });
  return Math.max(0, ...items.map((i) => CLAIM_WINDOW_HOURS[i.refundPolicy] || 0));
}

// Move a (locked) seller order to "to". actor = { type, id }
async function applyStatus(so, to, actor, { note = null } = {}, transaction) {
  const now = new Date();
  const values = { status: to };
  const timeField = STATUS_TIME_FIELD[to];
  if (timeField) values[timeField] = now;
  if (to === SO.DELIVERED || to === SO.COLLECTED) {
    values.completeAfter = addHours(now, await claimHours(so.id, transaction));
  }
  const from = so.status;
  await so.update(values, { transaction });
  await recordHistory({ orderId: so.orderId, sellerOrderId: so.id, from, to, actor, note }, transaction);
}

// ---------- seller: list / stats / details ----------
const SELLER_VISIBLE = { paidAt: { [Op.ne]: null } }; // only paid orders reach the seller

const listIncludes = () => [
  { model: OrderItem, as: 'items' },
  { model: Order, as: 'order', attributes: ['id', 'orderNumber', 'userId', 'deliveryAddress', 'createdAt'] },
];

async function buildWhere(seller, query = {}) {
  const where = { sellerId: seller.id, ...SELLER_VISIBLE };
  if (query.status) where.status = query.status;
  if (query.cancelRequest === true) where.openCancelRequestId = { [Op.ne]: null };
  if (query.openClaim === true) where.claimStatus = 'active';
  if (query.late === true) {
    where.status = SO.PAID;
    where.confirmBy = { [Op.lt]: new Date() };
  }
  if (query.from || query.to) {
    where.paidAt = { [Op.ne]: null, ...(query.from ? { [Op.gte]: query.from } : {}), ...(query.to ? { [Op.lte]: query.to } : {}) };
  }
  if (query.search) {
    const buyerIds = await directory.findUserIdsByName(query.search);
    const orders = buyerIds.length ? await Order.findAll({ where: { userId: buyerIds }, attributes: ['id'] }) : [];
    where[Op.or] = [
      { sellerOrderNumber: { [Op.like]: `%${query.search}%` } },
      ...(orders.length ? [{ orderId: orders.map((o) => o.id) }] : []),
    ];
  }
  return where;
}

// Buyer details the seller needs (only for paid orders)
function buyerShape(order, dir, user) {
  const address = order.deliveryAddress;
  return {
    id: order.userId,
    name: dir ? dir.display_name : null,
    mobile: user ? user.mobile : null,
    deliveryAddress: address
      ? { contactName: address.contactName, phone: address.phone, fullAddress: address.fullAddress, landmark: address.landmark || null, region: address.region }
      : null,
  };
}

async function shapeForSeller(rows, { withHistory = false } = {}) {
  const buyerIds = [...new Set(rows.map((r) => r.order.userId))];
  const [dirs, users, history] = await Promise.all([
    directory.findMany(buyerIds),
    User.findAll({ where: { id: buyerIds }, attributes: ['id', 'mobile'] }),
    withHistory ? OrderStatusHistory.findAll({ where: { sellerOrderId: rows.map((r) => r.id) } }) : [],
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  return rows.map((so) => ({
    ...sellerOrderShape(so, { view: 'seller', history: history.filter((h) => h.sellerOrderId === so.id) }),
    orderNumber: so.order.orderNumber,
    placedAt: so.order.createdAt,
    buyer: buyerShape(so.order, dirs.get(so.order.userId), userById.get(so.order.userId)),
  }));
}

// GET /me/sales/stats
async function stats(seller) {
  const rows = await SellerOrder.findAll({
    where: { sellerId: seller.id, ...SELLER_VISIBLE },
    attributes: ['status', 'total', 'payoutStatus', 'payoutAmount', 'confirmBy', 'refundedAmount', 'cancelledBy', 'openCancelRequestId', 'claimStatus'],
  });
  const byStatus = Object.fromEntries(Object.values(SO).filter((s) => s !== SO.AWAITING_PAYMENT).map((s) => [s, 0]));
  let sales = 0;
  let held = 0;
  let released = 0;
  let refunded = 0;
  rows.forEach((r) => {
    refunded += num(r.refundedAmount || 0);
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.status !== SO.CANCELLED) sales += num(r.total);
    if (r.payoutStatus === 'held') held += num(r.payoutAmount);
    if (r.payoutStatus === 'released') released += num(r.payoutAmount);
  });
  const active = [SO.PAID, SO.CONFIRMED, SO.PACKED, SO.DISPATCHED, SO.READY_FOR_PICKUP, SO.DELIVERED, SO.COLLECTED].reduce((n, s) => n + byStatus[s], 0);
  return {
    totalOrders: rows.length,
    newOrders: byStatus.paid,
    late: rows.filter(isLate).length,
    inProgress: active,
    completed: byStatus.completed,
    cancelled: byStatus.cancelled,
    byStatus,
    cancelRequests: rows.filter((r) => r.openCancelRequestId).length,
    openClaims: rows.filter((r) => r.claimStatus === 'active').length,
    cancelledBySeller: rows.filter((r) => r.status === SO.CANCELLED && r.cancelledBy === 'seller').length,
    autoCancelled: rows.filter((r) => r.status === SO.CANCELLED && r.cancelledBy === 'system').length,
    totalSales: shared.round2(sales),
    refunded: shared.round2(refunded),
    payoutHeld: shared.round2(held),
    payoutReleased: shared.round2(released),
    labels: { totalSales: money(sales), refunded: money(refunded), payoutHeld: money(held), payoutReleased: money(released) },
  };
}

// GET /me/sales
async function list(seller, query = {}) {
  const pg = getPagination(query);
  const { rows, count } = await SellerOrder.findAndCountAll({
    where: await buildWhere(seller, query),
    include: listIncludes(),
    order: [['paidAt', query.sort === 'oldest' ? 'ASC' : 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
    distinct: true,
  });
  return { items: await shapeForSeller(rows), pagination: paginationMeta(pg, count) };
}

async function findOwn(seller, id, { transaction, lock = false } = {}) {
  if (lock) {
    const locked = await SellerOrder.findOne({ where: { id, sellerId: seller.id, ...SELLER_VISIBLE }, transaction, lock: transaction.LOCK.UPDATE });
    if (!locked) throw notFound();
    return locked;
  }
  const so = await SellerOrder.findOne({ where: { id, sellerId: seller.id, ...SELLER_VISIBLE }, include: listIncludes(), transaction });
  if (!so) throw notFound();
  return so;
}

// GET /me/sales/:id   (+ cancellation requests and claims of this order)
async function getOne(seller, id) {
  const so = await findOwn(seller, id);
  const [shaped, requests, claimRows] = await Promise.all([
    shapeForSeller([so], { withHistory: true }),
    cancellations.requestsFor([so.id]),
    claims.claimsFor({ type: 'seller', id: seller.id }, [so.id]),
  ]);
  return {
    ...shaped[0],
    cancelRequest: requests.find((r) => r.id === so.openCancelRequestId) || null,
    cancelRequests: requests,
    claims: claimRows,
  };
}

// PATCH /me/sales/:id/status  { status, note? }
async function setStatus(seller, id, { status, note }) {
  await sequelize.transaction(async (transaction) => {
    const so = await findOwn(seller, id, { transaction, lock: true });
    if (so.openCancelRequestId) {
      throw new ApiError(409, 'The buyer asked to cancel this order. Please accept or decline the request first.', { code: 'CANCEL_REQUEST_PENDING' });
    }
    const allowed = (SELLER_TRANSITIONS[so.status] || {})[so.fulfilment] || [];
    if (!allowed.includes(status)) {
      const nextText = allowed.length ? ` Next step: ${allowed.map((s) => SELLER_ORDER_STATUS_LABELS[s]).join(' or ')}.` : '';
      throw new ApiError(
        409,
        `This order is "${SELLER_ORDER_STATUS_LABELS[so.status]}" and can't be moved to "${SELLER_ORDER_STATUS_LABELS[status]}".${nextText}`,
        { code: 'INVALID_STATUS_CHANGE' }
      );
    }
    await applyStatus(so, status, { type: 'seller', id: seller.id }, { note }, transaction);
  });
  orderNotify.sellerOrderStatusChanged(id);
  return getOne(seller, id);
}

// GET /me/sales/export  (CSV, same filters)
async function exportCsv(seller, query = {}) {
  const rows = await SellerOrder.findAll({ where: await buildWhere(seller, query), include: listIncludes(), order: [['paidAt', 'DESC']], limit: 5000 });
  const shaped = await shapeForSeller(rows);
  const lines = [
    toCsvLine(['Order Number', 'Paid At', 'Buyer', 'Status', 'Fulfilment', 'Items', 'Subtotal (E)', 'Delivery (E)', 'VAT (E)', 'Total (E)', 'Payout']),
    ...shaped.map((s) =>
      toCsvLine([
        s.sellerOrderNumber,
        s.dates.paidAt ? new Date(s.dates.paidAt).toISOString() : '',
        s.buyer.name || '',
        s.statusLabel,
        s.fulfilmentLabel,
        s.items.map((i) => `${i.name} x ${i.quantity} ${i.unitLabel || ''}`.trim()).join('; '),
        s.subtotal.toFixed(2),
        s.deliveryFee.toFixed(2),
        s.vatTotal.toFixed(2),
        s.total.toFixed(2),
        s.payout.statusLabel,
      ])
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// ---------- background job: claim window ended -> Completed, payout released ----------
// Not while a claim is active (it completes on the next run after the claim is settled).
async function completeDue({ limit = 100 } = {}) {
  const due = await SellerOrder.findAll({
    where: { status: { [Op.in]: [SO.DELIVERED, SO.COLLECTED] }, completeAfter: { [Op.lte]: new Date() }, claimStatus: { [Op.ne]: 'active' } },
    attributes: ['id'],
    limit,
  });
  let completed = 0;
  for (const { id } of due) {
    // eslint-disable-next-line no-await-in-loop
    const done = await sequelize.transaction(async (transaction) => {
      const so = await SellerOrder.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!so || ![SO.DELIVERED, SO.COLLECTED].includes(so.status) || new Date(so.completeAfter) > new Date() || so.claimStatus === 'active') return false;
      if (so.payoutStatus === 'held') await so.update({ payoutStatus: 'released' }, { transaction });
      await applyStatus(so, SO.COMPLETED, { type: 'system' }, { note: 'Claim window ended' }, transaction);
      return true;
    });
    if (done) completed += 1;
  }
  return completed;
}

module.exports = { applyStatus, stats, list, getOne, setStatus, exportCsv, completeDue };
