// Emails for cancellations, claims and refunds (Phase 4). Called AFTER the change is saved;
// every email is sent in the background and a failure is only logged (it never fails the action).
//
//   sellerOrderCancelled   -> buyer (with the refund), seller, AFA (refund to pay)
//   cancelRequested        -> seller: the buyer asks to cancel
//   cancelRequestAnswered  -> buyer (accepted / declined / approved / rejected), seller (withdrawn)
//   cancelRequestEscalated -> AFA + buyer: the seller did not answer
//   claimEvent             -> the people concerned by a claim step (opened, accepted, message ...)
//   refundCreated          -> buyer + AFA
//   bankDetailsAdded       -> AFA: a refund is ready to pay
//   refundPaid / refundFailed -> buyer
const models = require('../models');
const emailService = require('./email.service');
const directory = require('./userDirectory');
const { money } = require('./orderShared');
const { CLAIM_REASONS, CLAIM_STATUS_LABELS, REFUND_SOURCES } = require('../config/refunds');

const { Order, SellerOrder, CancellationRequest, Claim, Refund, User, Admin } = models;

const background = (label, fn) =>
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`Refund email failed (${label}):`, err.message));

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Mbabane', dateStyle: 'medium', timeStyle: 'short' }) : '';

async function adminEmail() {
  const admin = await Admin.findOne({ attributes: ['email'], order: [['id', 'ASC']] });
  return admin ? admin.email : null;
}

// Email one user (buyer / seller)
async function toUser(userId, message) {
  const [user, dirs] = await Promise.all([User.findByPk(userId, { attributes: ['id', 'email', 'userType'] }), directory.findMany([userId])]);
  if (!user) return;
  await emailService.sendOrderEmail({
    to: user.email,
    name: dirs.get(userId) ? dirs.get(userId).display_name : '',
    userType: user.userType,
    ...message,
  });
}

async function toAdmin(message) {
  const to = await adminEmail();
  if (to) await emailService.sendOrderEmail({ to, ...message });
}

const refundLine = (refund) =>
  refund
    ? refund.bankDetails
      ? `A refund of ${money(refund.amount)} (${refund.refundNumber}) will be paid into your bank account by the AFA team.`
      : `A refund of ${money(refund.amount)} (${refund.refundNumber}) is due. Please add your bank account in the app (My Refunds) so AFA can pay it.`
    : null;

async function adminRefundAlert(refund, extra = '') {
  await toAdmin({
    subject: `Refund to pay: ${refund.refundNumber} (${money(refund.amount)})`,
    title: 'A refund is due',
    lines: [
      `${REFUND_SOURCES[refund.source]}${extra ? ` - ${extra}` : ''}.`,
      `Amount: ${money(refund.amount)}. Pay by: ${fmtDate(refund.dueBy)}.`,
      refund.bankDetails ? 'The buyer has given bank details. Pay it in the AFA admin panel: Refunds.' : 'Waiting for the buyer to add bank details.',
      ...(refund.recoverFromSeller ? ['The seller was already paid for this order: recover this amount from the seller.'] : []),
    ],
  });
}

// ---------- cancellations ----------
function sellerOrderCancelled(sellerOrderId, refundId = null) {
  return background(`cancelled ${sellerOrderId}`, async () => {
    const so = await SellerOrder.findByPk(sellerOrderId);
    if (!so) return;
    const [order, refund] = await Promise.all([Order.findByPk(so.orderId), refundId ? Refund.findByPk(refundId) : null]);
    const by = { buyer: 'at your request', seller: 'by the seller', admin: 'by the AFA team', system: 'because the seller did not confirm it in time' }[so.cancelledBy] || '';
    const sellerBy = { buyer: 'at the buyer\'s request', seller: 'by you', admin: 'by the AFA team', system: 'because it was not confirmed in time' }[so.cancelledBy] || '';

    await toUser(order.userId, {
      subject: `${so.sellerOrderNumber} cancelled`,
      title: 'Order cancelled',
      lines: [`Your order ${so.sellerOrderNumber} was cancelled ${by}.`, refundLine(refund)].filter(Boolean),
      box: so.cancelReason ? { title: 'Reason', text: so.cancelReason } : null,
    });
    await toUser(so.sellerId, {
      subject: `${so.sellerOrderNumber} cancelled`,
      title: 'Order cancelled',
      lines: [
        `Order ${so.sellerOrderNumber} was cancelled ${sellerBy}.`,
        refund ? `The buyer is refunded ${money(refund.amount)}. Your payout for this order is now ${money(so.payoutAmount)}.` : '',
        'Please do not send the goods.',
      ].filter(Boolean),
      box: so.cancelReason ? { title: 'Reason', text: so.cancelReason } : null,
    });
    if (refund) await adminRefundAlert(refund, `${so.sellerOrderNumber} cancelled`);
  });
}

