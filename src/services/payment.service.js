// Payments for orders.
//
// BANK TRANSFER
//   buyer pays into AFA's account -> uploads proof (POST /me/orders/:id/payment-proof)
//   -> order "under_review" (never auto-cancelled while under review)
//   -> admin confirms (order Paid) or rejects with a reason (buyer can upload again; at least
//      24 hours more if the deadline was close)
//
// ONLINE (payment gateway, see payments/gateways)
//   POST /me/orders/:id/pay/online -> redirect URL -> gateway calls our webhook
//   -> succeeded: order Paid | failed: buyer can try again until the deadline
//   Test mode: POST /me/orders/:id/pay/test { outcome } plays the gateway's part.
//
// UNPAID by the deadline -> cancelled by the background job, stock goes back.
// PAID AFTER CANCELLATION (online money arrives late) -> a refund is created for the admin to pay.
const path = require('path');
const fs = require('fs/promises');
const { Op } = require('sequelize');
const config = require('../config');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const { getGateway, getGatewayByName } = require('../payments/gateways');
const { assertMethodAvailable, deadlineFor } = require('./checkout.service');
const { fileMatchesKind, kindForMimeType, formatLabels } = require('../utils/fileTypes');
const shared = require('./orderShared');
const { ORDER_STATUS, SELLER_ORDER_STATUS, PAYMENT_METHODS, PAYMENT_PROOF, MIN_RETRY_HOURS_AFTER_REJECT } = require('../config/orders');

const { sequelize, Order, SellerOrder, OrderItem, Payment } = models;
const { round2, num, addHours, recordHistory, loadOrder, orderNotFound } = shared;
const S = ORDER_STATUS;

// Emails are sent after the change is saved, in the background
const orderNotify = require('./orderNotify.service');
const refundNotify = require('./refundNotify.service');
const refunds = require('./refund.service');

// ---------- files ----------
const uploadRoot = () => path.resolve(config.upload.dir);
const removeFile = (p) => (p ? fs.unlink(p).catch(() => {}) : Promise.resolve());
function absolutePath(relativePath) {
  const full = path.resolve(uploadRoot(), relativePath);
  if (!full.startsWith(uploadRoot() + path.sep)) throw new ApiError(400, 'Invalid file path', { code: 'INVALID_FILE_PATH' });
  return full;
}

// ---------- the two big state changes (always inside a transaction) ----------

// Payment received in full -> order Paid, every seller order Paid ("New order" for the seller)
async function markPaid(order, actor, transaction, note = null) {
  const now = new Date();
  const confirmHours = await settings.get('seller_confirm_hours');
  const from = order.status;
  await order.update({ status: S.PAID, paidAt: now, paymentDeadline: null }, { transaction });
  await recordHistory({ orderId: order.id, from, to: S.PAID, actor, note }, transaction);

  const sellerOrders = await SellerOrder.findAll({ where: { orderId: order.id }, transaction });
  for (const so of sellerOrders) {
    // eslint-disable-next-line no-await-in-loop
    await so.update(
      { status: SELLER_ORDER_STATUS.PAID, paidAt: now, confirmBy: addHours(now, confirmHours), payoutStatus: 'held' },
      { transaction }
    );
    // eslint-disable-next-line no-await-in-loop
    await recordHistory(
      { orderId: order.id, sellerOrderId: so.id, from: SELLER_ORDER_STATUS.AWAITING_PAYMENT, to: SELLER_ORDER_STATUS.PAID, actor },
      transaction
    );
  }
}

// Not paid (or cancelled by the buyer before paying): cancel everything and put the stock back
async function cancelUnpaid(order, { actor, reason }, transaction) {
  const now = new Date();
  const from = order.status;
  await order.update({ status: S.CANCELLED, cancelledAt: now, cancelReason: reason, cancelledBy: actor.type, paymentDeadline: null }, { transaction });
  await SellerOrder.update(
    { status: SELLER_ORDER_STATUS.CANCELLED, cancelledAt: now, payoutStatus: 'cancelled' },
    { where: { orderId: order.id }, transaction }
  );
  await Payment.update(
    { status: 'expired', completedAt: now },
    { where: { orderId: order.id, status: { [Op.in]: ['pending', 'under_review'] } }, transaction }
  );

  // Stock back (also for listings the seller deleted meanwhile; "unlimited" stock stays NULL)
  const items = await OrderItem.findAll({ where: { orderId: order.id }, attributes: ['listingId', 'quantity'], transaction });
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query('UPDATE listings SET quantity = quantity + :qty WHERE id = :id AND quantity IS NOT NULL', {
      replacements: { qty: num(item.quantity), id: item.listingId },
      transaction,
    });
  }
  await recordHistory({ orderId: order.id, from, to: S.CANCELLED, actor, note: reason }, transaction);
}

