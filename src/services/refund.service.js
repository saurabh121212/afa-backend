// REFUNDS: money AFA pays back to the buyer (AFA-REF-000001).
//
//   Created by: cancelling a paid seller order, an accepted / decided claim, an AFA refund,
//               or an online payment that arrived after the order was cancelled.
//   Paid by:    the AFA admin, manually by bank transfer (no gateway refund API yet).
//
//   pending -> paid    (admin enters the bank reference, optional proof)
//           -> failed  (e.g. wrong account) -> buyer fixes the bank details -> pending again
//
// The buyer gives the bank account when a refund is due (and can save it for next time).
// The seller's payout goes down by the refund. If the seller was already paid (refund after
// completion) the refund is flagged "recover from seller". A credit note is issued against the
// seller order's invoice.
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const directory = require('./userDirectory');
const files = require('./privateFiles');
const invoices = require('./invoice.service');
const { toCsvLine } = require('../utils/csv');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { round2, num, money, addHours, recordHistory } = require('./orderShared');
const { REFUND_STATUS, REFUND_STATUS_LABELS, REFUND_SOURCES, REFUND_PROOF, refundNumber } = require('../config/refunds');

const { sequelize, Refund, RefundAccount, Order, SellerOrder } = models;
const R = REFUND_STATUS;

// Emails are sent after the change is saved (lazy require: refundNotify loads this file too)
const notify = () => require('./refundNotify.service');

const refundNotFound = () => new ApiError(404, 'Refund not found', { code: 'REFUND_NOT_FOUND' });

// ---------- amounts ----------

// What is left to refund on a seller order
const remainingOf = (so) => round2(num(so.total) - num(so.refundedAmount || 0));

// Split an amount like the parts of a total (items / delivery / VAT). Items take the rounding.
function proportional({ items, delivery, vat, total }, amount) {
  const t = num(total);
  if (!t || round2(amount) === round2(t)) {
    return { amount: round2(amount), itemsAmount: round2(items), deliveryAmount: round2(delivery), vatAmount: round2(vat) };
  }
  const f = amount / t;
  const deliveryAmount = round2(num(delivery) * f);
  const vatAmount = round2(num(vat) * f);
  return { amount: round2(amount), itemsAmount: round2(amount - deliveryAmount - vatAmount), deliveryAmount, vatAmount };
}

// Breakdown of "amount" for a seller order (default: everything that is left)
function sellerOrderBreakdown(so, amount = null) {
  const left = remainingOf(so);
  const value = amount === null ? left : round2(amount);
  return proportional({ items: so.subtotal, delivery: so.deliveryFee, vat: so.vatTotal, total: so.total }, value);
}

// Throws when the amount is not between 0.01 and what is left
function assertRefundable(so, amount, field = 'amount') {
  const left = remainingOf(so);
  if (!(amount > 0) || round2(amount) > left) {
    throw new ApiError(422, `The refund must be more than 0 and at most ${money(left)} (what is left to refund on this order)`, {
      code: 'INVALID_REFUND_AMOUNT',
      errors: [{ field, message: `Maximum ${money(left)}` }],
    });
  }
}