function cancelRequested(requestId) {
  return background(`cancel request ${requestId}`, async () => {
    const r = await CancellationRequest.findByPk(requestId);
    if (!r) return;
    const so = await SellerOrder.findByPk(r.sellerOrderId);
    await toUser(r.sellerId, {
      subject: `Cancellation request for ${so.sellerOrderNumber}`,
      title: 'The buyer wants to cancel',
      lines: [
        `The buyer asked to cancel order ${so.sellerOrderNumber}.`,
        `Please accept or decline in your AFA account (My Sales) before ${fmtDate(r.respondBy)}. If you do not answer, the AFA team will decide.`,
        'Please do not dispatch the order until you have answered.',
      ],
      box: { title: 'Reason', text: r.reason },
    });
  });
}

function cancelRequestAnswered(requestId) {
  return background(`cancel answer ${requestId}`, async () => {
    const r = await CancellationRequest.findByPk(requestId);
    if (!r) return;
    const so = await SellerOrder.findByPk(r.sellerOrderId);
    if (r.status === 'withdrawn') {
      await toUser(r.sellerId, {
        subject: `Cancellation request withdrawn: ${so.sellerOrderNumber}`,
        title: 'Request withdrawn',
        lines: [`The buyer withdrew the cancellation request for ${so.sellerOrderNumber}. Please continue with the order.`],
      });
      return;
    }
    // accepted / approved: the cancellation email already went out
    if (r.status === 'declined' || r.status === 'rejected') {
      await toUser(r.buyerId, {
        subject: `Cancellation request for ${so.sellerOrderNumber}`,
        title: 'Your order will go ahead',
        lines: [
          `Your request to cancel ${so.sellerOrderNumber} was ${r.status === 'declined' ? 'declined by the seller' : 'not approved by the AFA team'}. The order will go ahead.`,
          'If something is wrong when you receive it, you can report a problem in the app.',
        ],
        box: r.responseNote || r.decisionNote ? { title: 'Note', text: r.status === 'declined' ? r.responseNote : r.decisionNote } : null,
      });
      if (r.status === 'rejected') {
        await toUser(r.sellerId, {
          subject: `Cancellation request for ${so.sellerOrderNumber}`,
          title: 'Please continue with the order',
          lines: [`The AFA team did not approve the buyer's request to cancel ${so.sellerOrderNumber}. Please continue with the order.`],
        });
      }
    }
  });
}

function cancelRequestEscalated(requestId) {
  return background(`cancel escalated ${requestId}`, async () => {
    const r = await CancellationRequest.findByPk(requestId);
    if (!r) return;
    const so = await SellerOrder.findByPk(r.sellerOrderId);
    await toAdmin({
      subject: `Cancellation request to decide: ${so.sellerOrderNumber}`,
      title: 'The seller did not answer a cancellation request',
      lines: [`Decide in the AFA admin panel: Orders > Cancellation Requests.`],
      box: { title: 'Buyer\'s reason', text: r.reason },
    });
    await toUser(r.buyerId, {
      subject: `Cancellation request for ${so.sellerOrderNumber}`,
      title: 'Your request is with the AFA team',
      lines: [`The seller did not answer your request to cancel ${so.sellerOrderNumber} in time, so the AFA team will decide.`],
    });
  });
}

