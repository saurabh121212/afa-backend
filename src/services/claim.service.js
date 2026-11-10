// CLAIMS: a problem the buyer reports after delivery / collection (AFA-CLM-000001).
//
//   When:   after Delivered / Collected, until the claim window ends (farm produce 24 hours,
//           farming products 7 days; the longest item wins). One claim per seller order
//           (a withdrawn claim does not count).
//   What:   reason, items + quantities, description, photos (needed for damaged / wrong item /
//           poor quality). "Non-returnable" items: only wrong item / missing / not received.
//   Money:  the most that can be refunded = claimed items (+ their VAT); the delivery fee only
//           when the reason is "not received" and every item is claimed in full.
//
//   open ---- seller accepts ----> resolved (refund)            | awaiting_return -> resolved
//        ---- seller rejects ----> rejected -- buyer escalates --> escalated -- AFA decides (final)
//        ---- no reply in time --> escalated                      (too late to escalate -> closed)
//   awaiting_return: the buyer sends the item back within 7 days (else closed), the seller confirms
//   (no confirmation in time after the buyer sent it -> escalated). Buyer can withdraw any active claim.
//
// While a claim is active the seller order is not completed and the seller payout stays held.
const { Op } = require('sequelize');
const models = require('../models');
const creditScore = require('./creditScore.service');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const directory = require('./userDirectory');
const files = require('./privateFiles');
const refunds = require('./refund.service');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { round2, num, money, addHours, recordHistory } = require('./orderShared');
const { SELLER_ORDER_STATUS, CLAIM_WINDOW_HOURS } = require('../config/orders');
const {
  CLAIM_REASONS,
  NON_RETURNABLE_REASONS,
  PHOTO_REQUIRED_REASONS,
  NO_RETURN_POLICIES,
  CLAIM_STATUS,
  CLAIM_STATUS_LABELS,
  ACTIVE_CLAIM,
  RETURN_WINDOW_HOURS,
  CLAIM_PHOTOS,
  claimNumber,
} = require('../config/refunds');

const { sequelize, Order, SellerOrder, OrderItem, Claim, ClaimItem, ClaimMessage, ClaimPhoto } = models;
const SO = SELLER_ORDER_STATUS;
const C = CLAIM_STATUS;

const notify = () => require('./refundNotify.service');

const claimNotFound = () => new ApiError(404, 'Claim not found', { code: 'CLAIM_NOT_FOUND' });
const orderNotFound = () => new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });

// viewer = { type: 'buyer' | 'seller' | 'admin', id }
const ownerWhere = (viewer) => (viewer.type === 'buyer' ? { buyerId: viewer.id } : viewer.type === 'seller' ? { sellerId: viewer.id } : {});

// ---------- what can be claimed ----------
const itemClaimable = (item) => (CLAIM_WINDOW_HOURS[item.refundPolicy] || 0) > 0;
const allowedReasonsFor = (item) => (item.nonReturnable ? NON_RETURNABLE_REASONS : Object.keys(CLAIM_REASONS));
// Can the goods be sent back? Not for perishable produce or non-returnable items
const itemReturnable = (item) => !item.nonReturnable && !NO_RETURN_POLICIES.includes(item.refundPolicy);

function claimBlocker(so) {
  if (![SO.DELIVERED, SO.COLLECTED].includes(so.status)) {
    return so.status === SO.COMPLETED
      ? 'The time to report a problem with this order has ended'
      : so.fulfilment === 'service'
        ? 'You can report a problem once the provider marks the service as done'
        : 'You can report a problem once the order is delivered or collected';
  }
  if (!so.completeAfter || new Date(so.completeAfter) <= new Date()) return 'The time to report a problem with this order has ended';
  if (so.claimStatus === 'active') return 'There is already an open claim for this order';
  if (so.claimStatus === 'closed') return 'A claim was already made for this order';
  return null;
}