// ---------- create (always inside the caller's transaction) ----------
//   order, sellerOrder (null = whole checkout), source, reason, breakdown { amount, itemsAmount, deliveryAmount, vatAmount },
//   claimId?, cancellationRequestId?, actor { type, id }
async function createRefund({ order, sellerOrder = null, source, reason = null, breakdown, claimId = null, cancellationRequestId = null, actor }, transaction) {
  const now = new Date();
  const [account, days] = await Promise.all([
    RefundAccount.findOne({ where: { userId: order.userId }, order: [['id', 'DESC']], transaction }),
    settings.get('refund_processing_days'),
  ]);
  const recoverFromSeller = Boolean(sellerOrder && sellerOrder.payoutStatus === 'released');

  const refund = await Refund.create(
    {
      orderId: order.id,
      sellerOrderId: sellerOrder ? sellerOrder.id : null,
      claimId,
      cancellationRequestId,
      buyerId: order.userId,
      source,
      reason: reason ? String(reason).slice(0, 500) : null,
      ...breakdown,
      status: R.PENDING,
      bankDetails: account ? accountDetails(account) : null,
      dueBy: addHours(now, days * 24),
      recoverFromSeller,
      createdByType: actor.type,
      createdById: actor.id || null,
    },
    { transaction }
  );
  await refund.update({ refundNumber: refundNumber(refund.id) }, { transaction });

  // The seller order: refunded so far, and the seller's payout goes down
  if (sellerOrder) {
    const values = { refundedAmount: round2(num(sellerOrder.refundedAmount || 0) + breakdown.amount) };
    if (!recoverFromSeller) {
      values.payoutAmount = Math.max(0, round2(num(sellerOrder.payoutAmount) - breakdown.amount));
      if (values.payoutAmount === 0) values.payoutStatus = 'cancelled';
    }
    await sellerOrder.update(values, { transaction });
  }

  // Credit note against the seller order's invoice
  await invoices.issueCreditNote(refund, transaction);

  await recordHistory(
    {
      orderId: order.id,
      sellerOrderId: sellerOrder ? sellerOrder.id : null,
      to: 'refund_created',
      actor,
      note: `${refund.refundNumber}: ${money(breakdown.amount)} (${REFUND_SOURCES[source]})`,
    },
    transaction
  );
  return refund;
}

// ---------- shapes ----------
const accountDetails = (a) => ({ bankName: a.bankName, accountName: a.accountName, accountNumber: a.accountNumber, branchCode: a.branchCode || null });

const maskAccount = (n) => (n ? `${'*'.repeat(Math.max(0, String(n).length - 4))}${String(n).slice(-4)}` : null);

function refundShape(r, { view = 'buyer', order = null, sellerOrder = null, buyer = null } = {}) {
  const pending = r.status === R.PENDING;
  const out = {
    id: r.id,
    refundNumber: r.refundNumber,
    status: r.status,
    statusLabel: REFUND_STATUS_LABELS[r.status],
    source: r.source,
    sourceLabel: REFUND_SOURCES[r.source],
    reason: r.reason,
    amount: num(r.amount),
    amountLabel: money(r.amount),
    breakdown: {
      items: num(r.itemsAmount),
      delivery: num(r.deliveryAmount),
      vat: num(r.vatAmount),
      labels: { items: money(r.itemsAmount), delivery: money(r.deliveryAmount), vat: money(r.vatAmount) },
    },
    method: r.method,
    order: order ? { id: order.id, orderNumber: order.orderNumber } : { id: r.orderId },
    sellerOrder: sellerOrder ? { id: sellerOrder.id, sellerOrderNumber: sellerOrder.sellerOrderNumber } : r.sellerOrderId ? { id: r.sellerOrderId } : null,
    claimId: r.claimId,
    cancellationRequestId: r.cancellationRequestId,
    needsBankDetails: !r.bankDetails && r.status !== R.PAID,
    bankDetails: r.bankDetails
      ? view === 'admin'
        ? r.bankDetails
        : { ...r.bankDetails, accountNumber: maskAccount(r.bankDetails.accountNumber) }
      : null,
    createdAt: r.createdAt,
    dueBy: r.dueBy,
    isOverdue: pending && r.dueBy && new Date(r.dueBy) < new Date(),
    paidAt: r.paidAt,
    paidOn: r.paidOn,
    bankReference: r.bankReference,
    hasProof: Boolean(r.proofPath),
    failedAt: r.failedAt,
    failedReason: r.failedReason,
  };
  if (view === 'buyer') {
    out.actions = { canUpdateBankDetails: r.status !== R.PAID };
    out.proofUrl = r.proofPath ? `/me/refunds/${r.id}/file` : null;
  }
  if (view === 'admin') {
    out.buyer = buyer;
    out.recoverFromSeller = r.recoverFromSeller;
    out.createdBy = { type: r.createdByType, id: r.createdById };
    out.paidBy = r.paidBy;
    out.adminNote = r.adminNote;
    out.proof = r.proofPath
      ? { originalName: r.proofOriginalName, mimeType: r.proofMimeType, sizeBytes: r.proofSizeBytes, fileUrl: `/admin/refunds/${r.id}/file` }
      : null;
    out.actions = { canMarkPaid: pending && Boolean(r.bankDetails), canMarkFailed: pending };
  }
  return out;
}

