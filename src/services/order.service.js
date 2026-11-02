// BUYER order screens (/me/orders): My Orders, Order Details, "I received it".
// Placing the order is in checkout.service.js, paying in payment.service.js.
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const settings = require('./setting.service');
const { sellerShape } = require('./marketplace.service');
const { bankDetails } = require('./checkout.service');
const { applyStatus } = require('./sellerOrder.service');
const { getPagination, paginationMeta } = require('../utils/pagination');
const shared = require('./orderShared');
const { ORDER_STATUS, ORDER_STATUS_LABELS, SELLER_ORDER_STATUS, PAYMENT_METHODS } = require('../config/orders');
const orderNotify = require('./orderNotify.service');

const { sequelize, Order, SellerOrder } = models;
const { num, money, totalsShape, sellerOrderShape, paymentShape, sortedPayments, timeline, fullIncludes, loadOrder, orderNotFound } = shared;
const S = ORDER_STATUS;

// Everything the buyer sees about one order
function buyerShape(order, { dirs, bank }) {
  const awaiting = order.status === S.AWAITING_PAYMENT;
  const isBank = order.paymentMethod === 'bank_transfer';
  const sellerOrders = (order.sellerOrders || []).slice().sort((a, b) => a.id - b.id);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    placedAt: order.createdAt,
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    cancelledBy: order.cancelledBy,
    paymentMethod: order.paymentMethod,
    paymentMethodLabel: PAYMENT_METHODS[order.paymentMethod],
    paymentDeadline: order.paymentDeadline,
    deliveryAddress: order.deliveryAddress,
    totals: totalsShape(order),
    itemsCount: sellerOrders.reduce((n, so) => n + (so.items || []).length, 0),
    sellerOrders: sellerOrders.map((so) =>
      sellerOrderShape(so, { view: 'buyer', seller: sellerShape(so.sellerId, dirs.get(so.sellerId)), history: order.history || [] })
    ),
    payments: sortedPayments(order).map((p) => paymentShape(p)),
    // Bank transfer: where to pay and which reference to use
    paymentInstructions:
      isBank && (awaiting || order.status === S.UNDER_REVIEW)
        ? {
            bankDetails: bank,
            reference: order.orderNumber,
            amount: num(order.total),
            amountLabel: money(order.total),
            payBefore: order.paymentDeadline,
            note: `Use ${order.orderNumber} as the payment reference, then upload your proof of payment.`,
          }
        : null,
    actions: {
      canPayOnline: awaiting && !isBank,
      canUploadProof: awaiting && isBank,
      canChangePaymentMethod: awaiting,
      canCancel: awaiting,
    },
    timeline: timeline(order.history || []),
  };
}

async function shapeMany(orders) {
  const sellerIds = [...new Set(orders.flatMap((o) => (o.sellerOrders || []).map((so) => so.sellerId)))];
  const [dirs, s] = await Promise.all([directory.findMany(sellerIds), settings.getAll()]);
  const bank = s.afa_bank_account_number ? bankDetails(s) : null;
  return orders.map((o) => buyerShape(o, { dirs, bank }));
}

// ---------- GET /me/orders/:id ----------
async function getMine(user, id) {
  const order = await loadOrder({ id, userId: user.id });
  if (!order) throw orderNotFound();
  return (await shapeMany([order]))[0];
}

// ---------- GET /me/orders?status=&search=&page= ----------
// status: awaiting_payment | under_review | paid | cancelled ; search: order number
async function listMine(user, query = {}) {
  const pg = getPagination(query);
  const where = { userId: user.id };
  if (query.status) where.status = query.status;
  if (query.search) where.orderNumber = { [Op.like]: `%${query.search}%` };

  const { rows, count } = await Order.findAndCountAll({
    where,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  const full = rows.length
    ? await Order.findAll({ where: { id: rows.map((r) => r.id) }, include: fullIncludes(), order: [['createdAt', 'DESC'], ['id', 'DESC']] })
    : [];
  const items = (await shapeMany(full)).map(({ timeline: t, payments, ...rest }) => ({
    ...rest,
    latestPayment: payments[0] || null,
  }));

  // Counts for the tabs
  const grouped = await Order.findAll({
    where: { userId: user.id },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['status'],
    raw: true,
  });
  const counts = Object.fromEntries(Object.values(S).map((st) => [st, 0]));
  grouped.forEach((g) => {
    counts[g.status] = Number(g.total);
  });

  return { items, counts, pagination: paginationMeta(pg, count) };
}

// ---------- POST /me/orders/:id/seller-orders/:sellerOrderId/received ----------
// "I received it": Dispatched -> Delivered, Ready for pickup -> Collected
async function confirmReceived(user, orderId, sellerOrderId) {
  await sequelize.transaction(async (transaction) => {
    const order = await Order.findOne({ where: { id: orderId, userId: user.id }, transaction });
    if (!order) throw orderNotFound();
    const so = await SellerOrder.findOne({ where: { id: sellerOrderId, orderId: order.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!so) throw orderNotFound();
    const to = { [SELLER_ORDER_STATUS.DISPATCHED]: SELLER_ORDER_STATUS.DELIVERED, [SELLER_ORDER_STATUS.READY_FOR_PICKUP]: SELLER_ORDER_STATUS.COLLECTED }[so.status];
    if (!to) {
      throw new ApiError(409, 'You can confirm receipt once the seller has dispatched the order or it is ready for pickup', {
        code: 'INVALID_STATUS_CHANGE',
      });
    }
    await applyStatus(so, to, { type: 'buyer', id: user.id }, { note: 'Confirmed by the buyer' }, transaction);
  });
  orderNotify.sellerOrderStatusChanged(sellerOrderId);
  return getMine(user, orderId);
}

module.exports = { buyerShape, shapeMany, getMine, listMine, confirmReceived };