async function loadBuyerSellerOrder(user, orderId, sellerOrderId, { transaction, lock = false } = {}) {
  const order = await Order.findOne({ where: { id: orderId, userId: user.id }, transaction });
  if (!order) throw orderNotFound();
  const so = await SellerOrder.findOne({
    where: { id: sellerOrderId, orderId: order.id },
    transaction,
    ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!so) throw orderNotFound();
  return { order, so };
}

// GET /me/orders/:id/seller-orders/:sellerOrderId/claim-options
async function claimOptions(user, orderId, sellerOrderId) {
  const { so } = await loadBuyerSellerOrder(user, orderId, sellerOrderId);
  const items = await OrderItem.findAll({ where: { sellerOrderId: so.id }, order: [['id', 'ASC']] });
  const blocker = claimBlocker(so);
  return {
    canClaim: !blocker,
    reasonNotAllowed: blocker,
    windowEndsAt: so.completeAfter,
    reasons: Object.entries(CLAIM_REASONS).map(([code, label]) => ({ code, label, photoRequired: PHOTO_REQUIRED_REASONS.includes(code) })),
    items: items.map((i) => ({
      orderItemId: i.id,
      name: i.name,
      photoUrl: i.photoUrl,
      unitLabel: i.unitLabel,
      unitPrice: num(i.unitPrice),
      unitPriceLabel: money(i.unitPrice),
      quantity: num(i.quantity),
      maxQuantity: num(i.quantity),
      nonReturnable: i.nonReturnable,
      refundPolicy: i.refundPolicy,
      claimable: itemClaimable(i),
      allowedReasons: itemClaimable(i) ? allowedReasonsFor(i) : [],
      returnable: itemReturnable(i),
    })),
    remainingRefundable: refunds.remainingOf(so),
    remainingRefundableLabel: money(refunds.remainingOf(so)),
    photos: { required: PHOTO_REQUIRED_REASONS, formats: CLAIM_PHOTOS.formats, maxFiles: CLAIM_PHOTOS.maxFiles, maxSizeMB: CLAIM_PHOTOS.maxSizeMB },
    deliveryFeeRule: 'The delivery fee is refunded only when the whole order never arrived ("Not Received" with every item in full).',
  };
}

// Amounts for the claimed lines
function computeAmounts(so, orderItems, lines, reason) {
  let itemsAmount = 0;
  let vatAmount = 0;
  const rows = lines.map(({ item, quantity }) => {
    const amount = round2(num(item.unitPrice) * quantity);
    const vat = num(item.quantity) ? round2((num(item.vatAmount) * quantity) / num(item.quantity)) : 0;
    itemsAmount += amount;
    vatAmount += vat;
    return { item, quantity, amount, vat };
  });
  const everything =
    orderItems.length === lines.length && lines.every(({ item, quantity }) => round2(quantity) === round2(num(item.quantity)));
  let deliveryAmount = 0;
  if (reason === 'not_received' && everything) {
    deliveryAmount = num(so.deliveryFee);
    vatAmount += num(so.deliveryVat);
  }
  itemsAmount = round2(itemsAmount);
  vatAmount = round2(vatAmount);
  const max = Math.min(round2(itemsAmount + deliveryAmount + vatAmount), refunds.remainingOf(so));
  return { rows, itemsAmount, deliveryAmount: round2(deliveryAmount), vatAmount, maxRefund: round2(max) };
}

async function addMessageRow(claim, { senderType, senderId = null, event = null, message = null }, uploaded, transaction) {
  const msg = await ClaimMessage.create({ claimId: claim.id, senderType, senderId, event, message }, { transaction });
  for (const file of uploaded) {
    const rec = files.toRecord(file);
    // eslint-disable-next-line no-await-in-loop
    await ClaimPhoto.create({ claimId: claim.id, messageId: msg.id, ...rec }, { transaction });
  }
  return msg;
}

// ======================= BUYER =======================

// POST /me/claims  (form-data: sellerOrderId, reason, description, items = JSON [{ orderItemId, quantity }], photos[])
async function openClaim(user, data, uploaded = []) {
  let claimId;
  try {
    await files.verify(uploaded, CLAIM_PHOTOS.formats);
    if (PHOTO_REQUIRED_REASONS.includes(data.reason) && !uploaded.length) {
      throw new ApiError(422, `Please add at least one photo for "${CLAIM_REASONS[data.reason]}"`, {
        code: 'PHOTO_REQUIRED',
        errors: [{ field: 'photos', message: 'At least one photo is required' }],
      });
    }
    claimId = await sequelize.transaction(async (transaction) => {
      const so = await SellerOrder.findOne({ where: { id: data.sellerOrderId }, transaction, lock: transaction.LOCK.UPDATE });
      const order = so ? await Order.findOne({ where: { id: so.orderId, userId: user.id }, transaction }) : null;
      if (!so || !order) throw orderNotFound();
      const blocker = claimBlocker(so);
      if (blocker) throw new ApiError(409, blocker, { code: 'CLAIM_NOT_ALLOWED' });

      const orderItems = await OrderItem.findAll({ where: { sellerOrderId: so.id }, transaction });
      const byId = new Map(orderItems.map((i) => [i.id, i]));
      const errors = [];
      const seen = new Set();
      const lines = [];
      data.items.forEach((line, idx) => {
        const item = byId.get(line.orderItemId);
        const field = `items[${idx}]`;
        if (!item) return errors.push({ field, message: 'This item is not part of the order' });
        if (seen.has(item.id)) return errors.push({ field, message: `${item.name} is listed twice` });
        seen.add(item.id);
        if (!itemClaimable(item)) return errors.push({ field, message: `${item.name} cannot be claimed` });
        if (!allowedReasonsFor(item).includes(data.reason)) {
          return errors.push({ field, message: `${item.name} is non-returnable: it can only be claimed as Wrong Item, Missing Items or Not Received` });
        }
        if (!(line.quantity > 0) || round2(line.quantity) > num(item.quantity)) {
          return errors.push({ field, message: `Quantity for ${item.name} must be more than 0 and at most ${num(item.quantity)}` });
        }
        return lines.push({ item, quantity: round2(line.quantity) });
      });
      if (errors.length) throw new ApiError(422, 'Please check the items you are claiming', { code: 'VALIDATION_ERROR', errors });

      const amounts = computeAmounts(so, orderItems, lines, data.reason);
      if (!(amounts.maxRefund > 0)) throw new ApiError(409, 'This order has already been fully refunded', { code: 'NOTHING_TO_REFUND' });
      const hours = await settings.get('claim_response_hours');
      const claim = await Claim.create(
        {
          orderId: order.id,
          sellerOrderId: so.id,
          buyerId: user.id,
          sellerId: so.sellerId,
          reason: data.reason,
          description: data.description,
          status: C.OPEN,
          itemsAmount: amounts.itemsAmount,
          deliveryAmount: amounts.deliveryAmount,
          vatAmount: amounts.vatAmount,
          maxRefund: amounts.maxRefund,
          sellerRespondBy: addHours(new Date(), hours),
        },
        { transaction }
      );
      await claim.update({ claimNumber: claimNumber(claim.id) }, { transaction });
      await ClaimItem.bulkCreate(
        amounts.rows.map(({ item, quantity, amount, vat }) => ({
          claimId: claim.id,
          orderItemId: item.id,
          name: item.name,
          unitLabel: item.unitLabel,
          unitPrice: item.unitPrice,
          quantity,
          amount,
          vatAmount: vat,
        })),
        { transaction }
      );
      await addMessageRow(claim, { senderType: 'buyer', senderId: user.id, event: 'opened', message: data.description }, uploaded, transaction);
      await so.update({ claimStatus: 'active', activeClaimId: claim.id }, { transaction });
      await recordHistory(
        { orderId: order.id, sellerOrderId: so.id, to: 'claim_opened', actor: { type: 'buyer', id: user.id }, note: `${claim.claimNumber}: ${CLAIM_REASONS[data.reason]}` },
        transaction
      );
      return claim.id;
    });
  } catch (err) {
    await files.remove(uploaded);
    throw err;
  }
  notify().claimEvent(claimId, 'opened');
  return getOne({ type: 'buyer', id: user.id }, claimId);
}

// ---------- shapes ----------
const photoUrl = (viewer, claimId, photoId) =>
  `${viewer.type === 'admin' ? '/admin/claims' : viewer.type === 'seller' ? '/me/sales/claims' : '/me/claims'}/${claimId}/photos/${photoId}`;

function actionsFor(claim, viewer, returnPossible) {
  const active = ACTIVE_CLAIM.includes(claim.status);
  const now = new Date();
  if (viewer.type === 'buyer') {
    return {
      canMessage: active,
      canWithdraw: active,
      canEscalate:
        (claim.status === C.REJECTED && claim.escalateBy && new Date(claim.escalateBy) > now) ||
        (claim.status === C.OPEN && claim.sellerRespondBy && new Date(claim.sellerRespondBy) < now),
      canMarkReturned: claim.status === C.AWAITING_RETURN && !claim.buyerReturnedAt,
    };
  }
  if (viewer.type === 'seller') {
    return {
      canMessage: active,
      canAccept: claim.status === C.OPEN,
      canReject: claim.status === C.OPEN,
      canConfirmReturn: claim.status === C.AWAITING_RETURN,
      returnPossible,
    };
  }
  return { canMessage: active, canDecide: active, canConfirmReturn: claim.status === C.AWAITING_RETURN, returnPossible };
}

async function shapeClaims(rows, viewer, { full = false } = {}) {
  if (!rows.length) return [];
  const ids = rows.map((c) => c.id);
  const [items, orders, sos, dirs, messages, photos] = await Promise.all([
    ClaimItem.findAll({ where: { claimId: ids }, order: [['id', 'ASC']] }),
    Order.findAll({ where: { id: [...new Set(rows.map((c) => c.orderId))] }, attributes: ['id', 'orderNumber'] }),
    SellerOrder.findAll({ where: { id: [...new Set(rows.map((c) => c.sellerOrderId))] }, attributes: ['id', 'sellerOrderNumber', 'status', 'total', 'refundedAmount', 'fulfilment', 'completeAfter'] }),
    directory.findMany([...new Set(rows.flatMap((c) => [c.buyerId, c.sellerId]))]),
    full ? ClaimMessage.findAll({ where: { claimId: ids }, order: [['id', 'ASC']] }) : [],
    full ? ClaimPhoto.findAll({ where: { claimId: ids }, order: [['id', 'ASC']] }) : [],
  ]);
  const orderItemIds = items.map((i) => i.orderItemId);
  const orderItems = orderItemIds.length ? await OrderItem.findAll({ where: { id: orderItemIds } }) : [];
  const oiById = new Map(orderItems.map((i) => [i.id, i]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const soById = new Map(sos.map((s) => [s.id, s]));
  const name = (id) => (dirs.get(id) ? dirs.get(id).display_name : null);

  return rows.map((c) => {
    const claimItems = items.filter((i) => i.claimId === c.id);
    const returnPossible = claimItems.length > 0 && claimItems.every((ci) => oiById.get(ci.orderItemId) && itemReturnable(oiById.get(ci.orderItemId)));
    const so = soById.get(c.sellerOrderId);
    const out = {
      id: c.id,
      claimNumber: c.claimNumber,
      status: c.status,
      statusLabel: CLAIM_STATUS_LABELS[c.status],
      reason: c.reason,
      reasonLabel: CLAIM_REASONS[c.reason],
      description: c.description,
      order: orderById.get(c.orderId) ? { id: c.orderId, orderNumber: orderById.get(c.orderId).orderNumber } : { id: c.orderId },
      sellerOrder: so ? { id: so.id, sellerOrderNumber: so.sellerOrderNumber, status: so.status, fulfilment: so.fulfilment } : { id: c.sellerOrderId },
      buyer: { id: c.buyerId, name: name(c.buyerId) },
      seller: { id: c.sellerId, name: name(c.sellerId) },
      items: claimItems.map((ci) => ({
        id: ci.id,
        orderItemId: ci.orderItemId,
        name: ci.name,
        unitLabel: ci.unitLabel,
        unitPrice: num(ci.unitPrice),
        quantity: num(ci.quantity),
        orderedQuantity: oiById.get(ci.orderItemId) ? num(oiById.get(ci.orderItemId).quantity) : null,
        photoUrl: oiById.get(ci.orderItemId) ? oiById.get(ci.orderItemId).photoUrl : null,
        amount: num(ci.amount),
        vatAmount: num(ci.vatAmount),
        amountLabel: money(num(ci.amount) + num(ci.vatAmount)),
      })),
      amounts: {
        items: num(c.itemsAmount),
        delivery: num(c.deliveryAmount),
        vat: num(c.vatAmount),
        maxRefund: num(c.maxRefund),
        refundAmount: num(c.refundAmount),
        labels: {
          items: money(c.itemsAmount),
          delivery: money(c.deliveryAmount),
          vat: money(c.vatAmount),
          maxRefund: money(c.maxRefund),
          refundAmount: c.refundAmount === null ? null : money(c.refundAmount),
        },
      },
      returnRequired: c.returnRequired,
      dates: {
        openedAt: c.createdAt,
        sellerRespondBy: c.sellerRespondBy,
        sellerRespondedAt: c.sellerRespondedAt,
        escalateBy: c.status === C.REJECTED ? c.escalateBy : null,
        returnBy: c.status === C.AWAITING_RETURN && !c.buyerReturnedAt ? c.escalateBy : null,
        escalatedAt: c.escalatedAt,
        decidedAt: c.decidedAt,
        buyerReturnedAt: c.buyerReturnedAt,
        returnReceivedAt: c.returnReceivedAt,
        resolvedAt: c.resolvedAt,
        closedAt: c.closedAt,
      },
      sellerNote: c.sellerNote,
      escalation: c.escalatedAt ? { by: c.escalatedBy, note: c.escalationNote } : null,
      decision: c.decision ? { decision: c.decision, note: c.decisionNote, decidedAt: c.decidedAt } : null,
      returnNote: c.returnNote,
      closeReason: c.closeReason,
      refundId: c.refundId,
      actions: actionsFor(c, viewer, returnPossible),
    };
    if (full) {
      out.messages = messages
        .filter((m) => m.claimId === c.id)
        .map((m) => ({
          id: m.id,
          from: m.senderType,
          fromName: m.senderType === 'admin' ? 'AFA' : m.senderType === 'system' ? 'System' : name(m.senderType === 'buyer' ? c.buyerId : c.sellerId),
          event: m.event,
          message: m.message,
          at: m.createdAt,
          photos: photos.filter((p) => p.messageId === m.id).map((p) => ({ id: p.id, url: photoUrl(viewer, c.id, p.id), originalName: p.originalName })),
        }));
    }
    return out;
  });
}

async function findVisible(viewer, id, { transaction, lock = false } = {}) {
  const claim = await Claim.findOne({ where: { id, ...ownerWhere(viewer) }, transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!claim) throw claimNotFound();
  return claim;
}

// GET .../claims/:id
async function getOne(viewer, id) {
  const claim = await findVisible(viewer, id);
  return (await shapeClaims([claim], viewer, { full: true }))[0];
}

// GET /me/claims, /me/sales/claims, /admin/claims
async function list(viewer, query = {}) {
  const pg = getPagination(query);
  const where = { ...ownerWhere(viewer) };
  if (query.status) where.status = query.status;
  if (query.active === true) where.status = { [Op.in]: ACTIVE_CLAIM };
  if (query.reason) where.reason = query.reason;
  if (viewer.type === 'admin' && query.sellerId) where.sellerId = query.sellerId;
  if (viewer.type === 'admin' && query.buyerId) where.buyerId = query.buyerId;
  if (query.from || query.to) {
    where.createdAt = { ...(query.from ? { [Op.gte]: query.from } : {}), ...(query.to ? { [Op.lte]: query.to } : {}) };
  }
  if (query.search) {
    const like = { [Op.like]: `%${query.search}%` };
    const orders = await Order.findAll({ where: { orderNumber: like }, attributes: ['id'] });
    where[Op.or] = [{ claimNumber: like }, ...(orders.length ? [{ orderId: orders.map((o) => o.id) }] : [])];
  }
  const { rows, count } = await Claim.findAndCountAll({
    where,
    order: [['createdAt', query.sort === 'oldest' ? 'ASC' : 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  const counts = Object.fromEntries(Object.values(C).map((s) => [s, 0]));
  (await Claim.findAll({ where: ownerWhere(viewer), attributes: ['status'] })).forEach((c) => {
    counts[c.status] += 1;
  });
  return { items: await shapeClaims(rows, viewer), counts, pagination: paginationMeta(pg, count) };
}

// GET /admin/claims/stats
async function stats() {
  const rows = await Claim.findAll({ attributes: ['status', 'reason', 'refundAmount', 'sellerRespondBy'] });
  const byStatus = Object.fromEntries(Object.values(C).map((s) => [s, 0]));
  const byReason = Object.fromEntries(Object.keys(CLAIM_REASONS).map((r) => [r, 0]));
  let refunded = 0;
  rows.forEach((c) => {
    byStatus[c.status] += 1;
    byReason[c.reason] += 1;
    if (c.status === C.RESOLVED) refunded += num(c.refundAmount);
  });
  return {
    total: rows.length,
    active: rows.filter((c) => ACTIVE_CLAIM.includes(c.status)).length,
    toDecide: byStatus.escalated,
    byStatus,
    byReason,
    refunded: round2(refunded),
    refundedLabel: money(refunded),
  };
}

// Claims of some seller orders (order details screens)
async function claimsFor(viewer, sellerOrderIds) {
  if (!sellerOrderIds.length) return [];
  const rows = await Claim.findAll({ where: { sellerOrderId: sellerOrderIds }, order: [['id', 'DESC']] });
  return shapeClaims(rows, viewer);
}

// ---------- shared steps (inside a transaction, claim locked) ----------
async function lockSellerOrder(claim, transaction) {
  return SellerOrder.findByPk(claim.sellerOrderId, { transaction, lock: transaction.LOCK.UPDATE });
}

function assertStatus(claim, allowed, message) {
  if (!allowed.includes(claim.status)) {
    throw new ApiError(409, message || `This claim is "${CLAIM_STATUS_LABELS[claim.status]}"`, { code: 'INVALID_CLAIM_STATUS' });
  }
}

async function returnPossible(claim, transaction) {
  const items = await ClaimItem.findAll({ where: { claimId: claim.id }, attributes: ['orderItemId'], transaction });
  const ois = await OrderItem.findAll({ where: { id: items.map((i) => i.orderItemId) }, transaction });
  return ois.length > 0 && ois.every(itemReturnable);
}

function assertAmount(claim, amount, field = 'refundAmount') {
  if (!(amount > 0) || round2(amount) > num(claim.maxRefund)) {
    throw new ApiError(422, `The refund must be more than 0 and at most ${money(claim.maxRefund)}`, {
      code: 'INVALID_REFUND_AMOUNT',
      errors: [{ field, message: `Maximum ${money(claim.maxRefund)}` }],
    });
  }
}

// Refund given -> resolved; the seller order can complete again
async function resolve(claim, so, actor, transaction) {
  const order = await Order.findByPk(claim.orderId, { transaction });
  const amount = Math.min(num(claim.refundAmount), refunds.remainingOf(so));
  let refundId = null;
  if (amount > 0) {
    const breakdown = refunds.proportional(
      { items: claim.itemsAmount, delivery: claim.deliveryAmount, vat: claim.vatAmount, total: round2(num(claim.itemsAmount) + num(claim.deliveryAmount) + num(claim.vatAmount)) },
      amount
    );
    const refund = await refunds.createRefund(
      { order, sellerOrder: so, source: 'claim', reason: `${claim.claimNumber}: ${CLAIM_REASONS[claim.reason]}`, breakdown, claimId: claim.id, actor },
      transaction
    );
    refundId = refund.id;
  }
  const now = new Date();
  await claim.update({ status: C.RESOLVED, resolvedAt: now, refundId, sellerRespondBy: null }, { transaction });
  creditScore.refreshSoon(claim.sellerId, 'claim_refund', transaction); // Sales part: a refunded claim counts as a failed order (after commit)
  await so.update({ claimStatus: 'closed', activeClaimId: null }, { transaction });
  await recordHistory({ orderId: claim.orderId, sellerOrderId: so.id, to: 'claim_resolved', actor, note: `${claim.claimNumber}: refund ${money(amount)}` }, transaction);
  return refundId;
}

// No refund -> closed. withdrawn: the buyer may claim again within the window
async function close(claim, so, actor, reason, transaction, { withdrawn = false } = {}) {
  await claim.update({ status: C.CLOSED, closedAt: new Date(), closeReason: reason, sellerRespondBy: null }, { transaction });
  await so.update({ claimStatus: withdrawn ? 'none' : 'closed', activeClaimId: null }, { transaction });
  await recordHistory({ orderId: claim.orderId, sellerOrderId: so.id, to: 'claim_closed', actor, note: `${claim.claimNumber}: ${reason}` }, transaction);
}

// Runs a step on a locked claim the viewer can see, then sends the emails
async function step(viewer, id, fn, { event, uploaded = [] } = {}) {
  let refundId = null;
  try {
    await sequelize.transaction(async (transaction) => {
      const claim = await findVisible(viewer, id, { transaction, lock: true });
      const so = await lockSellerOrder(claim, transaction);
      refundId = (await fn(claim, so, transaction)) || null;
    });
  } catch (err) {
    await files.remove(uploaded);
    throw err;
  }
  notify().claimEvent(id, event, { refundId, from: viewer.type });
  return getOne(viewer, id);
}

const actorOf = (viewer) => ({ type: viewer.type, id: viewer.id });

// ---------- messages (buyer, seller, admin) ----------
// POST .../claims/:id/messages   (form-data: message?, photos[]?)
async function addMessage(viewer, id, { message }, uploaded = []) {
  await files.verify(uploaded, CLAIM_PHOTOS.formats).catch(async (err) => {
    await files.remove(uploaded);
    throw err;
  });
  if (!message && !uploaded.length) {
    throw new ApiError(422, 'Write a message or add a photo', { code: 'VALIDATION_ERROR', errors: [{ field: 'message', message: 'Message is required' }] });
  }
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      assertStatus(claim, ACTIVE_CLAIM, 'This claim is closed');
      await addMessageRow(claim, { senderType: viewer.type, senderId: viewer.id, message: message || null }, uploaded, transaction);
    },
    { event: 'message', uploaded }
  );
}

// ---------- buyer steps ----------
// POST /me/claims/:id/escalate   { note? }
function escalate(user, id, { note } = {}) {
  const viewer = { type: 'buyer', id: user.id };
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      const now = new Date();
      const lateSeller = claim.status === C.OPEN && claim.sellerRespondBy && new Date(claim.sellerRespondBy) < now;
      const rejectedInTime = claim.status === C.REJECTED && claim.escalateBy && new Date(claim.escalateBy) > now;
      if (!lateSeller && !rejectedInTime) {
        throw new ApiError(
          409,
          claim.status === C.OPEN ? 'The seller still has time to reply to your claim' : 'This claim cannot be sent to AFA now',
          { code: 'CANNOT_ESCALATE' }
        );
      }
      await claim.update({ status: C.ESCALATED, escalatedAt: now, escalatedBy: 'buyer', escalationNote: note || null, sellerRespondBy: null }, { transaction });
      await addMessageRow(claim, { senderType: 'buyer', senderId: user.id, event: 'escalated', message: note || null }, [], transaction);
    },
    { event: 'escalated' }
  );
}

// POST /me/claims/:id/withdraw   { note? }
function withdraw(user, id, { note } = {}) {
  const viewer = { type: 'buyer', id: user.id };
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      assertStatus(claim, ACTIVE_CLAIM, 'This claim is already finished');
      await addMessageRow(claim, { senderType: 'buyer', senderId: user.id, event: 'withdrawn', message: note || null }, [], transaction);
      await close(claim, so, actorOf(viewer), 'Withdrawn by the buyer', transaction, { withdrawn: true });
    },
    { event: 'withdrawn' }
  );
}

// POST /me/claims/:id/returned   { note? }  "I sent the item back"
function markReturned(user, id, { note } = {}) {
  const viewer = { type: 'buyer', id: user.id };
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      assertStatus(claim, [C.AWAITING_RETURN], 'No return is needed for this claim');
      if (claim.buyerReturnedAt) throw new ApiError(409, 'You already told us the item was sent back', { code: 'ALREADY_RETURNED' });
      const hours = await settings.get('claim_response_hours');
      await claim.update({ buyerReturnedAt: new Date(), returnNote: note || null, sellerRespondBy: addHours(new Date(), hours), escalateBy: null }, { transaction });
      await addMessageRow(claim, { senderType: 'buyer', senderId: user.id, event: 'returned', message: note || null }, [], transaction);
    },
    { event: 'returned' }
  );
}