// ---------- buyer: helpers ----------
async function lockOwnOrder(user, id, transaction) {
  const order = await loadOrder({ id, userId: user.id }, { transaction, lock: true });
  if (!order) throw orderNotFound();
  return order;
}

function assertAwaitingPayment(order) {
  if (order.status === S.UNDER_REVIEW) {
    throw new ApiError(409, 'Your proof of payment is being checked by the AFA team', { code: 'PAYMENT_UNDER_REVIEW' });
  }
  if (order.status !== S.AWAITING_PAYMENT) {
    throw new ApiError(409, `This order is already ${order.status === S.PAID ? 'paid' : 'cancelled'}`, { code: 'ORDER_NOT_AWAITING_PAYMENT' });
  }
  if (order.paymentDeadline && new Date(order.paymentDeadline) < new Date()) {
    throw new ApiError(409, 'The time to pay for this order has ended', { code: 'PAYMENT_DEADLINE_PASSED' });
  }
}

// ---------- PATCH /me/orders/:id/payment-method  { paymentMethod } ----------
// The deadline is counted again from when the order was PLACED (switching can't extend it forever).
async function switchMethod(user, id, { paymentMethod }) {
  await assertMethodAvailable(paymentMethod);
  return sequelize.transaction(async (transaction) => {
    const order = await lockOwnOrder(user, id, transaction);
    assertAwaitingPayment(order);
    if (order.paymentMethod === paymentMethod) return order.id;
    const deadline = await deadlineFor(paymentMethod, order.createdAt);
    if (deadline < new Date()) {
      throw new ApiError(409, `The time to pay by ${PAYMENT_METHODS[paymentMethod]} has already ended for this order`, {
        code: 'PAYMENT_DEADLINE_PASSED',
      });
    }
    await Payment.update({ status: 'expired', completedAt: new Date() }, { where: { orderId: order.id, status: 'pending' }, transaction });
    await recordHistory(
      { orderId: order.id, to: 'payment_method_changed', actor: { type: 'buyer', id: user.id }, note: `${PAYMENT_METHODS[order.paymentMethod]} -> ${PAYMENT_METHODS[paymentMethod]}` },
      transaction
    );
    await order.update({ paymentMethod, paymentDeadline: deadline }, { transaction });
    return order.id;
  });
}

// ---------- ONLINE: POST /me/orders/:id/pay/online  { channel?, cellNumber? } ----------
//   channel    -> gateway option (ePayNet: 1 MoMo, 2 eMali, 5 card ...), see GET /me/orders/payment-methods
//   cellNumber -> mobile to pay with (default: the buyer's own mobile)
// The gateway is called OUTSIDE the database transaction (no locks held during the HTTP call).
async function startOnline(user, id, options = {}) {
  const gateway = getGateway();
  if (!gateway) throw new ApiError(422, 'Online payment is not available right now', { code: 'PAYMENT_METHOD_UNAVAILABLE' });
  const gatewayOptions = { channel: options.channel, cellNumber: options.cellNumber || user.mobile };
  if (typeof gateway.validateOptions === 'function') gateway.validateOptions(gatewayOptions);

  // 1. Check the order and create the attempt
  const { order, payment } = await sequelize.transaction(async (transaction) => {
    const o = await lockOwnOrder(user, id, transaction);
    assertAwaitingPayment(o);
    if (o.paymentMethod !== 'online') {
      throw new ApiError(409, 'This order is set to Bank Transfer. Change the payment method first.', { code: 'WRONG_PAYMENT_METHOD' });
    }
    // An older unfinished attempt is replaced by the new one
    await Payment.update({ status: 'expired', completedAt: new Date() }, { where: { orderId: o.id, method: 'online', status: 'pending' }, transaction });
    const p = await Payment.create({ orderId: o.id, method: 'online', provider: gateway.name, status: 'pending', amount: o.total }, { transaction });
    return { order: o, payment: p };
  });

  // 2. Ask the gateway for a payment page
  let started;
  try {
    started = await gateway.createPayment({
      payment,
      order,
      returnUrl: config.payment.returnUrl,
      options: gatewayOptions,
    });
  } catch (err) {
    await payment.update({ status: 'failed', completedAt: new Date(), providerPayload: { error: err.message, code: err.code || null } });
    throw err;
  }
  await payment.update({
    providerReference: started.providerReference,
    redirectUrl: started.redirectUrl,
    providerPayload: { request: started.request || null, reply: started.reply || null },
  });

  return {
    paymentId: payment.id,
    redirectUrl: started.redirectUrl,
    reference: started.providerReference,
    channel: started.request ? started.request.channelLabel || null : null,
    amount: num(order.total),
    amountLabel: shared.money(order.total),
    paymentDeadline: order.paymentDeadline,
    testMode: gateway.name === 'test',
    instructions: started.instructions || null,
  };
}