async function shapeMany(rows, { view = 'buyer' } = {}) {
  if (!rows.length) return [];
  const [orders, sellerOrders] = await Promise.all([
    Order.findAll({ where: { id: [...new Set(rows.map((r) => r.orderId))] }, attributes: ['id', 'orderNumber', 'userId'] }),
    SellerOrder.findAll({ where: { id: [...new Set(rows.map((r) => r.sellerOrderId).filter(Boolean))].concat(0) }, attributes: ['id', 'sellerOrderNumber'] }),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const soById = new Map(sellerOrders.map((s) => [s.id, s]));
  const dirs = view === 'admin' ? await directory.findMany([...new Set(rows.map((r) => r.buyerId))]) : new Map();
  return rows.map((r) =>
    refundShape(r, {
      view,
      order: orderById.get(r.orderId),
      sellerOrder: soById.get(r.sellerOrderId),
      buyer: view === 'admin' ? { id: r.buyerId, name: dirs.get(r.buyerId) ? dirs.get(r.buyerId).display_name : null } : null,
    })
  );
}

// ======================= BUYER =======================

// GET /me/refunds?status=&page=
async function listMine(user, query = {}) {
  const pg = getPagination(query);
  const where = { buyerId: user.id };
  if (query.status) where.status = query.status;
  const { rows, count } = await Refund.findAndCountAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: pg.limit, offset: pg.offset });
  const all = await Refund.findAll({ where: { buyerId: user.id }, attributes: ['status', 'amount', 'bankDetails'] });
  const summary = {
    pending: all.filter((r) => r.status === R.PENDING).length,
    needsBankDetails: all.filter((r) => r.status !== R.PAID && !r.bankDetails).length,
    paidTotal: round2(all.filter((r) => r.status === R.PAID).reduce((s, r) => s + num(r.amount), 0)),
  };
  summary.paidTotalLabel = money(summary.paidTotal);
  return { items: await shapeMany(rows), summary, pagination: paginationMeta(pg, count) };
}

// GET /me/refunds/:id
async function getMine(user, id) {
  const refund = await Refund.findOne({ where: { id, buyerId: user.id } });
  if (!refund) throw refundNotFound();
  return (await shapeMany([refund]))[0];
}

// GET /me/refunds/bank-account
async function getAccount(user) {
  const account = await RefundAccount.findOne({ where: { userId: user.id }, order: [['id', 'DESC']] });
  return account ? { id: account.id, ...accountDetails(account), updatedAt: account.updatedAt } : null;
}

// Fill the bank details of this buyer's refunds that are still waiting for them
async function fillMissingDetails(userId, details, transaction) {
  const rows = await Refund.findAll({ where: { buyerId: userId, status: { [Op.in]: [R.PENDING, R.FAILED] }, bankDetails: null }, transaction });
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await r.update({ bankDetails: details, ...(r.status === R.FAILED ? { status: R.PENDING } : {}) }, { transaction });
  }
  return rows.map((r) => r.id);
}

async function upsertAccount(userId, details, transaction) {
  const existing = await RefundAccount.findOne({ where: { userId }, order: [['id', 'DESC']], transaction });
  if (existing) return existing.update(details, { transaction });
  return RefundAccount.create({ userId, ...details }, { transaction });
}

// PUT /me/refunds/bank-account   { bankName, accountName, accountNumber, branchCode? }
// Saved for next time AND used for refunds still waiting for bank details.
async function saveAccount(user, data) {
  const details = accountDetails(data);
  await sequelize.transaction(async (transaction) => {
    await upsertAccount(user.id, details, transaction);
    await fillMissingDetails(user.id, details, transaction);
  });
  return getAccount(user);
}

// DELETE /me/refunds/bank-account  (refunds already created keep their copy)
async function deleteAccount(user) {
  const n = await RefundAccount.destroy({ where: { userId: user.id } });
  if (!n) throw new ApiError(404, 'No saved bank account', { code: 'REFUND_ACCOUNT_NOT_FOUND' });
}

