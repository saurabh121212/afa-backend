// Phase 4: cancelling paid orders, claims (problems after delivery) and refunds.
//
// AFA holds the buyer's money until the claim window ends, so a refund is always paid by AFA
// BEFORE the seller is paid; the seller's payout goes down by the refunded amount.
// For now every refund is paid manually by the AFA admin (bank transfer).

// ---------- cancelling a paid seller order ----------
// The buyer can cancel at once while the seller has not confirmed ("New Order").
// After that and before dispatch / ready for pickup, the buyer sends a REQUEST.
const BUYER_DIRECT_CANCEL = ['paid'];
const BUYER_REQUEST_CANCEL = ['confirmed', 'packed'];
// The seller can cancel any time before dispatch / ready for pickup
const SELLER_CANCEL = ['paid', 'confirmed', 'packed'];
// The admin can cancel any seller order that is not finished yet
const ADMIN_CANCEL = ['paid', 'confirmed', 'in_progress', 'packed', 'dispatched', 'ready_for_pickup', 'delivered', 'collected'];
// Bookings: the buyer cancels at once until 24 hours before the start, then sends a request
// (see buyerCancelMode in config/bookings.js). The provider can cancel before the service starts.
// Stock goes back to the listing only when the goods never left the seller
const RESTOCK_STATUSES = ['paid', 'confirmed', 'packed'];

const CANCEL_REQUEST_STATUS = {
  PENDING: 'pending', // waiting for the seller
  ACCEPTED: 'accepted', // seller accepted -> cancelled + refund
  DECLINED: 'declined', // seller said no -> the order goes on
  ESCALATED: 'escalated', // seller did not answer in time -> admin decides
  APPROVED: 'approved', // admin approved -> cancelled + refund
  REJECTED: 'rejected', // admin said no -> the order goes on
  WITHDRAWN: 'withdrawn', // buyer took the request back
  CLOSED: 'closed', // the order was cancelled another way meanwhile
};
const CANCEL_REQUEST_STATUS_LABELS = {
  pending: 'Waiting for the Seller',
  accepted: 'Accepted by the Seller',
  declined: 'Declined by the Seller',
  escalated: 'With the AFA Team',
  approved: 'Approved by AFA',
  rejected: 'Rejected by AFA',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};
const OPEN_CANCEL_REQUEST = ['pending', 'escalated'];

const CANCELLED_BY_LABELS = { buyer: 'Buyer', seller: 'Seller', admin: 'AFA', system: 'System' };

// ---------- claims ----------
const CLAIM_REASONS = {
  damaged: 'Damaged',
  wrong_item: 'Wrong Item',
  missing_items: 'Missing Items',
  poor_quality: 'Poor Quality',
  not_received: 'Not Received',
};
// Items marked "non-returnable" can only be claimed for these reasons
const NON_RETURNABLE_REASONS = ['wrong_item', 'missing_items', 'not_received'];
// A photo is required for these reasons
const PHOTO_REQUIRED_REASONS = ['damaged', 'wrong_item', 'poor_quality'];
// No physical return for these refund policies (perishable): refund on the photos
// Service bookings: nothing to send back either
const NO_RETURN_POLICIES = ['farm_produce', 'booking'];

const CLAIM_STATUS = {
  OPEN: 'open', // waiting for the seller's reply
  REJECTED: 'rejected', // seller rejected: the buyer can escalate in time
  ESCALATED: 'escalated', // the admin decides (final)
  AWAITING_RETURN: 'awaiting_return', // refund agreed, waiting for the item to come back
  RESOLVED: 'resolved', // refund given
  CLOSED: 'closed', // no refund (withdrawn, rejected by AFA, not escalated in time)
};
const CLAIM_STATUS_LABELS = {
  open: 'Waiting for the Seller',
  rejected: 'Rejected by the Seller',
  escalated: 'With the AFA Team',
  awaiting_return: 'Waiting for the Return',
  resolved: 'Resolved (Refund)',
  closed: 'Closed',
};
const ACTIVE_CLAIM = ['open', 'rejected', 'escalated', 'awaiting_return'];
// When a return is needed, the buyer has this long to send the item back (else the claim is closed)
const RETURN_WINDOW_HOURS = 7 * 24;

// Photos in claims (private files): JPG / PNG, up to 5 per message, 5MB each
const CLAIM_PHOTOS = { formats: ['jpg', 'png'], maxFiles: 5, maxSizeMB: 5, folder: 'claims' };

// ---------- refunds ----------
const REFUND_STATUS = { PENDING: 'pending', PAID: 'paid', FAILED: 'failed' };
const REFUND_STATUS_LABELS = { pending: 'Pending', paid: 'Refunded', failed: 'Failed' };
const REFUND_SOURCES = {
  buyer_cancel: 'Cancelled by the buyer',
  seller_cancel: 'Cancelled by the seller',
  system_cancel: 'Seller did not confirm in time',
  cancel_request: 'Cancellation request',
  admin_cancel: 'Cancelled by AFA',
  admin_refund: 'Refund by AFA',
  claim: 'Claim',
  paid_after_cancel: 'Payment received after cancellation',
};
// Admin's proof of the refund transfer (private): JPG, PNG or PDF, 5MB
const REFUND_PROOF = { formats: ['jpg', 'png', 'pdf'], maxSizeMB: 5, folder: 'refunds' };

// AFA-CLM-000001, AFA-REF-000001
const claimNumber = (id) => `AFA-CLM-${String(id).padStart(6, '0')}`;
const refundNumber = (id) => `AFA-REF-${String(id).padStart(6, '0')}`;

module.exports = {
  BUYER_DIRECT_CANCEL,
  BUYER_REQUEST_CANCEL,
  SELLER_CANCEL,
  ADMIN_CANCEL,
  RESTOCK_STATUSES,
  CANCEL_REQUEST_STATUS,
  CANCEL_REQUEST_STATUS_LABELS,
  OPEN_CANCEL_REQUEST,
  CANCELLED_BY_LABELS,
  CLAIM_REASONS,
  NON_RETURNABLE_REASONS,
  PHOTO_REQUIRED_REASONS,
  NO_RETURN_POLICIES,
  CLAIM_STATUS,
  CLAIM_STATUS_LABELS,
  ACTIVE_CLAIM,
  RETURN_WINDOW_HOURS,
  CLAIM_PHOTOS,
  REFUND_STATUS,
  REFUND_STATUS_LABELS,
  REFUND_SOURCES,
  REFUND_PROOF,
  claimNumber,
  refundNumber,
};