// The gateway's answer (webhook, or the test endpoint). Safe to receive twice.
async function applyGatewayResult({ provider, providerReference, status, amount, payload }) {
  const out = await sequelize.transaction(async (transaction) => {
    const payment = await Payment.findOne({ where: { provider, providerReference }, transaction, lock: transaction.LOCK.UPDATE });
    if (!payment) throw new ApiError(404, 'Payment not found', { code: 'PAYMENT_NOT_FOUND' });
    if (!['pending', 'expired'].includes(payment.status)) return { payment, alreadyDone: true };

    const order = await Order.findByPk(payment.orderId, { transaction, lock: transaction.LOCK.UPDATE });
    const now = new Date();
    if (status !== 'succeeded') {
      await payment.update({ status: 'failed', providerPayload: payload || null, completedAt: now }, { transaction });
      await recordHistory({ orderId: order.id, to: 'payment_failed', actor: { type: 'system' }, note: 'Online payment failed' }, transaction);
      return { payment, order, result: 'failed' };
    }
    if (Number.isFinite(amount) && round2(amount) < round2(payment.amount)) {
      await payment.update({ status: 'failed', providerPayload: payload || null, completedAt: now }, { transaction });
      await recordHistory({ orderId: order.id, to: 'payment_failed', actor: { type: 'system' }, note: `Amount ${amount} is less than ${num(payment.amount)}` }, transaction);
      return { payment, order, result: 'failed' };
    }
    await payment.update({ status: 'succeeded', providerPayload: payload || null, completedAt: now }, { transaction });
    if (order.status === S.AWAITING_PAYMENT) {
      await markPaid(order, { type: 'system' }, transaction, 'Paid online');
      return { payment, order, result: 'paid' };
    }
    // Money arrived after the order was cancelled: keep it cancelled and refund the buyer
    await recordHistory(
      { orderId: order.id, to: 'payment_after_cancel', actor: { type: 'system' }, note: 'Online payment received after the order was cancelled - refund needed' },
      transaction
    );
    const refund = await refunds.createRefund(
      {
        order,
        source: 'paid_after_cancel',
        reason: 'Online payment received after the order was cancelled',
        breakdown: {
          amount: round2(payment.amount),
          itemsAmount: round2(order.subtotal),
          deliveryAmount: round2(order.deliveryTotal),
          vatAmount: round2(order.vatTotal),
        },
        actor: { type: 'system' },
      },
      transaction
    );
    return { payment, order, result: 'paid_after_cancel', refundId: refund.id };
  });

  if (out.result === 'paid') orderNotify.orderPaid(out.order.id);
  if (out.result === 'failed') orderNotify.onlinePaymentFailed(out.order.id);
  if (out.result === 'paid_after_cancel') refundNotify.refundCreated(out.refundId);
  const order = out.order || (await Order.findByPk(out.payment.orderId, { attributes: ['id', 'orderNumber', 'status'] }));
  return {
    status: out.payment.status,
    alreadyProcessed: Boolean(out.alreadyDone),
    orderId: order ? order.id : null,
    orderNumber: order ? order.orderNumber : null,
    orderStatus: order ? order.status : null,
  };
}

// ---------- POST /payments/webhooks/:provider  (public, called by the gateway) ----------
// Returns the result + whether to send the buyer's browser on to the AFA result page
async function handleWebhook(providerName, req) {
  const gateway = getGatewayByName(providerName);
  if (!gateway) throw new ApiError(404, 'Unknown payment provider', { code: 'UNKNOWN_PROVIDER' });
  const result = await gateway.parseWebhook(req);
  const applied = await applyGatewayResult({ provider: gateway.name, ...result });
  const redirect = typeof gateway.redirectAfterCallback === 'function' && gateway.redirectAfterCallback();
  return { ...applied, redirectTo: redirect ? resultPageUrl(applied) : null };
}