// PUT /me/refunds/:id/bank-details   { bankName, accountName, accountNumber, branchCode?, saveForNextTime? }
// A failed refund goes back to "pending" with the new details.
async function setBankDetails(user, id, data) {
  const details = accountDetails(data);
  await sequelize.transaction(async (transaction) => {
    const refund = await Refund.findOne({ where: { id, buyerId: user.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!refund) throw refundNotFound();
    if (refund.status === R.PAID) throw new ApiError(409, 'This refund is already paid', { code: 'REFUND_ALREADY_PAID' });
    await refund.update({ bankDetails: details, status: R.PENDING }, { transaction });
    if (data.saveForNextTime) {
      await upsertAccount(user.id, details, transaction);
      await fillMissingDetails(user.id, details, transaction);
    }
  });
  notify().bankDetailsAdded(id);
  return getMine(user, id);
}

// Buyer or admin: the proof of the refund transfer
async function proofFile(id, { userId = null } = {}) {
  const refund = await Refund.findByPk(id);
  if (!refund || !refund.proofPath || (userId && refund.buyerId !== userId)) {
    throw new ApiError(404, 'File not found', { code: 'FILE_NOT_FOUND' });
  }
  return { fullPath: files.absolutePath(refund.proofPath), mimeType: refund.proofMimeType, originalName: refund.proofOriginalName };
}

// ======================= ADMIN =======================

async function buildWhere(query = {}) {
  const where = {};
  if (query.status) where.status = query.status;
  if (query.source) where.source = query.source;
  if (query.overdue === true) {
    where.status = R.PENDING;
    where.dueBy = { [Op.lt]: new Date() };
  }
  if (query.needsBankDetails === true) {
    where.status = { [Op.in]: [R.PENDING, R.FAILED] };
    where.bankDetails = null;
  }
  if (query.recoverFromSeller === true) where.recoverFromSeller = true;
  if (query.from || query.to) {
    where.createdAt = { ...(query.from ? { [Op.gte]: query.from } : {}), ...(query.to ? { [Op.lte]: query.to } : {}) };
  }
  if (query.search) {
    const like = { [Op.like]: `%${query.search}%` };
    const [orders, buyerIds] = await Promise.all([
      Order.findAll({ where: { orderNumber: like }, attributes: ['id'] }),
      directory.findUserIdsByName(query.search),
    ]);
    where[Op.or] = [
      { refundNumber: like },
      ...(orders.length ? [{ orderId: orders.map((o) => o.id) }] : []),
      ...(buyerIds.length ? [{ buyerId: buyerIds }] : []),
    ];
  }
  return where;
}

// GET /admin/refunds/stats
async function stats() {
  const rows = await Refund.findAll({ attributes: ['status', 'amount', 'dueBy', 'bankDetails', 'recoverFromSeller'] });
  const now = new Date();
  const sum = (list) => round2(list.reduce((s, r) => s + num(r.amount), 0));
  const pending = rows.filter((r) => r.status === R.PENDING);
  const paid = rows.filter((r) => r.status === R.PAID);
  const out = {
    pending: pending.length,
    pendingAmount: sum(pending),
    readyToPay: pending.filter((r) => r.bankDetails).length,
    needsBankDetails: rows.filter((r) => r.status !== R.PAID && !r.bankDetails).length,
    overdue: pending.filter((r) => r.dueBy && new Date(r.dueBy) < now).length,
    failed: rows.filter((r) => r.status === R.FAILED).length,
    paid: paid.length,
    paidAmount: sum(paid),
    recoverFromSeller: rows.filter((r) => r.recoverFromSeller).length,
  };
  out.labels = { pendingAmount: money(out.pendingAmount), paidAmount: money(out.paidAmount) };
  return out;
}

// GET /admin/refunds
async function list(query = {}) {
  const pg = getPagination(query);
  const { rows, count } = await Refund.findAndCountAll({
    where: await buildWhere(query),
    // Waiting ones: oldest first (first in, first paid)
    order: [['createdAt', query.status === R.PENDING || query.overdue ? 'ASC' : 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: await shapeMany(rows, { view: 'admin' }), pagination: paginationMeta(pg, count) };
}

// GET /admin/refunds/:id
async function getById(id) {
  const refund = await Refund.findByPk(id);
  if (!refund) throw refundNotFound();
  return (await shapeMany([refund], { view: 'admin' }))[0];
}

// GET /admin/refunds/export
async function exportCsv(query = {}) {
  const rows = await Refund.findAll({ where: await buildWhere(query), order: [['createdAt', 'DESC']], limit: 5000 });
  const shaped = await shapeMany(rows, { view: 'admin' });
  const lines = [
    toCsvLine(['Refund Number', 'Created At', 'Order', 'Seller Order', 'Buyer', 'Source', 'Status', 'Amount (E)', 'Due By', 'Paid On', 'Bank Reference', 'Bank', 'Account Name', 'Account Number', 'Recover From Seller']),
    ...shaped.map((r) =>
      toCsvLine([
        r.refundNumber,
        new Date(r.createdAt).toISOString(),
        r.order.orderNumber || '',
        r.sellerOrder ? r.sellerOrder.sellerOrderNumber || '' : '',
        r.buyer && r.buyer.name ? r.buyer.name : '',
        r.sourceLabel,
        r.statusLabel,
        r.amount.toFixed(2),
        r.dueBy ? new Date(r.dueBy).toISOString().slice(0, 10) : '',
        r.paidOn || '',
        r.bankReference || '',
        r.bankDetails ? r.bankDetails.bankName : '',
        r.bankDetails ? r.bankDetails.accountName : '',
        r.bankDetails ? r.bankDetails.accountNumber : '',
        r.recoverFromSeller ? 'Yes' : 'No',
      ])
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// POST /admin/refunds/:id/paid   (form-data: bankReference, paidOn, note?, file? = proof)
async function markPaid(id, data, file, adminId) {
  try {
    if (file) await files.verify([file], REFUND_PROOF.formats);
    await sequelize.transaction(async (transaction) => {
      const refund = await Refund.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!refund) throw refundNotFound();
      if (refund.status !== R.PENDING) {
        throw new ApiError(409, `Only a pending refund can be marked as paid (this one is ${REFUND_STATUS_LABELS[refund.status]})`, { code: 'REFUND_NOT_PENDING' });
      }
      if (!refund.bankDetails) {
        throw new ApiError(409, 'The buyer has not given bank details for this refund yet', { code: 'REFUND_NEEDS_BANK_DETAILS' });
      }
      const proof = file ? files.toRecord(file) : null;
      await refund.update(
        {
          status: R.PAID,
          paidAt: new Date(),
          paidOn: data.paidOn,
          paidBy: adminId,
          bankReference: data.bankReference,
          adminNote: data.note || null,
          ...(proof
            ? { proofPath: proof.path, proofOriginalName: proof.originalName, proofMimeType: proof.mimeType, proofSizeBytes: proof.sizeBytes }
            : {}),
        },
        { transaction }
      );
      await recordHistory(
        { orderId: refund.orderId, sellerOrderId: refund.sellerOrderId, to: 'refund_paid', actor: { type: 'admin', id: adminId }, note: `${refund.refundNumber}: ${money(refund.amount)}, ref ${data.bankReference}` },
        transaction
      );
    });
  } catch (err) {
    if (file) await files.remove([file]);
    throw err;
  }
  notify().refundPaid(id);
  return getById(id);
}

// POST /admin/refunds/:id/failed   { reason }   -> the buyer is asked for new bank details
async function markFailed(id, { reason }, adminId) {
  await sequelize.transaction(async (transaction) => {
    const refund = await Refund.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!refund) throw refundNotFound();
    if (refund.status !== R.PENDING) {
      throw new ApiError(409, 'Only a pending refund can be marked as failed', { code: 'REFUND_NOT_PENDING' });
    }
    await refund.update({ status: R.FAILED, failedAt: new Date(), failedReason: reason, adminNote: reason }, { transaction });
    await recordHistory(
      { orderId: refund.orderId, sellerOrderId: refund.sellerOrderId, to: 'refund_failed', actor: { type: 'admin', id: adminId }, note: `${refund.refundNumber}: ${reason}` },
      transaction
    );
  });
  notify().refundFailed(id);
  return getById(id);
}

module.exports = {
  remainingOf,
  proportional,
  sellerOrderBreakdown,
  assertRefundable,
  createRefund,
  refundShape,
  shapeMany,
  listMine,
  getMine,
  getAccount,
  saveAccount,
  deleteAccount,
  setBankDetails,
  proofFile,
  stats,
  list,
  getById,
  exportCsv,
  markPaid,
  markFailed,
};
