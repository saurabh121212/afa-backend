// Shared pieces for checkout, payments and the buyer / seller / admin order screens:
// loading an order, the API "shapes", the timeline and small helpers.
const { Order, SellerOrder, OrderItem, OrderStatusHistory, Payment, Refund } = require('../models');
const ApiError = require('../utils/ApiError');
const { CURRENCY } = require('../config/listingOptions');
const {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  SELLER_ORDER_STATUS,
  SELLER_ORDER_STATUS_LABELS,
  SELLER_TRANSITIONS,
  PAYMENT_METHODS,
  PAYMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
} = require('../config/orders');
const { BUYER_DIRECT_CANCEL, BUYER_REQUEST_CANCEL, SELLER_CANCEL, CANCELLED_BY_LABELS } = require('../config/refunds');

// ---------- numbers ----------
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const money = (n) =>
  `${CURRENCY.symbol} ${round2(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const addHours = (date, hours) => new Date(new Date(date).getTime() + hours * 3600 * 1000);
const addMinutes = (date, minutes) => new Date(new Date(date).getTime() + minutes * 60 * 1000);

// ---------- history ----------
// actor = { type: 'buyer' | 'seller' | 'admin' | 'system', id }
function recordHistory({ orderId, sellerOrderId = null, from = null, to, actor, note = null }, transaction) {
  return OrderStatusHistory.create(
    { orderId, sellerOrderId, fromStatus: from, toStatus: to, actorType: actor.type, actorId: actor.id || null, note },
    { transaction }
  );
}

const HISTORY_LABELS = {
  ...SELLER_ORDER_STATUS_LABELS,
  ...ORDER_STATUS_LABELS,
  placed: 'Order Placed',
  payment_rejected: 'Payment Rejected',
  payment_failed: 'Online Payment Failed',
  payment_method_changed: 'Payment Method Changed',
  payment_after_cancel: 'Payment Received After Cancellation',
  // Phase 4
  cancel_requested: 'Cancellation Requested',
  cancel_request_withdrawn: 'Cancellation Request Withdrawn',
  cancel_request_declined: 'Cancellation Request Declined',
  cancel_request_escalated: 'Cancellation Request Sent to AFA',
  cancel_request_rejected: 'Cancellation Request Rejected by AFA',
  claim_opened: 'Problem Reported (Claim)',
  claim_resolved: 'Claim Resolved',
  claim_closed: 'Claim Closed',
  refund_created: 'Refund Due',
  refund_paid: 'Refund Paid',
  refund_failed: 'Refund Failed',
};

function timeline(history = [], sellerOrderId = null) {
  return history
    .filter((h) => !sellerOrderId || !h.sellerOrderId || h.sellerOrderId === sellerOrderId)
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id)
    .map((h) => ({
      status: h.toStatus,
      label: HISTORY_LABELS[h.toStatus] || h.toStatus,
      at: h.createdAt,
      by: h.actorType,
      note: h.note,
      sellerOrderId: h.sellerOrderId,
    }));
}

// ---------- loading ----------
const fullIncludes = () => [
  { model: SellerOrder, as: 'sellerOrders', include: [{ model: OrderItem, as: 'items' }] },
  { model: Payment, as: 'payments' },
  { model: OrderStatusHistory, as: 'history' },
  { model: Refund, as: 'refunds' },
];

async function loadOrder(where, { transaction, lock = false } = {}) {
  if (lock) {
    // Lock the order row first (no joins), then read the rest
    const locked = await Order.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
    if (!locked) return null;
  }
  return Order.findOne({ where, include: fullIncludes(), transaction });
}

const orderNotFound = () => new ApiError(404, 'Order not found', { code: 'ORDER_NOT_FOUND' });

// ---------- shapes ----------
const totalsShape = (o) => ({
  subtotal: num(o.subtotal),
  deliveryTotal: num(o.deliveryTotal),
  vatTotal: num(o.vatTotal),
  total: num(o.total),
  vatRate: num(o.vatRate),
  currency: o.currency || CURRENCY.code,
  labels: {
    subtotal: money(o.subtotal),
    delivery: Number(o.deliveryTotal) ? money(o.deliveryTotal) : 'Free',
    vatTitle: `VAT (${num(o.vatRate)}%)`,
    vat: money(o.vatTotal),
    total: money(o.total),
  },
});

function itemShape(i) {
  return {
    id: i.id,
    listingId: i.listingId,
    name: i.name,
    photoUrl: i.photoUrl,
    categoryName: i.categoryName,
    subCategoryName: i.subCategoryName,
    unit: i.unit,
    unitLabel: i.unitLabel,
    unitPrice: num(i.unitPrice),
    unitPriceLabel: `${money(i.unitPrice)} / ${i.unitLabel || i.unit || 'unit'}`,
    quantity: num(i.quantity),
    lineTotal: num(i.lineTotal),
    lineTotalLabel: money(i.lineTotal),
    isVatApplicable: i.isVatApplicable,
    vatAmount: num(i.vatAmount),
    refundPolicy: i.refundPolicy,
    nonReturnable: i.nonReturnable,
    pickupLocation: i.pickupLocation,
  };
}

const isLate = (so) =>
  so.status === SELLER_ORDER_STATUS.PAID && so.confirmBy && new Date(so.confirmBy) < new Date();

// Next statuses the seller can choose (none while the buyer's cancellation request waits for an answer)
const sellerNextStatuses = (so) => (so.openCancelRequestId ? [] : (SELLER_TRANSITIONS[so.status] || {})[so.fulfilment] || []).map((s) => ({
  status: s,
  label: SELLER_ORDER_STATUS_LABELS[s],
}));

// view: 'buyer' | 'seller' | 'admin'
function sellerOrderShape(so, { view = 'buyer', seller = null, history = [] } = {}) {
  const base = {
    id: so.id,
    sellerOrderNumber: so.sellerOrderNumber,
    status: so.status,
    statusLabel: SELLER_ORDER_STATUS_LABELS[so.status],
    fulfilment: so.fulfilment,
    fulfilmentLabel: so.fulfilment === 'pickup' ? 'Pickup' : 'Delivery',
    seller,
    items: (so.items || []).slice().sort((a, b) => a.id - b.id).map(itemShape),
    subtotal: num(so.subtotal),
    deliveryFee: num(so.deliveryFee),
    vatTotal: num(so.vatTotal),
    total: num(so.total),
    labels: {
      subtotal: money(so.subtotal),
      deliveryFee: Number(so.deliveryFee) ? money(so.deliveryFee) : 'Free',
      vat: money(so.vatTotal),
      total: money(so.total),
    },
    buyerNote: so.buyerNote,
    dates: {
      paidAt: so.paidAt,
      confirmedAt: so.confirmedAt,
      packedAt: so.packedAt,
      dispatchedAt: so.dispatchedAt,
      readyAt: so.readyAt,
      deliveredAt: so.deliveredAt,
      completeAfter: so.completeAfter,
      completedAt: so.completedAt,
      cancelledAt: so.cancelledAt,
    },
    // Phase 4: cancellation, claim, refunds
    cancellation:
      so.status === SELLER_ORDER_STATUS.CANCELLED
        ? { reason: so.cancelReason || null, by: so.cancelledBy || null, byLabel: CANCELLED_BY_LABELS[so.cancelledBy] || null, at: so.cancelledAt }
        : null,
    hasOpenCancelRequest: Boolean(so.openCancelRequestId),
    openCancelRequestId: so.openCancelRequestId || null,
    claimStatus: so.claimStatus || 'none',
    activeClaimId: so.activeClaimId || null,
    claimWindowEndsAt: [SELLER_ORDER_STATUS.DELIVERED, SELLER_ORDER_STATUS.COLLECTED].includes(so.status) ? so.completeAfter : null,
    refundedAmount: num(so.refundedAmount || 0),
    refundedLabel: money(so.refundedAmount || 0),
    timeline: timeline(history, so.id),
  };
  if (view === 'buyer') {
    const inWindow = [SELLER_ORDER_STATUS.DELIVERED, SELLER_ORDER_STATUS.COLLECTED].includes(so.status) && so.completeAfter && new Date(so.completeAfter) > new Date();
    base.canConfirmReceived = [SELLER_ORDER_STATUS.DISPATCHED, SELLER_ORDER_STATUS.READY_FOR_PICKUP].includes(so.status);
    base.actions = {
      canConfirmReceived: base.canConfirmReceived,
      // "New Order": cancelled at once. Confirmed / Packed: a request to the seller.
      canCancel: BUYER_DIRECT_CANCEL.includes(so.status),
      canRequestCancel: BUYER_REQUEST_CANCEL.includes(so.status) && !so.openCancelRequestId,
      canWithdrawCancelRequest: Boolean(so.openCancelRequestId),
      canReportProblem: Boolean(inWindow) && (so.claimStatus || 'none') === 'none',
    };
  }
  if (view === 'seller') {
    base.actions = {
      canCancel: SELLER_CANCEL.includes(so.status),
      canAnswerCancelRequest: Boolean(so.openCancelRequestId),
    };
  }
  if (view === 'seller' || view === 'admin') {
    base.confirmBy = so.confirmBy;
    base.isLate = Boolean(isLate(so));
    base.payout = {
      status: so.payoutStatus,
      statusLabel: PAYOUT_STATUS_LABELS[so.payoutStatus],
      amount: num(so.payoutAmount),
      amountLabel: money(so.payoutAmount),
    };
    base.sellerVatRegistered = so.sellerVatRegistered;
  }
  if (view === 'seller') base.nextStatuses = sellerNextStatuses(so);
  return base;
}

function paymentShape(p, { view = 'buyer' } = {}) {
  const out = {
    id: p.id,
    method: p.method,
    methodLabel: PAYMENT_METHODS[p.method],
    status: p.status,
    statusLabel: PAYMENT_STATUS_LABELS[p.status],
    amount: num(p.amount),
    amountLabel: money(p.amount),
    amountPaid: num(p.amountPaid),
    paidOn: p.paidOn,
    bankReference: p.bankReference,
    buyerNote: p.buyerNote,
    hasReceipt: Boolean(p.receiptPath),
    rejectionReason: p.rejectionReason,
    reviewedAt: p.reviewedAt,
    createdAt: p.createdAt,
    completedAt: p.completedAt,
  };
  if (view === 'admin') {
    out.provider = p.provider;
    out.providerReference = p.providerReference;
    out.reviewedBy = p.reviewedBy;
    out.receipt = p.receiptPath
      ? { originalName: p.receiptOriginalName, mimeType: p.receiptMimeType, sizeBytes: p.receiptSizeBytes, fileUrl: `/admin/payments/${p.id}/file` }
      : null;
  }
  return out;
}

const sortedPayments = (o) => (o.payments || []).slice().sort((a, b) => b.id - a.id);

module.exports = {
  round2,
  num,
  money,
  addHours,
  addMinutes,
  recordHistory,
  timeline,
  loadOrder,
  fullIncludes,
  orderNotFound,
  totalsShape,
  itemShape,
  sellerOrderShape,
  paymentShape,
  sortedPayments,
  isLate,
  sellerNextStatuses,
  ORDER_STATUS,
  SELLER_ORDER_STATUS,
};