// PAYMENT_RETURN_URL?order=AFA-ORD-000123&orderId=123&status=paid|failed
function resultPageUrl({ orderId, orderNumber, status }) {
  const base = config.payment.returnUrl;
  const params = new URLSearchParams({ order: orderNumber || '', orderId: String(orderId || ''), status: status === 'succeeded' ? 'paid' : 'failed' });
  return `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
}

// ---------- TEST MODE: POST /me/orders/:id/pay/test  { outcome } ----------
async function testOutcome(user, id, { outcome }) {
  const gateway = getGateway();
  if (!gateway || gateway.name !== 'test') {
    throw new ApiError(404, 'Test payments are switched off', { code: 'TEST_MODE_OFF' });
  }
  const order = await Order.findOne({ where: { id, userId: user.id } });
  if (!order) throw orderNotFound();
  let payment = await Payment.findOne({ where: { orderId: order.id, method: 'online', status: 'pending' }, order: [['id', 'DESC']] });
  if (!payment) {
    await startOnline(user, id); // starts one if the tester skipped /pay/online
    payment = await Payment.findOne({ where: { orderId: order.id, method: 'online', status: 'pending' }, order: [['id', 'DESC']] });
  }
  return applyGatewayResult({
    provider: 'test',
    providerReference: payment.providerReference,
    status: outcome === 'success' ? 'succeeded' : 'failed',
    amount: num(payment.amount),
    payload: { test: true, outcome },
  });
}

// ---------- BANK TRANSFER: POST /me/orders/:id/payment-proof (form-data) ----------
//   data: { amountPaid, paidOn, bankReference?, note? }   file: proof of payment
async function uploadProof(user, id, data, file) {
  let result;
  try {
    const kind = kindForMimeType(file.mimetype, PAYMENT_PROOF.formats);
    if (!kind || !(await fileMatchesKind(file.path, kind))) {
      throw new ApiError(415, `This file is not a valid ${formatLabels(PAYMENT_PROOF.formats)}`, { code: 'INVALID_FILE_CONTENT' });
    }
    result = await sequelize.transaction(async (transaction) => {
      const order = await lockOwnOrder(user, id, transaction);
      assertAwaitingPayment(order);
      if (order.paymentMethod !== 'bank_transfer') {
        throw new ApiError(409, 'This order is set to Online Payment. Change the payment method to Bank Transfer first.', {
          code: 'WRONG_PAYMENT_METHOD',
        });
      }
      const payment = await Payment.create(
        {
          orderId: order.id,
          method: 'bank_transfer',
          status: 'under_review',
          amount: order.total,
          amountPaid: data.amountPaid,
          paidOn: data.paidOn,
          bankReference: data.bankReference || null,
          buyerNote: data.note || null,
          receiptPath: path.relative(uploadRoot(), file.path).split(path.sep).join('/'),
          receiptOriginalName: String(file.originalname || 'proof').slice(0, 255),
          receiptMimeType: file.mimetype,
          receiptSizeBytes: file.size,
        },
        { transaction }
      );
      await order.update({ status: S.UNDER_REVIEW }, { transaction });
      await recordHistory(
        { orderId: order.id, from: S.AWAITING_PAYMENT, to: S.UNDER_REVIEW, actor: { type: 'buyer', id: user.id }, note: `Proof of payment uploaded (${shared.money(data.amountPaid)})` },
        transaction
      );
      return { orderId: order.id, paymentId: payment.id };
    });
  } catch (err) {
    await removeFile(file.path);
    throw err;
  }
  orderNotify.proofUploaded(result.orderId, result.paymentId);
  return result;
}

// Buyer: own receipt file. Admin: any. -> { fullPath, mimeType, originalName }
async function receiptFile(paymentId, { userId = null } = {}) {
  const payment = await Payment.findByPk(paymentId, { include: [{ model: Order, as: 'order', attributes: ['id', 'userId'] }] });
  if (!payment || !payment.receiptPath || (userId && payment.order.userId !== userId)) {
    throw new ApiError(404, 'Receipt not found', { code: 'RECEIPT_NOT_FOUND' });
  }
  return { fullPath: absolutePath(payment.receiptPath), mimeType: payment.receiptMimeType, originalName: payment.receiptOriginalName };
}

// ---------- ADMIN: confirm / reject a bank transfer ----------
async function lockPaymentForReview(paymentId, transaction) {
  const payment = await Payment.findByPk(paymentId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!payment) throw new ApiError(404, 'Payment not found', { code: 'PAYMENT_NOT_FOUND' });
  if (payment.method !== 'bank_transfer' || payment.status !== 'under_review') {
    throw new ApiError(409, 'Only a bank transfer that is under review can be confirmed or rejected', { code: 'PAYMENT_NOT_UNDER_REVIEW' });
  }
  const order = await Order.findByPk(payment.orderId, { transaction, lock: transaction.LOCK.UPDATE });
  return { payment, order };
}

// POST /admin/payments/:id/confirm  { note? }
async function confirmBankTransfer(paymentId, { note } = {}, adminId) {
  const orderId = await sequelize.transaction(async (transaction) => {
    const { payment, order } = await lockPaymentForReview(paymentId, transaction);
    if (round2(payment.amountPaid) < round2(payment.amount)) {
      throw new ApiError(422, `The amount paid (${shared.money(payment.amountPaid)}) is less than the order total (${shared.money(payment.amount)}). Reject it with a reason instead.`, {
        code: 'AMOUNT_TOO_LOW',
      });
    }
    if (order.status !== S.UNDER_REVIEW) {
      throw new ApiError(409, 'This order is no longer waiting for payment review', { code: 'ORDER_NOT_UNDER_REVIEW' });
    }
    const now = new Date();
    await payment.update({ status: 'succeeded', reviewedBy: adminId, reviewedAt: now, completedAt: now }, { transaction });
    await markPaid(order, { type: 'admin', id: adminId }, transaction, note || 'Bank transfer confirmed');
    return order.id;
  });
  orderNotify.orderPaid(orderId);
  return orderId;
}

// POST /admin/payments/:id/reject  { reason }
async function rejectBankTransfer(paymentId, { reason }, adminId) {
  const orderId = await sequelize.transaction(async (transaction) => {
    const { payment, order } = await lockPaymentForReview(paymentId, transaction);
    const now = new Date();
    await payment.update({ status: 'rejected', rejectionReason: reason, reviewedBy: adminId, reviewedAt: now, completedAt: now }, { transaction });
    if (order.status === S.UNDER_REVIEW) {
      // The buyer gets at least 24 more hours to pay / upload again
      const minDeadline = addHours(now, MIN_RETRY_HOURS_AFTER_REJECT);
      const deadline = order.paymentDeadline && new Date(order.paymentDeadline) > minDeadline ? order.paymentDeadline : minDeadline;
      await order.update({ status: S.AWAITING_PAYMENT, paymentDeadline: deadline }, { transaction });
      await recordHistory(
        { orderId: order.id, from: S.UNDER_REVIEW, to: 'payment_rejected', actor: { type: 'admin', id: adminId }, note: reason },
        transaction
      );
    }
    return order.id;
  });
  orderNotify.paymentRejected(orderId, paymentId);
  return orderId;
}

// ---------- buyer cancel (before paying) ----------
async function cancelByBuyer(user, id, { reason } = {}) {
  await sequelize.transaction(async (transaction) => {
    const order = await lockOwnOrder(user, id, transaction);
    if (order.status === S.UNDER_REVIEW) {
      throw new ApiError(409, 'Your proof of payment is being checked, so the order cannot be cancelled now', { code: 'PAYMENT_UNDER_REVIEW' });
    }
    if (order.status !== S.AWAITING_PAYMENT) {
      throw new ApiError(409, 'Only an order that is not paid yet can be cancelled here', { code: 'ORDER_NOT_AWAITING_PAYMENT' });
    }
    await cancelUnpaid(order, { actor: { type: 'buyer', id: user.id }, reason: reason || 'Cancelled by the buyer before payment' }, transaction);
  });
  orderNotify.orderCancelled(id);
  return id;
}

// ---------- background job: cancel orders not paid in time ----------
// Orders "under_review" are never touched. Returns how many were cancelled.
async function cancelOverdue({ limit = 50 } = {}) {
  const due = await Order.findAll({
    where: { status: S.AWAITING_PAYMENT, paymentDeadline: { [Op.lt]: new Date() } },
    attributes: ['id'],
    order: [['paymentDeadline', 'ASC']],
    limit,
  });
  let cancelled = 0;
  for (const { id } of due) {
    // eslint-disable-next-line no-await-in-loop
    const done = await sequelize.transaction(async (transaction) => {
      const order = await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!order || order.status !== S.AWAITING_PAYMENT || !order.paymentDeadline || new Date(order.paymentDeadline) >= new Date()) return false;
      await cancelUnpaid(order, { actor: { type: 'system' }, reason: 'Not paid in time' }, transaction);
      return true;
    });
    if (done) {
      cancelled += 1;
      orderNotify.orderCancelled(id);
    }
  }
  return cancelled;
}

module.exports = {
  markPaid,
  cancelUnpaid,
  switchMethod,
  startOnline,
  applyGatewayResult,
  handleWebhook,
  testOutcome,
  uploadProof,
  receiptFile,
  confirmBankTransfer,
  rejectBankTransfer,
  cancelByBuyer,
  cancelOverdue,
};