// ---------- seller steps ----------
// POST /me/sales/claims/:id/accept   { refundAmount?, returnRequired?, note? }
function sellerAccept(seller, id, { refundAmount, returnRequired = false, note } = {}) {
  const viewer = { type: 'seller', id: seller.id };
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      assertStatus(claim, [C.OPEN], 'Only a claim waiting for your reply can be accepted');
      const amount = refundAmount === undefined || refundAmount === null ? num(claim.maxRefund) : round2(refundAmount);
      assertAmount(claim, amount);
      if (returnRequired && !(await returnPossible(claim, transaction))) {
        throw new ApiError(422, 'Fresh produce and non-returnable items are not sent back. Accept the claim without a return.', {
          code: 'RETURN_NOT_ALLOWED',
          errors: [{ field: 'returnRequired', message: 'A return is not possible for these items' }],
        });
      }
      const now = new Date();
      await claim.update({ refundAmount: amount, returnRequired: Boolean(returnRequired), sellerRespondedAt: now, sellerNote: note || null }, { transaction });
      await addMessageRow(
        claim,
        { senderType: 'seller', senderId: seller.id, event: 'accepted', message: note || `Refund of ${money(amount)} accepted${returnRequired ? ', item to be returned' : ''}` },
        [],
        transaction
      );
      if (returnRequired) {
        await claim.update({ status: C.AWAITING_RETURN, sellerRespondBy: null, escalateBy: addHours(now, RETURN_WINDOW_HOURS) }, { transaction });
        return null;
      }
      return resolve(claim, so, actorOf(viewer), transaction);
    },
    { event: 'accepted' }
  );
}

