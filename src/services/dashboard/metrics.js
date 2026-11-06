// Shared numbers used by several dashboards (seller performance, sales).
//
// Definitions (the same everywhere):
//   sales (gross)   = total of seller orders PAID in the period, cancelled ones left out
//   refunded        = what was refunded on those seller orders (claims, AFA refunds)
//   net sales       = sales - refunded
//   orders          = number of those seller orders
//   on-time confirm = confirmed within the time limit / (confirmed + auto-cancelled for no confirmation)
//   cancellation    = cancelled by the seller or by the system (not confirmed) / paid seller orders
//   claim rate      = seller orders with a claim / delivered or collected (or later) seller orders
const { round2, num } = require('../orderShared');

const DELIVERED_OR_LATER = ['delivered', 'collected', 'completed'];

// Seller orders paid in [from, to] (any status), from a list already loaded
const paidIn = (sos, from, to) => sos.filter((so) => so.paidAt && new Date(so.paidAt) >= from && new Date(so.paidAt) <= to);

function salesOf(sos) {
  const live = sos.filter((so) => so.status !== 'cancelled');
  const gross = round2(live.reduce((s, so) => s + num(so.total), 0));
  const refunded = round2(live.reduce((s, so) => s + num(so.refundedAmount || 0), 0));
  return { gross, refunded, net: round2(gross - refunded), orders: live.length, avgOrder: live.length ? round2(gross / live.length) : 0 };
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

// Performance of a set of seller orders (one seller, or all of a seller's in a period)
function performance(sos) {
  const confirmed = sos.filter((so) => so.confirmedAt);
  const onTime = confirmed.filter((so) => !so.confirmBy || new Date(so.confirmedAt) <= new Date(so.confirmBy));
  const autoCancelled = sos.filter((so) => so.status === 'cancelled' && so.cancelledBy === 'system');
  const sellerCancelled = sos.filter((so) => so.status === 'cancelled' && so.cancelledBy === 'seller');
  const delivered = sos.filter((so) => DELIVERED_OR_LATER.includes(so.status) || (so.status === 'cancelled' && so.deliveredAt));
  const withClaim = delivered.filter((so) => so.claimStatus && so.claimStatus !== 'none');
  const confirmHours = confirmed
    .filter((so) => so.paidAt)
    .map((so) => (new Date(so.confirmedAt) - new Date(so.paidAt)) / 3600000);
  return {
    orders: sos.length,
    onTimeConfirmRate: pct(onTime.length, confirmed.length + autoCancelled.length),
    avgConfirmHours: confirmHours.length ? Math.round((confirmHours.reduce((s, h) => s + h, 0) / confirmHours.length) * 10) / 10 : null,
    cancelledBySeller: sellerCancelled.length,
    autoCancelled: autoCancelled.length,
    cancellationRate: pct(sellerCancelled.length + autoCancelled.length, sos.length),
    delivered: delivered.length,
    claims: withClaim.length,
    claimRate: pct(withClaim.length, delivered.length),
  };
}

const groupBy = (list, keyOf) => {
  const map = new Map();
  list.forEach((x) => {
    const k = keyOf(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  });
  return map;
};

const countBy = (list, keyOf) => {
  const out = {};
  list.forEach((x) => {
    const k = keyOf(x);
    out[k] = (out[k] || 0) + 1;
  });
  return out;
};

module.exports = { DELIVERED_OR_LATER, paidIn, salesOf, performance, pct, groupBy, countBy };
