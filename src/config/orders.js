// Orders & payments (Phase 3).
const { SERVICE_STATUS_LABELS, BOOKING_RULES } = require('./bookings');

// ---------- Checkout (orders) status ----------
const ORDER_STATUS = {
  AWAITING_PAYMENT: 'awaiting_payment',
  UNDER_REVIEW: 'under_review', // bank transfer proof sent, admin checking it
  PAID: 'paid',
  CANCELLED: 'cancelled',
};
const ORDER_STATUS_LABELS = {
  awaiting_payment: 'Awaiting Payment',
  under_review: 'Payment Under Review',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

// ---------- Seller order status ----------
const SELLER_ORDER_STATUS = {
  AWAITING_PAYMENT: 'awaiting_payment',
  PAID: 'paid', // "New order" for the seller
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress', // bookings only: the provider started the service
  PACKED: 'packed', // "Packed / Harvested"
  DISPATCHED: 'dispatched', // delivery only
  READY_FOR_PICKUP: 'ready_for_pickup', // pickup only
  DELIVERED: 'delivered',
  COLLECTED: 'collected',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
const SELLER_ORDER_STATUS_LABELS = {
  awaiting_payment: 'Awaiting Payment',
  paid: 'New Order',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  packed: 'Packed / Harvested',
  dispatched: 'Dispatched',
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Delivered',
  collected: 'Collected',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// What the SELLER may move an order to: { from: { delivery: [to], pickup: [to], service: [to] } }
// Bookings (fulfilment "service"): New Booking -> Confirmed -> In Progress -> Service Done ("delivered")
const SELLER_TRANSITIONS = {
  paid: { delivery: ['confirmed'], pickup: ['confirmed'], service: ['confirmed'] },
  confirmed: { delivery: ['packed'], pickup: ['packed'], service: ['in_progress'] },
  in_progress: { service: ['delivered'] },
  packed: { delivery: ['dispatched'], pickup: ['ready_for_pickup'] },
  dispatched: { delivery: ['delivered'], pickup: [] },
  ready_for_pickup: { delivery: [], pickup: ['collected'] },
};

// Time stamp column set when an order reaches a status
const STATUS_TIME_FIELD = {
  paid: 'paidAt',
  confirmed: 'confirmedAt',
  in_progress: 'startedAt',
  packed: 'packedAt',
  dispatched: 'dispatchedAt',
  ready_for_pickup: 'readyAt',
  delivered: 'deliveredAt',
  collected: 'deliveredAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};

// Claim window after delivery / collection, per refund policy (hours). The longest item wins.
// After it ends the order is Completed and the seller payout is released.
const CLAIM_WINDOW_HOURS = {
  farm_produce: 24,
  farming_products: 7 * 24,
  leasing: 0,
  services: 0,
  booking: BOOKING_RULES.claimWindowHours, // service bookings: after "Service Done"
};

// How the seller order is fulfilled
const FULFILMENT_LABELS = { pickup: 'Pickup', delivery: 'Delivery', service: 'Service Booking' };

// Status label for a seller order: bookings have their own words ("New Booking", "Service Done")
function statusLabelFor(so) {
  if (so && so.fulfilment === 'service') {
    return SERVICE_STATUS_LABELS[so.status] || SELLER_ORDER_STATUS_LABELS[so.status] || so.status;
  }
  return SELLER_ORDER_STATUS_LABELS[so.status] || so.status;
}

// Checkout kind: products from the cart, or one service booking
const ORDER_KINDS = { product: 'Products', booking: 'Service Booking' };

const PAYMENT_METHODS = { bank_transfer: 'Bank Transfer (EFT)', online: 'Online Payment' };

const PAYMENT_STATUS_LABELS = {
  pending: 'Pending',
  under_review: 'Under Review',
  succeeded: 'Successful',
  failed: 'Failed',
  rejected: 'Rejected',
  expired: 'Expired',
};

const PAYOUT_STATUS_LABELS = { not_due: 'Not Due', held: 'Held', released: 'Released', cancelled: 'Cancelled' };

// Proof of payment upload (private file)
const PAYMENT_PROOF = { formats: ['jpg', 'png', 'pdf'], maxSizeMB: 5, folder: 'payments' };

// When a bank payment is rejected close to the deadline, the buyer gets at least this long to try again
const MIN_RETRY_HOURS_AFTER_REJECT = 24;

// AFA-ORD-000123 and AFA-ORD-000123-1
const orderNumber = (id) => `AFA-ORD-${String(id).padStart(6, '0')}`;
const sellerOrderNumber = (orderNo, index) => `${orderNo}-${index}`;

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  SELLER_ORDER_STATUS,
  SELLER_ORDER_STATUS_LABELS,
  SELLER_TRANSITIONS,
  STATUS_TIME_FIELD,
  CLAIM_WINDOW_HOURS,
  FULFILMENT_LABELS,
  ORDER_KINDS,
  statusLabelFor,
  PAYMENT_METHODS,
  PAYMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  PAYMENT_PROOF,
  MIN_RETRY_HOURS_AFTER_REJECT,
  orderNumber,
  sellerOrderNumber,
};
