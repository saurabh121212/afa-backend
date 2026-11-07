// CANCELLING A PAID ORDER (one seller's part = seller order, AFA-ORD-000123-1).
//
//   BUYER   "New Order" (seller has not confirmed)  -> cancelled at once, full refund
//           Confirmed / Packed                     -> cancellation REQUEST to the seller
//                                                     (accept / decline; no answer in time -> AFA decides)
//           Dispatched / Ready for pickup or later -> can't cancel (claim after delivery instead)
//   SELLER  any time before dispatch, with a reason -> full refund (counted as a seller cancellation)
//   SYSTEM  not confirmed in time (setting seller_auto_cancel_hours) -> full refund
//   ADMIN   any stage until completed, full or partial refund; also a refund without cancelling
//
// Stock goes back when the goods never left the seller. When every seller order of a checkout
// is cancelled, the checkout itself becomes Cancelled.
//
// SERVICE BOOKINGS (fulfilment "service"): the buyer cancels at once while the booking is "New Booking",
// or "Confirmed" until 24 hours before the start; after that it is a REQUEST to the provider.
// No cancelling once "In Progress" (the admin can). The provider can cancel before it starts.
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const directory = require('./userDirectory');
const refunds = require('./refund.service');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { round2, num, money, addHours, recordHistory } = require('./orderShared');
const { ORDER_STATUS, SELLER_ORDER_STATUS, SELLER_ORDER_STATUS_LABELS } = require('../config/orders');
const {
  BUYER_DIRECT_CANCEL,
  BUYER_REQUEST_CANCEL,
  SELLER_CANCEL,
  ADMIN_CANCEL,
  RESTOCK_STATUSES,
  CANCEL_REQUEST_STATUS,
  CANCEL_REQUEST_STATUS_LABELS,
  OPEN_CANCEL_REQUEST,
  CLAIM_STATUS,
} = require('../config/refunds');

const { buyerCancelMode } = require('../config/bookings');
const creditScore = require('./creditScore.service');

const { sequelize, Order, SellerOrder, OrderItem, CancellationRequest, Claim, ClaimMessage, Booking } = models;
const SO = SELLER_ORDER_STATUS;
const CR = CANCEL_REQUEST_STATUS;

const notify = () => require('./refundNotify.service');

const orderNotFound = () => new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });
const requestNotFound = () => new ApiError(404, 'Cancellation request not found', { code: 'CANCEL_REQUEST_NOT_FOUND' });