// POST /me/sales/claims/:id/reject   { reason }
function sellerReject(seller, id, { reason }) {
  const viewer = { type: 'seller', id: seller.id };
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      assertStatus(claim, [C.OPEN], 'Only a claim waiting for your reply can be rejected');
      const hours = await settings.get('claim_escalate_hours');
      const now = new Date();
      await claim.update(
        { status: C.REJECTED, sellerRespondedAt: now, sellerNote: reason, sellerRespondBy: null, escalateBy: addHours(now, hours) },
        { transaction }
      );
      await addMessageRow(claim, { senderType: 'seller', senderId: seller.id, event: 'rejected', message: reason }, [], transaction);
    },
    { event: 'rejected' }
  );
}

// POST /me/sales/claims/:id/return-received  and  /admin/claims/:id/return-received   { note? }
function confirmReturn(viewer, id, { note } = {}) {
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      assertStatus(claim, [C.AWAITING_RETURN], 'This claim is not waiting for a return');
      await claim.update({ returnReceivedAt: new Date() }, { transaction });
      await addMessageRow(claim, { senderType: viewer.type, senderId: viewer.id, event: 'return_received', message: note || 'The returned item was received' }, [], transaction);
      return resolve(claim, so, actorOf(viewer), transaction);
    },
    { event: 'return_received' }
  );
}