// ---------- claims ----------
function claimEvent(claimId, event, { refundId = null, from = null } = {}) {
  return background(`claim ${claimId} ${event}`, async () => {
    const c = await Claim.findByPk(claimId);
    if (!c) return;
    const [so, refund] = await Promise.all([SellerOrder.findByPk(c.sellerOrderId), refundId ? Refund.findByPk(refundId) : null]);
    const ref = `${c.claimNumber} (${so.sellerOrderNumber})`;
    const subject = (text) => `${c.claimNumber}: ${text}`;
    const status = CLAIM_STATUS_LABELS[c.status];

    switch (event) {
      case 'opened':
        await toUser(c.sellerId, {
          subject: subject('a buyer reported a problem'),
          title: 'A buyer reported a problem',
          lines: [
            `The buyer reported "${CLAIM_REASONS[c.reason]}" for order ${so.sellerOrderNumber}. Claimed: up to ${money(c.maxRefund)}.`,
            `Please accept or reject it in your AFA account (My Sales > Claims) before ${fmtDate(c.sellerRespondBy)}. If you do not reply, the AFA team will decide.`,
            'Your payout for this order stays on hold until the claim is settled.',
          ],
          box: { title: 'What the buyer says', text: c.description },
        });
        break;
      case 'accepted':
        await toUser(c.buyerId, {
          subject: subject('accepted by the seller'),
          title: 'The seller accepted your claim',
          lines: [
            `The seller accepted your claim ${ref} with a refund of ${money(c.refundAmount)}.`,
            c.status === 'awaiting_return'
              ? 'Please send the item back to the seller, then tap "I sent it back" in the app. The refund follows when the seller receives it.'
              : refundLine(refund),
          ].filter(Boolean),
          box: c.sellerNote ? { title: 'Note from the seller', text: c.sellerNote } : null,
        });
        break;
      case 'rejected':
        await toUser(c.buyerId, {
          subject: subject('rejected by the seller'),
          title: 'The seller rejected your claim',
          lines: [
            `The seller rejected your claim ${ref}.`,
            `If you do not agree, you can send it to the AFA team in the app before ${fmtDate(c.escalateBy)}.`,
          ],
          box: { title: 'Seller\'s reason', text: c.sellerNote || '' },
        });
        break;
      case 'escalated':
        await toAdmin({
          subject: subject('to decide'),
          title: 'A claim needs your decision',
          lines: [`Claim ${ref}: "${CLAIM_REASONS[c.reason]}", up to ${money(c.maxRefund)}. Decide in the AFA admin panel: Claims.`],
          box: c.escalationNote ? { title: 'Why it came to AFA', text: c.escalationNote } : null,
        });
        await Promise.all(
          [from === 'buyer' ? null : c.buyerId, c.sellerId].filter(Boolean).map((uid) =>
            toUser(uid, {
              subject: subject('with the AFA team'),
              title: 'The AFA team will decide',
              lines: [`Claim ${ref} is now with the AFA team. Their decision is final.`],
            })
          )
        );
        break;
      case 'decided':
      case 'return_received':
        await Promise.all(
          [c.buyerId, c.sellerId].map((uid) =>
            toUser(uid, {
              subject: subject(status),
              title: `Claim ${status}`,
              lines: [
                event === 'return_received' ? `The returned item for ${ref} was received.` : `The AFA team decided on claim ${ref}.`,
                c.status === 'resolved' ? `Refund to the buyer: ${money(c.refundAmount)}.` : '',
                c.status === 'awaiting_return' ? 'The item must be sent back to the seller first. The refund follows when it is received.' : '',
                c.status === 'closed' ? 'No refund will be paid.' : '',
                uid === c.buyerId && refund ? refundLine(refund) : '',
              ].filter(Boolean),
              box: event === 'decided' && c.decisionNote ? { title: 'Note from AFA', text: c.decisionNote } : null,
            })
          )
        );
        break;
      case 'returned':
        await toUser(c.sellerId, {
          subject: subject('item sent back'),
          title: 'The buyer sent the item back',
          lines: [`Please confirm in your AFA account when you receive it, before ${fmtDate(c.sellerRespondBy)}. The buyer is then refunded ${money(c.refundAmount)}.`],
          box: c.returnNote ? { title: 'Note from the buyer', text: c.returnNote } : null,
        });
        break;
      case 'withdrawn':
        await toUser(c.sellerId, {
          subject: subject('withdrawn'),
          title: 'Claim withdrawn',
          lines: [`The buyer withdrew claim ${ref}. No refund is due.`],
        });
        break;
      case 'closed':
        await toUser(c.buyerId, {
          subject: subject('closed'),
          title: 'Claim closed',
          lines: [`Claim ${ref} was closed without a refund.`],
          box: c.closeReason ? { title: 'Reason', text: c.closeReason } : null,
        });
        break;
      case 'message': {
        // To the other side(s)
        const targets = from === 'buyer' ? [c.sellerId] : from === 'seller' ? [c.buyerId] : [c.buyerId, c.sellerId];
        await Promise.all(
          targets.map((uid) =>
            toUser(uid, {
              subject: subject('new message'),
              title: 'New message on a claim',
              lines: [`There is a new message from the ${from === 'admin' ? 'AFA team' : from} on claim ${ref}. Open it in the app to read and reply.`],
            })
          )
        );
        if (from !== 'admin' && c.status === 'escalated') {
          await toAdmin({ subject: subject('new message'), title: 'New message on a claim', lines: [`New message from the ${from} on claim ${ref}.`] });
        }
        break;
      }
      default:
        break;
    }
    if (refund) await adminRefundAlert(refund, `claim ${c.claimNumber}`);
  });
}

