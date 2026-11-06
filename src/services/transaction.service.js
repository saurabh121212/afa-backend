// TRANSACTION HISTORY (buyer, seller, admin) and the PAYMENT STATUS of an order.
//
//   Buyer  : payments (every attempt) and refunds         GET /me/transactions
//   Seller : sales (paid seller orders), refunds on them,  GET /me/transactions
//            payout status (held / released / cancelled)
//   Admin  : all money in (payments) and out (refunds,     GET /admin/transactions
//            payouts due to sellers) + totals
//   Status : one order's payment step for the app to show / poll after the payment page
//                                                          GET /me/orders/:id/payment-status
//
// Each row: { key, type, date, reference, description, direction (in | out), amount, status, ... }.
// Lists merge several tables, newest first; the newest 5000 rows of each kind are considered.
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const invoices = require('./invoice.service');
const { toCsvLine } = require('../utils/csv');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { round2, num, money } = require('./orderShared');
const { ORDER_STATUS, ORDER_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_STATUS_LABELS, PAYOUT_STATUS_LABELS, FULFILMENT_LABELS, statusLabelFor } = require('../config/orders');
const { REFUND_STATUS_LABELS, REFUND_SOURCES } = require('../config/refunds');

const { Order, SellerOrder, Payment, Refund, Invoice } = models;
const CAP = 5000;

const TYPE_LABELS = { payment: 'Payment', refund: 'Refund', sale: 'Sale', payout: 'Seller Payout' };

const inRange = (date, q) => (!q.from || new Date(date) >= q.from) && (!q.to || new Date(date) <= q.to);
const dateWhere = (field, q) => (q.from || q.to ? { [field]: { ...(q.from ? { [Op.gte]: q.from } : {}), ...(q.to ? { [Op.lte]: q.to } : {}) } } : {});

function page(rows, query) {
  const pg = getPagination(query);
  const sorted = rows.sort((a, b) => new Date(b.date) - new Date(a.date) || String(b.key).localeCompare(String(a.key)));
  return { items: sorted.slice(pg.offset, pg.offset + pg.limit), pagination: paginationMeta(pg, sorted.length) };
}

// Documents (receipt / invoice / credit note) per order, refund, seller order
async function docIndex(orderIds) {
  if (!orderIds.length) return { receipt: new Map(), creditNote: new Map(), invoice: new Map() };
  const docs = await Invoice.findAll({ where: { orderId: [...new Set(orderIds)] }, attributes: ['id', 'type', 'number', 'orderId', 'refundId', 'sellerOrderId'] });
  const link = (d) => ({ id: d.id, number: d.number });
  return {
    receipt: new Map(docs.filter((d) => d.type === 'receipt').map((d) => [d.orderId, link(d)])),
    creditNote: new Map(docs.filter((d) => d.type === 'credit_note').map((d) => [d.refundId, link(d)])),
    invoice: new Map(docs.filter((d) => d.type === 'invoice').map((d) => [d.sellerOrderId, link(d)])),
  };
}

const paymentRow = (p, order, docs) => ({
  key: `payment-${p.id}`,
  type: 'payment',
  typeLabel: TYPE_LABELS.payment,
  id: p.id,
  date: p.completedAt || p.createdAt,
  reference: order ? order.orderNumber : null,
  orderId: p.orderId,
  description: `${PAYMENT_METHODS[p.method]}${p.method === 'bank_transfer' && p.bankReference ? ` (ref ${p.bankReference})` : ''}`,
  method: p.method,
  direction: 'out',
  amount: num(p.method === 'bank_transfer' && p.amountPaid !== null ? p.amountPaid : p.amount),
  amountLabel: money(p.method === 'bank_transfer' && p.amountPaid !== null ? p.amountPaid : p.amount),
  status: p.status,
  statusLabel: PAYMENT_STATUS_LABELS[p.status],
  note: p.rejectionReason || null,
  document: p.status === 'succeeded' && docs.receipt.get(p.orderId) ? { type: 'receipt', ...docs.receipt.get(p.orderId) } : null,
});