// ---------- admin ----------
// POST /admin/claims/:id/decide   { decision: refund | no_refund, refundAmount?, returnRequired?, note }
// AFA's decision is final. It can step in at any active stage.
function decide(adminId, id, { decision, refundAmount, returnRequired = false, note }) {
  const viewer = { type: 'admin', id: adminId };
  return step(
    viewer,
    id,
    async (claim, so, transaction) => {
      assertStatus(claim, ACTIVE_CLAIM, 'This claim is already finished');
      const now = new Date();
      const base = { decision, decidedBy: adminId, decidedAt: now, decisionNote: note };
      if (decision === 'no_refund') {
        await claim.update(base, { transaction });
        await addMessageRow(claim, { senderType: 'admin', senderId: adminId, event: 'decided', message: `No refund. ${note}` }, [], transaction);
        await close(claim, so, actorOf(viewer), `AFA decided: no refund. ${note}`.slice(0, 500), transaction);
        return null;
      }
      const amount = refundAmount === undefined || refundAmount === null ? num(claim.maxRefund) : round2(refundAmount);
      assertAmount(claim, amount);
      const needReturn = Boolean(returnRequired) && !claim.returnReceivedAt;
      if (needReturn && !(await returnPossible(claim, transaction))) {
        throw new ApiError(422, 'Fresh produce and non-returnable items are not sent back', {
          code: 'RETURN_NOT_ALLOWED',
          errors: [{ field: 'returnRequired', message: 'A return is not possible for these items' }],
        });
      }
      await claim.update({ ...base, refundAmount: amount, returnRequired: Boolean(returnRequired) }, { transaction });
      await addMessageRow(
        claim,
        { senderType: 'admin', senderId: adminId, event: 'decided', message: `Refund of ${money(amount)}${needReturn ? ' after the item is returned' : ''}. ${note}` },
        [],
        transaction
      );
      if (needReturn) {
        // Waiting for the item; already marked as sent back -> the seller has a new deadline
        const hours = await settings.get('claim_response_hours');
        await claim.update(
          {
            status: C.AWAITING_RETURN,
            sellerRespondBy: claim.buyerReturnedAt ? addHours(now, hours) : null,
            escalateBy: claim.buyerReturnedAt ? null : addHours(now, RETURN_WINDOW_HOURS),
          },
          { transaction }
        );
        return null;
      }
      return resolve(claim, so, actorOf(viewer), transaction);
    },
    { event: 'decided' }
  );
}