// ---------- the core: cancel one (locked) seller order ----------
//   actor { type, id }, reason, source (refund source), refundAmount (null = everything left),
//   cancelledBy (who the cancellation counts against, default actor.type), request (accepted / approved request)
async function cancelSellerOrder(so, order, { actor, reason, source, refundAmount = null, cancelledBy = null, request = null }, transaction) {
  // Sales part (seller / system cancellations count as failed): recalculated after the commit
  creditScore.refreshSoon(so.sellerId, 'order_cancelled', transaction);
  const now = new Date();
  const from = so.status;

  // Stock back if the goods never left the seller (services have no stock)
  if (RESTOCK_STATUSES.includes(from) && so.fulfilment !== 'service') {
    const items = await OrderItem.findAll({ where: { sellerOrderId: so.id }, attributes: ['listingId', 'quantity'], transaction });
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.query('UPDATE listings SET quantity = quantity + :qty WHERE id = :id AND quantity IS NOT NULL', {
        replacements: { qty: num(item.quantity), id: item.listingId },
        transaction,
      });
    }
  }

  // Another open request on this seller order is closed (the order is cancelled anyway)
  if (so.openCancelRequestId && (!request || request.id !== so.openCancelRequestId)) {
    await CancellationRequest.update(
      { status: CR.CLOSED, decisionNote: 'The order was cancelled' },
      { where: { id: so.openCancelRequestId, status: { [Op.in]: OPEN_CANCEL_REQUEST } }, transaction }
    );
  }
  // An active claim (admin cancelling after delivery) is closed too
  if (so.activeClaimId) {
    await Claim.update(
      { status: CLAIM_STATUS.CLOSED, closedAt: now, closeReason: 'The order was cancelled by AFA' },
      { where: { id: so.activeClaimId }, transaction }
    );
    await ClaimMessage.create({ claimId: so.activeClaimId, senderType: 'system', event: 'closed', message: 'The order was cancelled by AFA' }, { transaction });
  }

  await so.update(
    {
      status: SO.CANCELLED,
      cancelledAt: now,
      cancelReason: String(reason).slice(0, 500),
      cancelledBy: cancelledBy || actor.type,
      openCancelRequestId: null,
      activeClaimId: null,
      ...(so.activeClaimId ? { claimStatus: 'closed' } : {}),
    },
    { transaction }
  );
  await recordHistory({ orderId: order.id, sellerOrderId: so.id, from, to: SO.CANCELLED, actor, note: reason }, transaction);

  // Refund
  const amount = refundAmount === null ? refunds.remainingOf(so) : round2(refundAmount);
  let refund = null;
  if (amount > 0) {
    refund = await refunds.createRefund(
      {
        order,
        sellerOrder: so,
        source,
        reason,
        breakdown: refunds.sellerOrderBreakdown(so, amount),
        cancellationRequestId: request ? request.id : null,
        actor,
      },
      transaction
    );
  }
  // A partial refund: the rest is the seller's (AFA decided), so the payout is released
  if (so.payoutStatus === 'held') {
    await so.update(num(so.payoutAmount) > 0 ? { payoutStatus: 'released' } : { payoutStatus: 'cancelled' }, { transaction });
  }

  // Every seller order cancelled -> the checkout is cancelled too
  const others = await SellerOrder.count({ where: { orderId: order.id, status: { [Op.ne]: SO.CANCELLED } }, transaction });
  if (!others && order.status !== ORDER_STATUS.CANCELLED) {
    const fromOrder = order.status;
    await order.update({ status: ORDER_STATUS.CANCELLED, cancelledAt: now, cancelReason: 'All items were cancelled', cancelledBy: cancelledBy || actor.type }, { transaction });
    await recordHistory({ orderId: order.id, from: fromOrder, to: ORDER_STATUS.CANCELLED, actor, note: 'All items were cancelled' }, transaction);
  }
  return { refundId: refund ? refund.id : null };
}