const refundRow = (r, order, docs, direction = 'in') => ({
  key: `refund-${r.id}`,
  type: 'refund',
  typeLabel: TYPE_LABELS.refund,
  id: r.id,
  date: r.paidAt || r.createdAt,
  reference: r.refundNumber,
  orderId: r.orderId,
  orderNumber: order ? order.orderNumber : null,
  sellerOrderId: r.sellerOrderId,
  description: REFUND_SOURCES[r.source],
  method: r.method,
  direction,
  amount: num(r.amount),
  amountLabel: money(r.amount),
  status: r.status,
  statusLabel: REFUND_STATUS_LABELS[r.status],
  note: r.status === 'paid' ? (r.bankReference ? `Bank ref ${r.bankReference}` : null) : r.failedReason || null,
  document: docs.creditNote.get(r.id) ? { type: 'credit_note', ...docs.creditNote.get(r.id) } : null,
});

const sumOf = (rows, pred) => round2(rows.filter(pred).reduce((s, r) => s + r.amount, 0));
const withLabels = (o) => ({ ...o, labels: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, money(v)])) });

// ======================= BUYER =======================
// ?type=payment|refund&status=&from=&to=&page=
async function buyerRows(user, query = {}) {
  const orders = await Order.findAll({ where: { userId: user.id }, attributes: ['id', 'orderNumber'] });
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const ids = orders.map((o) => o.id);
  const [payments, refunds, docs] = await Promise.all([
    query.type && query.type !== 'payment' ? [] : ids.length ? Payment.findAll({ where: { orderId: ids }, order: [['id', 'DESC']], limit: CAP }) : [],
    query.type && query.type !== 'refund' ? [] : Refund.findAll({ where: { buyerId: user.id }, order: [['id', 'DESC']], limit: CAP }),
    docIndex(ids),
  ]);
  return [
    ...payments.map((p) => paymentRow(p, orderById.get(p.orderId), docs)),
    ...refunds.map((r) => refundRow(r, orderById.get(r.orderId), docs, 'in')),
  ].filter((r) => (!query.status || r.status === query.status) && inRange(r.date, query));
}

async function buyerHistory(user, query = {}) {
  const rows = await buyerRows(user, query);
  const all = await buyerRows(user, {});
  const totals = withLabels({
    paid: sumOf(all, (r) => r.type === 'payment' && r.status === 'succeeded'),
    refunded: sumOf(all, (r) => r.type === 'refund' && r.status === 'paid'),
    refundsPending: sumOf(all, (r) => r.type === 'refund' && r.status !== 'paid'),
  });
  return { ...page(rows, query), totals };
}

// ======================= SELLER =======================
// ?type=sale|refund&status=<seller order status | refund status>&payoutStatus=&from=&to=&page=
async function sellerRows(seller, query = {}) {
  const sos = await SellerOrder.findAll({
    where: { sellerId: seller.id, paidAt: { [Op.ne]: null } },
    order: [['paidAt', 'DESC']],
    limit: CAP,
  });
  const ids = sos.map((s) => s.id);
  const orders = sos.length ? await Order.findAll({ where: { id: [...new Set(sos.map((s) => s.orderId))] }, attributes: ['id', 'orderNumber'] }) : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const [refunds, docs] = await Promise.all([
    ids.length && (!query.type || query.type === 'refund') ? Refund.findAll({ where: { sellerOrderId: ids }, order: [['id', 'DESC']], limit: CAP }) : [],
    docIndex(orders.map((o) => o.id)),
  ]);
  const soById = new Map(sos.map((s) => [s.id, s]));
  const sales = !query.type || query.type === 'sale'
    ? sos.map((so) => ({
        key: `sale-${so.id}`,
        type: 'sale',
        typeLabel: TYPE_LABELS.sale,
        id: so.id,
        date: so.paidAt,
        reference: so.sellerOrderNumber,
        orderId: so.orderId,
        orderNumber: orderById.get(so.orderId) ? orderById.get(so.orderId).orderNumber : null,
        sellerOrderId: so.id,
        description: `${statusLabelFor(so)} - ${FULFILMENT_LABELS[so.fulfilment] || so.fulfilment}`,
        direction: 'in',
        amount: num(so.total),
        amountLabel: money(so.total),
        vat: num(so.vatTotal),
        refunded: num(so.refundedAmount || 0),
        payout: { status: so.payoutStatus, statusLabel: PAYOUT_STATUS_LABELS[so.payoutStatus], amount: num(so.payoutAmount), amountLabel: money(so.payoutAmount) },
        status: so.status,
        statusLabel: statusLabelFor(so),
        document: docs.invoice.get(so.id) ? { type: 'invoice', ...docs.invoice.get(so.id) } : null,
      }))
    : [];
  const refundRows = refunds.map((r) => ({
    ...refundRow(r, orderById.get(r.orderId), docs, 'out'),
    sellerOrderNumber: soById.get(r.sellerOrderId) ? soById.get(r.sellerOrderId).sellerOrderNumber : null,
    recoverFromSeller: r.recoverFromSeller,
  }));
  return [...sales, ...refundRows].filter(
    (r) =>
      (!query.status || r.status === query.status) &&
      (!query.payoutStatus || (r.payout && r.payout.status === query.payoutStatus)) &&
      inRange(r.date, query)
  );
}