// GET .../claims/:id/photos/:photoId
async function photoFile(viewer, id, photoId) {
  await findVisible(viewer, id);
  const photo = await ClaimPhoto.findOne({ where: { id: photoId, claimId: id } });
  if (!photo) throw new ApiError(404, 'Photo not found', { code: 'FILE_NOT_FOUND' });
  return { fullPath: files.absolutePath(photo.path), mimeType: photo.mimeType, originalName: photo.originalName };
}

// ======================= BACKGROUND JOBS =======================
// 1. seller did not reply (or did not confirm a returned item) in time -> escalated to AFA
// 2. rejected and the buyer did not escalate in time, or a needed return not sent in time -> closed
async function runDue({ limit = 50 } = {}) {
  const now = new Date();
  const toEscalate = await Claim.findAll({
    where: {
      sellerRespondBy: { [Op.lt]: now },
      [Op.or]: [{ status: C.OPEN }, { status: C.AWAITING_RETURN, buyerReturnedAt: { [Op.ne]: null } }],
    },
    attributes: ['id'],
    limit,
  });
  const toClose = await Claim.findAll({
    where: { escalateBy: { [Op.lt]: now }, [Op.or]: [{ status: C.REJECTED }, { status: C.AWAITING_RETURN, buyerReturnedAt: null }] },
    attributes: ['id'],
    limit,
  });
  let escalated = 0;
  let closed = 0;
  for (const { id } of toEscalate) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await sequelize.transaction(async (transaction) => {
      const claim = await Claim.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!claim || ![C.OPEN, C.AWAITING_RETURN].includes(claim.status) || !claim.sellerRespondBy || new Date(claim.sellerRespondBy) >= new Date()) return false;
      const text = claim.status === C.OPEN ? 'The seller did not reply in time' : 'The seller did not confirm the returned item in time';
      await claim.update({ status: C.ESCALATED, escalatedAt: new Date(), escalatedBy: 'system', escalationNote: text, sellerRespondBy: null }, { transaction });
      await addMessageRow(claim, { senderType: 'system', event: 'escalated', message: text }, [], transaction);
      return true;
    });
    if (ok) {
      escalated += 1;
      notify().claimEvent(id, 'escalated', { from: 'system' });
    }
  }
  for (const { id } of toClose) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await sequelize.transaction(async (transaction) => {
      const claim = await Claim.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!claim || !claim.escalateBy || new Date(claim.escalateBy) >= new Date()) return false;
      const rejected = claim.status === C.REJECTED;
      if (!rejected && !(claim.status === C.AWAITING_RETURN && !claim.buyerReturnedAt)) return false;
      const so = await lockSellerOrder(claim, transaction);
      const text = rejected ? 'Rejected by the seller and not sent to AFA in time' : 'The item was not sent back in time';
      await addMessageRow(claim, { senderType: 'system', event: 'closed', message: text }, [], transaction);
      await close(claim, so, { type: 'system' }, text, transaction);
      return true;
    });
    if (ok) {
      closed += 1;
      notify().claimEvent(id, 'closed', { from: 'system' });
    }
  }
  return { escalated, closed };
}

module.exports = {
  claimOptions,
  openClaim,
  getOne,
  list,
  stats,
  claimsFor,
  addMessage,
  escalate,
  withdraw,
  markReturned,
  sellerAccept,
  sellerReject,
  confirmReturn,
  decide,
  photoFile,
  runDue,
};