// ---------- refunds ----------
function refundCreated(refundId) {
  return background(`refund ${refundId}`, async () => {
    const refund = await Refund.findByPk(refundId);
    if (!refund) return;
    const order = await Order.findByPk(refund.orderId);
    await toUser(refund.buyerId, {
      subject: `Refund ${refund.refundNumber} for ${order.orderNumber}`,
      title: 'A refund is on the way',
      lines: [refundLine(refund)],
      box: refund.reason ? { title: 'Reason', text: refund.reason } : null,
    });
    await adminRefundAlert(refund, order.orderNumber);
  });
}

function bankDetailsAdded(refundId) {
  return background(`refund details ${refundId}`, async () => {
    const refund = await Refund.findByPk(refundId);
    if (!refund || refund.status !== 'pending') return;
    await toAdmin({
      subject: `Refund ready to pay: ${refund.refundNumber}`,
      title: 'Bank details added',
      lines: [`The buyer added bank details for refund ${refund.refundNumber} (${money(refund.amount)}). Pay it in the AFA admin panel: Refunds.`],
    });
  });
}

function refundPaid(refundId) {
  return background(`refund paid ${refundId}`, async () => {
    const refund = await Refund.findByPk(refundId);
    if (!refund) return;
    await toUser(refund.buyerId, {
      subject: `Refund ${refund.refundNumber} paid`,
      title: 'Your refund has been paid',
      lines: [
        `AFA paid your refund of ${money(refund.amount)} into your bank account on ${refund.paidOn}.`,
        `Bank reference: ${refund.bankReference}. It can take 1-3 working days to show in your account.`,
      ],
    });
  });
}

function refundFailed(refundId) {
  return background(`refund failed ${refundId}`, async () => {
    const refund = await Refund.findByPk(refundId);
    if (!refund) return;
    await toUser(refund.buyerId, {
      subject: `Refund ${refund.refundNumber}: please check your bank details`,
      title: 'We could not pay your refund',
      lines: [`We could not pay your refund of ${money(refund.amount)}. Please check and update your bank details in the app (My Refunds).`],
      box: refund.failedReason ? { title: 'Reason', text: refund.failedReason } : null,
    });
  });
}

module.exports = {
  sellerOrderCancelled,
  cancelRequested,
  cancelRequestAnswered,
  cancelRequestEscalated,
  claimEvent,
  refundCreated,
  bankDetailsAdded,
  refundPaid,
  refundFailed,
};