async function sellerHistory(seller, query = {}) {
  const rows = await sellerRows(seller, query);
  // Totals follow the date filter only
  const scoped = await sellerRows(seller, { from: query.from, to: query.to });
  const sales = scoped.filter((r) => r.type === 'sale' && r.status !== 'cancelled');
  const totals = withLabels({
    sales: round2(sales.reduce((s, r) => s + r.amount, 0)),
    vat: round2(sales.reduce((s, r) => s + r.vat, 0)),
    refunds: sumOf(scoped, (r) => r.type === 'refund'),
    payoutHeld: round2(scoped.filter((r) => r.type === 'sale' && r.payout.status === 'held').reduce((s, r) => s + r.payout.amount, 0)),
    payoutReleased: round2(scoped.filter((r) => r.type === 'sale' && r.payout.status === 'released').reduce((s, r) => s + r.payout.amount, 0)),
  });
  return { ...page(rows, query), totals };
}

// GET /me/transactions -> buyer or seller history
function mine(user, query) {
  return user.userType === 'buyer' ? buyerHistory(user, query) : sellerHistory(user, query);
}

// ======================= ADMIN =======================
// ?type=payment|refund|payout&status=&method=&userId=&from=&to=&search=&page=
async function adminRows(query = {}) {
  let orderIds = null;
  if (query.search || query.userId) {
    const where = {};
    if (query.search) where.orderNumber = { [Op.like]: `%${query.search}%` };
    if (query.userId) where.userId = query.userId;
    const asBuyer = await Order.findAll({ where, attributes: ['id'] });
    orderIds = asBuyer.map((o) => o.id);
    if (query.userId) {
      const asSeller = await SellerOrder.findAll({ where: { sellerId: query.userId }, attributes: ['orderId'] });
      orderIds = [...new Set([...orderIds, ...asSeller.map((s) => s.orderId)])];
    }
  }
  const scope = orderIds ? { orderId: orderIds.concat(0) } : {};
  const want = (t) => !query.type || query.type === t;
  const [payments, refunds, payouts] = await Promise.all([
    want('payment') ? Payment.findAll({ where: { ...scope, ...(query.method ? { method: query.method } : {}) }, order: [['id', 'DESC']], limit: CAP }) : [],
    want('refund') && !query.method
      ? Refund.findAll({
          where: query.search ? { [Op.or]: [{ refundNumber: { [Op.like]: `%${query.search}%` } }, scope] } : scope,
          order: [['id', 'DESC']],
          limit: CAP,
        })
      : [],
    want('payout') && !query.method
      ? SellerOrder.findAll({
          where: { payoutStatus: { [Op.in]: ['held', 'released'] }, ...(query.userId ? { sellerId: query.userId } : orderIds ? { orderId: orderIds.concat(0) } : {}) },
          order: [['id', 'DESC']],
          limit: CAP,
        })
      : [],
  ]);
  const allOrderIds = [...new Set([...payments, ...refunds, ...payouts].map((x) => x.orderId))];
  const orders = allOrderIds.length ? await Order.findAll({ where: { id: allOrderIds }, attributes: ['id', 'orderNumber', 'userId'] }) : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const [docs, dirs] = await Promise.all([
    docIndex(allOrderIds),
    directory.findMany([...orders.map((o) => o.userId), ...payouts.map((s) => s.sellerId)]),
  ]);
  const name = (id) => (dirs.get(id) ? dirs.get(id).display_name : null);
  const buyerOf = (orderId) => (orderById.get(orderId) ? { id: orderById.get(orderId).userId, name: name(orderById.get(orderId).userId) } : null);

  const rows = [
    ...payments.map((p) => ({ ...paymentRow(p, orderById.get(p.orderId), docs), direction: 'in', user: buyerOf(p.orderId), provider: p.provider, providerReference: p.providerReference })),
    ...refunds.map((r) => ({ ...refundRow(r, orderById.get(r.orderId), docs, 'out'), user: buyerOf(r.orderId), recoverFromSeller: r.recoverFromSeller })),
    ...payouts.map((so) => ({
      key: `payout-${so.id}`,
      type: 'payout',
      typeLabel: TYPE_LABELS.payout,
      id: so.id,
      date: so.payoutStatus === 'released' ? so.completedAt || so.cancelledAt || so.updatedAt : so.paidAt,
      reference: so.sellerOrderNumber,
      orderId: so.orderId,
      orderNumber: orderById.get(so.orderId) ? orderById.get(so.orderId).orderNumber : null,
      sellerOrderId: so.id,
      description: so.payoutStatus === 'released' ? 'Due to the seller (claim window ended)' : 'Held until the claim window ends',
      direction: 'out',
      amount: num(so.payoutAmount),
      amountLabel: money(so.payoutAmount),
      status: so.payoutStatus,
      statusLabel: PAYOUT_STATUS_LABELS[so.payoutStatus],
      user: { id: so.sellerId, name: name(so.sellerId) },
      document: docs.invoice.get(so.id) ? { type: 'invoice', ...docs.invoice.get(so.id) } : null,
    })),
  ];
  return rows.filter((r) => (!query.status || r.status === query.status) && inRange(r.date, query));
}

