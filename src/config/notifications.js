// Notifications: in-app (the bell) + push (Firebase Cloud Messaging). Nothing can be switched off.
// Emails stay as they are; every event that sends an email also creates a notification.

// Categories (filter tabs in the bell)
const CATEGORIES = {
  orders: 'Orders',
  payments: 'Payments',
  refunds: 'Cancellations, Claims & Refunds',
  listings: 'My Listings',
  account: 'Account',
  advisories: 'Advisories',
  announcements: 'Announcements',
  admin: 'Admin Tasks', // admin bell only
};

// Every notification type -> its category. The app routes with data.screen + the ids in data.
const TYPES = {
  // account
  'account.approved': 'account',
  'account.rejected': 'account',
  'account.suspended': 'account',
  'account.reactivated': 'account',
  'account.password_changed': 'account',
  'vat.approved': 'account',
  'vat.rejected': 'account',
  'vat.removed': 'account',
  'vat.review_again': 'account',
  'vat.listings_changed': 'listings',
  // listings
  'listing.status': 'listings',
  // orders
  'order.placed': 'orders',
  'order.cancelled': 'orders',
  'order.status': 'orders',
  'order.new': 'orders', // seller: new paid order
  'order.received': 'orders', // seller: buyer confirmed receipt
  // payments
  'payment.received': 'payments',
  'payment.rejected': 'payments',
  'payment.failed': 'payments',
  // cancellations, claims, refunds
  'cancel.order_cancelled': 'refunds',
  'cancel.request': 'refunds',
  'cancel.request_answered': 'refunds',
  'cancel.request_escalated': 'refunds',
  'claim.update': 'refunds',
  'claim.message': 'refunds',
  'refund.created': 'refunds',
  'refund.paid': 'refunds',
  'refund.failed': 'refunds',
  // admin broadcasts
  'broadcast.advisory': 'advisories',
  'broadcast.announcement': 'announcements',
  // admin bell
  'admin.registration': 'admin',
  'admin.listing_review': 'admin',
  'admin.payment_proof': 'admin',
  'admin.vat_request': 'admin',
  'admin.contact': 'admin',
  'admin.cancel_request': 'admin',
  'admin.claim': 'admin',
  'admin.refund': 'admin',
};

const PLATFORMS = ['android', 'ios', 'web'];

// Admin advisories / announcements
const BROADCAST_CATEGORIES = { advisory: 'Advisory', announcement: 'Announcement' };
const BROADCAST_STATUS = { SCHEDULED: 'scheduled', SENDING: 'sending', SENT: 'sent', CANCELLED: 'cancelled' };
const BROADCAST_STATUS_LABELS = { scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', cancelled: 'Cancelled' };
// Who can receive a broadcast: users who can log in
const BROADCAST_USER_STATUSES = ['approved', 'pending_approval'];
const BROADCAST_MAX_DAYS_AHEAD = 90;

// push_status of a notification
const PUSH_STATUS = { PENDING: 'pending', SENT: 'sent', FAILED: 'failed', NO_DEVICE: 'no_device', OFF: 'off' };

module.exports = {
  CATEGORIES,
  TYPES,
  PLATFORMS,
  BROADCAST_CATEGORIES,
  BROADCAST_STATUS,
  BROADCAST_STATUS_LABELS,
  BROADCAST_USER_STATUSES,
  BROADCAST_MAX_DAYS_AHEAD,
  PUSH_STATUS,
};