// ---------- loading + locking ----------
async function lockForBuyer(user, orderId, sellerOrderId, transaction) {
  const order = await Order.findOne({ where: { id: orderId, userId: user.id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!order) throw orderNotFound();
  const so = await SellerOrder.findOne({ where: { id: sellerOrderId, orderId: order.id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!so) throw orderNotFound();
  return { order, so };
}

async function lockForSeller(seller, sellerOrderId, transaction) {
  const so = await SellerOrder.findOne({
    where: { id: sellerOrderId, sellerId: seller.id, paidAt: { [Op.ne]: null } },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!so) throw orderNotFound();
  const order = await Order.findByPk(so.orderId, { transaction, lock: transaction.LOCK.UPDATE });
  return { order, so };
}

async function lockById(orderId, sellerOrderId, transaction) {
  const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!order) throw orderNotFound();
  const so = await SellerOrder.findOne({ where: { id: sellerOrderId, orderId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!so) throw orderNotFound();
  return { order, so };
}

const statusLabel = (s) => SELLER_ORDER_STATUS_LABELS[s] || s;

// ======================= BUYER =======================

// POST /me/orders/:id/seller-orders/:sellerOrderId/cancel   { reason }
//   "New Order"            -> cancelled now        { result: 'cancelled', refundId }
//   Confirmed / Packed     -> request to the seller { result: 'requested', requestId, respondBy }
async function buyerCancel(user, orderId, sellerOrderId, { reason }) {
  const out = await sequelize.transaction(async (transaction) => {
    const { order, so } = await lockForBuyer(user, orderId, sellerOrderId, transaction);
    const actor = { type: 'buyer', id: user.id };
    // Bookings follow the start date (see buyerCancelMode)
    const mode =
      so.fulfilment === 'service'
        ? buyerCancelMode(so, await Booking.findOne({ where: { sellerOrderId: so.id }, transaction }))
        : BUYER_DIRECT_CANCEL.includes(so.status)
          ? 'direct'
          : BUYER_REQUEST_CANCEL.includes(so.status)
            ? 'request'
            : null;

    if (mode === 'direct') {
      const { refundId } = await cancelSellerOrder(so, order, { actor, reason, source: 'buyer_cancel' }, transaction);
      return { result: 'cancelled', refundId, sellerOrderId: so.id };
    }

    if (mode === 'request') {
      if (so.openCancelRequestId) {
        throw new ApiError(409, 'You already asked to cancel this order. Please wait for the answer.', { code: 'CANCEL_REQUEST_EXISTS' });
      }
      const decided = await CancellationRequest.count({ where: { sellerOrderId: so.id, status: { [Op.in]: [CR.DECLINED, CR.REJECTED] } }, transaction });
      if (decided) {
        throw new ApiError(409, 'Your cancellation request for this order was already declined. If something goes wrong after delivery, you can report a problem.', {
          code: 'CANCEL_REQUEST_ALREADY_DECIDED',
        });
      }
      const hours = await settings.get('cancel_request_response_hours');
      const request = await CancellationRequest.create(
        {
          orderId: order.id,
          sellerOrderId: so.id,
          buyerId: user.id,
          sellerId: so.sellerId,
          reason,
          status: CR.PENDING,
          respondBy: addHours(new Date(), hours),
        },
        { transaction }
      );
      await so.update({ openCancelRequestId: request.id }, { transaction });
      await recordHistory({ orderId: order.id, sellerOrderId: so.id, to: 'cancel_requested', actor, note: reason }, transaction);
      return { result: 'requested', requestId: request.id, respondBy: request.respondBy, sellerOrderId: so.id };
    }

    if (so.status === SO.CANCELLED) throw new ApiError(409, 'This order is already cancelled', { code: 'ALREADY_CANCELLED' });
    throw new ApiError(
      409,
      `This order is "${statusLabel(so.status)}" and can no longer be cancelled. If there is a problem after you receive it, you can report it (claim).`,
      { code: 'CANNOT_CANCEL' }
    );
  });

  if (out.result === 'cancelled') notify().sellerOrderCancelled(out.sellerOrderId, out.refundId);
  else notify().cancelRequested(out.requestId);
  return out;
}

// DELETE /me/orders/:id/seller-orders/:sellerOrderId/cancel-request
async function withdrawRequest(user, orderId, sellerOrderId) {
  const requestId = await sequelize.transaction(async (transaction) => {
    const { order, so } = await lockForBuyer(user, orderId, sellerOrderId, transaction);
    if (!so.openCancelRequestId) throw new ApiError(409, 'There is no open cancellation request for this order', { code: 'NO_OPEN_CANCEL_REQUEST' });
    const request = await CancellationRequest.findByPk(so.openCancelRequestId, { transaction, lock: transaction.LOCK.UPDATE });
    await request.update({ status: CR.WITHDRAWN, respondedAt: new Date() }, { transaction });
    await so.update({ openCancelRequestId: null }, { transaction });
    await recordHistory({ orderId: order.id, sellerOrderId: so.id, to: 'cancel_request_withdrawn', actor: { type: 'buyer', id: user.id } }, transaction);
    return request.id;
  });
  notify().cancelRequestAnswered(requestId);
}

// ======================= SELLER =======================

// POST /me/sales/:id/cancel   { reason }
// If the buyer asked to cancel, this is the same as accepting the request.
async function sellerCancel(seller, sellerOrderId, { reason }) {
  const out = await sequelize.transaction(async (transaction) => {
    const { order, so } = await lockForSeller(seller, sellerOrderId, transaction);
    if (!SELLER_CANCEL.includes(so.status)) {
      throw new ApiError(
        409,
        so.status === SO.CANCELLED
          ? 'This order is already cancelled'
          : so.fulfilment === 'service'
            ? `This booking is "${statusLabel(so.status)}". Bookings can only be cancelled before the service starts. Please contact AFA.`
            : `This order is "${statusLabel(so.status)}". Orders can only be cancelled before they are dispatched or ready for pickup. Please contact AFA.`,
        { code: so.status === SO.CANCELLED ? 'ALREADY_CANCELLED' : 'CANNOT_CANCEL' }
      );
    }
    const actor = { type: 'seller', id: seller.id };
    if (so.openCancelRequestId) {
      const request = await CancellationRequest.findByPk(so.openCancelRequestId, { transaction, lock: transaction.LOCK.UPDATE });
      return acceptLocked(request, so, order, actor, reason, transaction);
    }
    const { refundId } = await cancelSellerOrder(so, order, { actor, reason, source: 'seller_cancel' }, transaction);
    return { sellerOrderId: so.id, refundId };
  });
  notify().sellerOrderCancelled(out.sellerOrderId, out.refundId);
  if (out.requestId) notify().cancelRequestAnswered(out.requestId);
  return out;
}

// Accept a request (seller or admin): cancelled, full refund, counted as the BUYER's cancellation
async function acceptLocked(request, so, order, actor, note, transaction) {
  const status = actor.type === 'admin' ? CR.APPROVED : CR.ACCEPTED;
  const now = new Date();
  await request.update(
    actor.type === 'admin'
      ? { status, decidedBy: actor.id, decidedAt: now, decisionNote: note || null }
      : { status, respondedAt: now, responseNote: note || null },
    { transaction }
  );
  const { refundId } = await cancelSellerOrder(
    so,
    order,
    { actor, reason: `Cancelled at the buyer's request: ${request.reason}`, source: 'cancel_request', cancelledBy: 'buyer', request },
    transaction
  );
  return { sellerOrderId: so.id, refundId, requestId: request.id };
}

async function lockSellerRequest(seller, sellerOrderId, transaction) {
  const { order, so } = await lockForSeller(seller, sellerOrderId, transaction);
  if (!so.openCancelRequestId) throw new ApiError(409, 'There is no open cancellation request for this order', { code: 'NO_OPEN_CANCEL_REQUEST' });
  const request = await CancellationRequest.findByPk(so.openCancelRequestId, { transaction, lock: transaction.LOCK.UPDATE });
  return { order, so, request };
}

// POST /me/sales/:id/cancel-request/accept   { note? }
async function sellerAccept(seller, sellerOrderId, { note } = {}) {
  const out = await sequelize.transaction(async (transaction) => {
    const { order, so, request } = await lockSellerRequest(seller, sellerOrderId, transaction);
    return acceptLocked(request, so, order, { type: 'seller', id: seller.id }, note, transaction);
  });
  notify().sellerOrderCancelled(out.sellerOrderId, out.refundId);
  notify().cancelRequestAnswered(out.requestId);
  return out;
}

// POST /me/sales/:id/cancel-request/decline   { reason }
// Only while it is waiting for the seller (once with AFA, AFA decides).
async function sellerDecline(seller, sellerOrderId, { reason }) {
  const requestId = await sequelize.transaction(async (transaction) => {
    const { order, so, request } = await lockSellerRequest(seller, sellerOrderId, transaction);
    if (request.status !== CR.PENDING) {
      throw new ApiError(409, 'This request was not answered in time and is now with the AFA team', { code: 'CANCEL_REQUEST_ESCALATED' });
    }
    await request.update({ status: CR.DECLINED, respondedAt: new Date(), responseNote: reason }, { transaction });
    await so.update({ openCancelRequestId: null }, { transaction });
    await recordHistory({ orderId: order.id, sellerOrderId: so.id, to: 'cancel_request_declined', actor: { type: 'seller', id: seller.id }, note: reason }, transaction);
    return request.id;
  });
  notify().cancelRequestAnswered(requestId);
  return { requestId };
}

// ======================= ADMIN =======================

// POST /admin/orders/:id/seller-orders/:sellerOrderId/cancel   { reason, refundAmount? }
async function adminCancel(adminId, orderId, sellerOrderId, { reason, refundAmount = null }) {
  const out = await sequelize.transaction(async (transaction) => {
    const { order, so } = await lockById(orderId, sellerOrderId, transaction);
    if (!ADMIN_CANCEL.includes(so.status)) {
      throw new ApiError(
        409,
        so.status === SO.CANCELLED
          ? 'This order is already cancelled'
          : so.status === SO.COMPLETED
            ? 'This order is completed. Use "Refund" instead.'
            : 'This order is not paid yet. The buyer can cancel it, or it is cancelled automatically when not paid in time.',
        { code: so.status === SO.CANCELLED ? 'ALREADY_CANCELLED' : 'CANNOT_CANCEL' }
      );
    }
    if (refundAmount !== null && refundAmount !== undefined && refundAmount !== 0) refunds.assertRefundable(so, refundAmount, 'refundAmount');
    const { refundId } = await cancelSellerOrder(
      so,
      order,
      { actor: { type: 'admin', id: adminId }, reason, source: 'admin_cancel', refundAmount: refundAmount === undefined ? null : refundAmount },
      transaction
    );
    return { sellerOrderId: so.id, refundId };
  });
  notify().sellerOrderCancelled(out.sellerOrderId, out.refundId);
  return out;
}

// POST /admin/orders/:id/seller-orders/:sellerOrderId/refund   { amount, reason }
// A refund WITHOUT cancelling (any paid stage, also after completion).
async function adminRefund(adminId, orderId, sellerOrderId, { amount, reason }) {
  const refundId = await sequelize.transaction(async (transaction) => {
    const { order, so } = await lockById(orderId, sellerOrderId, transaction);
    if (!so.paidAt) throw new ApiError(409, 'This order is not paid', { code: 'ORDER_NOT_PAID' });
    refunds.assertRefundable(so, amount);
    const refund = await refunds.createRefund(
      { order, sellerOrder: so, source: 'admin_refund', reason, breakdown: refunds.sellerOrderBreakdown(so, amount), actor: { type: 'admin', id: adminId } },
      transaction
    );
    return refund.id;
  });
  notify().refundCreated(refundId);
  return { refundId };
}

// ---------- requests: list + decide ----------
function requestShape(r, { order, so, dirs }) {
  const name = (id) => (dirs.get(id) ? dirs.get(id).display_name : null);
  return {
    id: r.id,
    status: r.status,
    statusLabel: CANCEL_REQUEST_STATUS_LABELS[r.status],
    reason: r.reason,
    order: order ? { id: order.id, orderNumber: order.orderNumber } : { id: r.orderId },
    sellerOrder: so
      ? { id: so.id, sellerOrderNumber: so.sellerOrderNumber, status: so.status, statusLabel: statusLabel(so.status), total: num(so.total), totalLabel: money(so.total) }
      : { id: r.sellerOrderId },
    buyer: { id: r.buyerId, name: name(r.buyerId) },
    seller: { id: r.sellerId, name: name(r.sellerId) },
    createdAt: r.createdAt,
    respondBy: r.respondBy,
    respondedAt: r.respondedAt,
    responseNote: r.responseNote,
    escalatedAt: r.escalatedAt,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    canDecide: OPEN_CANCEL_REQUEST.includes(r.status),
  };
}

async function shapeRequests(rows) {
  if (!rows.length) return [];
  const [orders, sos, dirs] = await Promise.all([
    Order.findAll({ where: { id: [...new Set(rows.map((r) => r.orderId))] }, attributes: ['id', 'orderNumber'] }),
    SellerOrder.findAll({ where: { id: [...new Set(rows.map((r) => r.sellerOrderId))] }, attributes: ['id', 'sellerOrderNumber', 'status', 'total'] }),
    directory.findMany([...new Set(rows.flatMap((r) => [r.buyerId, r.sellerId]))]),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const soById = new Map(sos.map((s) => [s.id, s]));
  return rows.map((r) => requestShape(r, { order: orderById.get(r.orderId), so: soById.get(r.sellerOrderId), dirs }));
}

// GET /admin/orders/cancellation-requests?status=escalated&page=
async function listRequests(query = {}) {
  const pg = getPagination(query);
  const where = {};
  if (query.status) where.status = query.status;
  const { rows, count } = await CancellationRequest.findAndCountAll({
    where,
    order: [['createdAt', OPEN_CANCEL_REQUEST.includes(query.status) ? 'ASC' : 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  const counts = Object.fromEntries(Object.values(CR).map((s) => [s, 0]));
  (await CancellationRequest.findAll({ attributes: ['status'] })).forEach((r) => {
    counts[r.status] += 1;
  });
  return { items: await shapeRequests(rows), counts, pagination: paginationMeta(pg, count) };
}

// Requests of some seller orders (for order details screens)
async function requestsFor(sellerOrderIds) {
  if (!sellerOrderIds.length) return [];
  const rows = await CancellationRequest.findAll({ where: { sellerOrderId: sellerOrderIds }, order: [['id', 'DESC']] });
  return shapeRequests(rows);
}

// POST /admin/orders/cancellation-requests/:requestId/decide   { decision: approve | reject, note? }
async function decideRequest(adminId, requestId, { decision, note }) {
  const out = await sequelize.transaction(async (transaction) => {
    const request = await CancellationRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!request) throw requestNotFound();
    if (!OPEN_CANCEL_REQUEST.includes(request.status)) {
      throw new ApiError(409, `This request is already ${CANCEL_REQUEST_STATUS_LABELS[request.status].toLowerCase()}`, { code: 'CANCEL_REQUEST_CLOSED' });
    }
    const { order, so } = await lockById(request.orderId, request.sellerOrderId, transaction);
    const actor = { type: 'admin', id: adminId };
    if (decision === 'approve') return acceptLocked(request, so, order, actor, note, transaction);

    await request.update({ status: CR.REJECTED, decidedBy: adminId, decidedAt: new Date(), decisionNote: note || null }, { transaction });
    await so.update({ openCancelRequestId: null }, { transaction });
    await recordHistory({ orderId: order.id, sellerOrderId: so.id, to: 'cancel_request_rejected', actor, note }, transaction);
    return { requestId: request.id };
  });
  if (out.refundId !== undefined) notify().sellerOrderCancelled(out.sellerOrderId, out.refundId);
  notify().cancelRequestAnswered(out.requestId);
  return (await shapeRequests([await CancellationRequest.findByPk(requestId)]))[0];
}

// ======================= BACKGROUND JOBS =======================

// Paid but not confirmed by the seller in time -> cancelled, full refund
async function autoCancelUnconfirmed({ limit = 50 } = {}) {
  const hours = await settings.get('seller_auto_cancel_hours');
  const cutoff = addHours(new Date(), -hours);
  const due = await SellerOrder.findAll({ where: { status: SO.PAID, paidAt: { [Op.lt]: cutoff } }, attributes: ['id'], limit });
  let done = 0;
  for (const { id } of due) {
    // eslint-disable-next-line no-await-in-loop
    const out = await sequelize.transaction(async (transaction) => {
      const so = await SellerOrder.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!so || so.status !== SO.PAID || !so.paidAt || new Date(so.paidAt) >= cutoff) return null;
      const order = await Order.findByPk(so.orderId, { transaction, lock: transaction.LOCK.UPDATE });
      return cancelSellerOrder(
        so,
        order,
        { actor: { type: 'system' }, reason: `The seller did not confirm the order within ${hours} hours`, source: 'system_cancel', cancelledBy: 'system' },
        transaction
      );
    });
    if (out) {
      done += 1;
      notify().sellerOrderCancelled(id, out.refundId);
    }
  }
  return done;
}

// Requests the seller did not answer in time -> AFA decides
async function escalateRequests({ limit = 50 } = {}) {
  const due = await CancellationRequest.findAll({ where: { status: CR.PENDING, respondBy: { [Op.lt]: new Date() } }, attributes: ['id'], limit });
  let done = 0;
  for (const { id } of due) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await sequelize.transaction(async (transaction) => {
      const r = await CancellationRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r || r.status !== CR.PENDING || new Date(r.respondBy) >= new Date()) return false;
      await r.update({ status: CR.ESCALATED, escalatedAt: new Date() }, { transaction });
      await recordHistory(
        { orderId: r.orderId, sellerOrderId: r.sellerOrderId, to: 'cancel_request_escalated', actor: { type: 'system' }, note: 'The seller did not answer in time' },
        transaction
      );
      return true;
    });
    if (ok) {
      done += 1;
      notify().cancelRequestEscalated(id);
    }
  }
  return done;
}

module.exports = {
  cancelSellerOrder,
  buyerCancel,
  withdrawRequest,
  sellerCancel,
  sellerAccept,
  sellerDecline,
  adminCancel,
  adminRefund,
  listRequests,
  requestsFor,
  decideRequest,
  autoCancelUnconfirmed,
  escalateRequests,
};