function adminTotals(rows) {
  const t = {
    received: sumOf(rows, (r) => r.type === 'payment' && r.status === 'succeeded'),
    refundsPaid: sumOf(rows, (r) => r.type === 'refund' && r.status === 'paid'),
    refundsPending: sumOf(rows, (r) => r.type === 'refund' && r.status !== 'paid'),
    payoutsHeld: sumOf(rows, (r) => r.type === 'payout' && r.status === 'held'),
    payoutsReleased: sumOf(rows, (r) => r.type === 'payout' && r.status === 'released'),
  };
  // Money AFA still holds = received - refunds paid - payouts released (payouts are paid outside the system for now)
  t.balanceHeld = round2(t.received - t.refundsPaid - t.payoutsReleased);
  return withLabels(t);
}

async function adminHistory(query = {}) {
  const rows = await adminRows(query);
  return { ...page(rows, query), totals: adminTotals(rows) };
}

// GET /admin/transactions/stats  (?from=&to=)
async function adminStats(query = {}) {
  return adminTotals(await adminRows({ from: query.from, to: query.to }));
}

// ---------- CSV ----------
function toCsv(rows, { admin = false } = {}) {
  const head = ['Date', 'Type', 'Reference', 'Order', 'Description', ...(admin ? ['User'] : []), 'In / Out', 'Amount (E)', 'Status', 'Document'];
  const lines = [
    toCsvLine(head),
    ...rows.map((r) =>
      toCsvLine([
        new Date(r.date).toISOString(),
        r.typeLabel,
        r.reference || '',
        r.orderNumber || (r.type === 'payment' ? r.reference : '') || '',
        r.description || '',
        ...(admin ? [r.user && r.user.name ? r.user.name : ''] : []),
        r.direction === 'in' ? 'In' : 'Out',
        r.amount.toFixed(2),
        r.statusLabel || r.status,
        r.document ? r.document.number : '',
      ])
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

async function exportMine(user, query = {}) {
  const rows = user.userType === 'buyer' ? await buyerRows(user, query) : await sellerRows(user, query);
  return toCsv(page(rows, { page: 1, limit: CAP }).items);
}

async function exportAdmin(query = {}) {
  return toCsv(page(await adminRows(query), { page: 1, limit: CAP }).items, { admin: true });
}

// ======================= PAYMENT STATUS =======================
const STEP = {
  awaiting_payment: { label: 'Waiting for payment', final: false },
  under_review: { label: 'Payment being checked', final: false },
  paid: { label: 'Paid', final: true },
  cancelled: { label: 'Cancelled', final: true },
};

// GET /me/orders/:id/payment-status
async function paymentStatus(user, orderId) {
  const order = await Order.findOne({ where: { id: orderId, userId: user.id } });
  if (!order) throw new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });
  const latest = await Payment.findOne({ where: { orderId: order.id }, order: [['id', 'DESC']] });
  const now = Date.now();
  const deadline = order.paymentDeadline ? new Date(order.paymentDeadline).getTime() : null;
  const isBank = order.paymentMethod === 'bank_transfer';

  let nextAction = 'none';
  let message;
  if (order.status === ORDER_STATUS.PAID) {
    message = `Payment received. Order ${order.orderNumber} is paid.`;
  } else if (order.status === ORDER_STATUS.CANCELLED) {
    message =
      order.cancelledBy === 'system' ? 'The order was cancelled because it was not paid in time.' : 'The order was cancelled.';
  } else if (order.status === ORDER_STATUS.UNDER_REVIEW) {
    nextAction = 'wait_for_review';
    message = 'Thank you. The AFA team is checking your proof of payment.';
  } else if (isBank) {
    nextAction = 'upload_proof';
    message =
      latest && latest.status === 'rejected'
        ? `Your proof of payment was not accepted: ${latest.rejectionReason || ''} Please upload a new one.`
        : `Pay ${money(order.total)} into the AFA bank account with reference ${order.orderNumber}, then upload your proof of payment.`;
  } else if (latest && latest.status === 'pending') {
    nextAction = 'wait_for_gateway';
    message = 'We are waiting for the payment service to confirm your payment. This page updates by itself.';
  } else {
    nextAction = latest && latest.status === 'failed' ? 'retry_online' : 'pay_online';
    message = latest && latest.status === 'failed' ? 'The payment did not go through. No money was taken. You can try again.' : 'Complete the online payment.';
  }

  const docs = order.status === ORDER_STATUS.PAID ? await invoices.documentsFor({ type: 'buyer', id: user.id }, order.id) : null;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    step: order.status,
    stepLabel: STEP[order.status].label,
    isFinal: STEP[order.status].final,
    message,
    nextAction, // pay_online | retry_online | wait_for_gateway | upload_proof | wait_for_review | none
    paymentMethod: order.paymentMethod,
    paymentMethodLabel: PAYMENT_METHODS[order.paymentMethod],
    amount: num(order.total),
    amountLabel: money(order.total),
    paymentDeadline: order.paymentDeadline,
    secondsLeft: deadline && !STEP[order.status].final ? Math.max(0, Math.floor((deadline - now) / 1000)) : null,
    paidAt: order.paidAt,
    // Poll again after this many seconds while the result is not final (null = stop)
    pollAfterSeconds: STEP[order.status].final ? null : nextAction === 'wait_for_gateway' ? 5 : 30,
    latestPayment: latest
      ? {
          id: latest.id,
          method: latest.method,
          methodLabel: PAYMENT_METHODS[latest.method],
          status: latest.status,
          statusLabel: PAYMENT_STATUS_LABELS[latest.status],
          amount: num(latest.amount),
          createdAt: latest.createdAt,
          completedAt: latest.completedAt,
          rejectionReason: latest.rejectionReason || null,
        }
      : null,
    documents: docs,
    proformaUrl: !STEP[order.status].final ? `/me/orders/${order.id}/proforma` : null,
  };
}

module.exports = { mine, buyerHistory, sellerHistory, adminHistory, adminStats, exportMine, exportAdmin, paymentStatus };
