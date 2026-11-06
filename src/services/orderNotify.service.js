// Order & payment emails. Called AFTER the change is saved; every email is sent in the
// background and a failure is only logged (it never fails the action).
//
//   orderPlaced              -> buyer: order placed + how to pay (bank details / online)
//   proofUploaded            -> admin: a bank transfer proof to check
//   orderPaid                -> buyer: payment received (+ receipt PDF); each seller: new order (+ invoice PDF)
//   paymentRejected          -> buyer: proof rejected + reason + new deadline
//   onlinePaymentFailed      -> buyer: online payment failed, try again
//   paidAfterCancel          -> admin: money received for a cancelled order (refund needed)
//   orderCancelled           -> buyer: order cancelled (not paid in time / by the buyer)
//   sellerOrderStatusChanged -> buyer: status update; seller: when the buyer confirmed receipt
// Each of these also creates an in-app notification + push (admin ones: every admin's bell).
const models = require('../models');
const emailService = require('./email.service');
const directory = require('./userDirectory');
const settings = require('./setting.service');
const invoices = require('./invoice.service');
const notify = require('./notification.service'); // in-app + push for every email below
const { num, money, itemShape } = require('./orderShared');
const { ORDER_STATUS, SELLER_ORDER_STATUS_LABELS } = require('../config/orders');

const { Order, SellerOrder, OrderItem, OrderStatusHistory, Payment, User, Admin, Invoice } = models;

// PDF of a stored document as an email attachment ([] when missing or on error: the email still goes)
async function attach(where) {
  try {
    const doc = await Invoice.findOne({ where });
    return doc ? [await invoices.pdfFor(doc)] : [];
  } catch (err) {
    console.error('Invoice PDF for email failed:', err.message);
    return [];
  }
}

const background = (label, fn) =>
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`Order email failed (${label}):`, err.message));

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Mbabane', dateStyle: 'medium', timeStyle: 'short' }) : '';

async function loadForEmail(orderId) {
  const order = await Order.findByPk(orderId, {
    include: [{ model: SellerOrder, as: 'sellerOrders', include: [{ model: OrderItem, as: 'items' }] }],
  });
  if (!order) return null;
  const buyer = await User.findByPk(order.userId, { attributes: ['id', 'email', 'userType'] });
  const dirs = await directory.findMany([order.userId, ...order.sellerOrders.map((so) => so.sellerId)]);
  return { order, buyer, dirs };
}

const itemsOf = (sellerOrders) => sellerOrders.flatMap((so) => (so.items || []).map(itemShape));
const orderTotals = (o) => [
  ['Subtotal', money(o.subtotal)],
  ['Delivery', Number(o.deliveryTotal) ? money(o.deliveryTotal) : 'Free'],
  [`VAT (${num(o.vatRate)}%)`, money(o.vatTotal)],
  ['Total', money(o.total)],
];

async function adminEmail() {
  const admin = await Admin.findOne({ attributes: ['email'], order: [['id', 'ASC']] });
  return admin ? admin.email : null;
}

async function bankBox(order) {
  const s = await settings.getAll();
  return {
    title: 'Pay by bank transfer',
    text: [
      `Bank: ${s.afa_bank_name}`,
      `Account holder: ${s.afa_bank_account_name}`,
      `Account number: ${s.afa_bank_account_number}`,
      s.afa_bank_branch_code ? `Branch code: ${s.afa_bank_branch_code}` : '',
      `Reference: ${order.orderNumber}`,
      `Amount: ${money(order.total)}`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

// ---------- buyer ----------
function orderPlaced(orderId) {
  return background(`placed ${orderId}`, async () => {
    const data = await loadForEmail(orderId);
    if (!data) return;
    const { order, buyer, dirs } = data;
    const isBank = order.paymentMethod === 'bank_transfer';
    await notify.toUser(order.userId, {
      type: 'order.placed',
      title: `Order ${order.orderNumber} placed`,
      body: `${isBank ? 'Pay by bank transfer and upload your proof' : 'Complete the online payment'} of ${money(order.total)} before ${fmtDate(order.paymentDeadline)}.`,
      data: { screen: 'order', orderId: order.id },
    });
    await emailService.sendOrderEmail({
      to: buyer.email,
      name: dirs.get(order.userId) ? dirs.get(order.userId).display_name : '',
      userType: buyer.userType,
      subject: `Order ${order.orderNumber} placed`,
      title: 'Thank you for your order',
      lines: [
        `Your order ${order.orderNumber} has been placed.`,
        isBank
          ? `Please pay by bank transfer and upload your proof of payment before ${fmtDate(order.paymentDeadline)}, or the order will be cancelled.`
          : `Please complete the online payment before ${fmtDate(order.paymentDeadline)}, or the order will be cancelled.`,
      ],
      box: isBank ? await bankBox(order) : null,
      items: itemsOf(order.sellerOrders),
      totals: orderTotals(order),
    });
  });
}

function orderPaid(orderId) {
  return background(`paid ${orderId}`, async () => {
    const data = await loadForEmail(orderId);
    if (!data) return;
    const { order, buyer, dirs } = data;
    await notify.toUser(order.userId, {
      type: 'payment.received',
      title: `Payment received: ${money(order.total)}`,
      body: `${order.orderNumber} is paid. The seller(s) will now prepare your order. Your receipt is ready.`,
      data: { screen: 'order', orderId: order.id },
    });
    await emailService.sendOrderEmail({
      to: buyer.email,
      name: dirs.get(order.userId) ? dirs.get(order.userId).display_name : '',
      userType: buyer.userType,
      subject: `Payment received for ${order.orderNumber}`,
      title: 'Payment received',
      lines: [
        `We have received your payment of ${money(order.total)}. The seller(s) will now prepare your order.`,
        'Your receipt is attached. Each seller\'s invoice is in the app (My Orders > order details).',
      ],
      items: itemsOf(order.sellerOrders),
      totals: orderTotals(order),
      attachments: await attach({ orderId: order.id, type: 'receipt' }),
    });

    // Each seller: their part of the order
    const sellers = await User.findAll({ where: { id: order.sellerOrders.map((so) => so.sellerId) }, attributes: ['id', 'email', 'userType'] });
    const sellerById = new Map(sellers.map((s) => [s.id, s]));
    const buyerName = dirs.get(order.userId) ? dirs.get(order.userId).display_name : 'A buyer';
    await Promise.all(
      order.sellerOrders.map((so) => {
        const seller = sellerById.get(so.sellerId);
        if (!seller) return null;
        const items = (so.items || []).map(itemShape);
        notify.toUser(so.sellerId, {
          type: 'order.new',
          title: `New order ${so.sellerOrderNumber}: ${money(so.total)}`,
          body: `${buyerName} ordered (${so.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}). Confirm it before ${fmtDate(so.confirmBy)}.`,
          data: { screen: 'sale', sellerOrderId: so.id, orderId: order.id },
        });
        return background(`new order seller ${so.sellerId}`, async () =>
          emailService.sendOrderEmail({
            to: seller.email,
            name: dirs.get(so.sellerId) ? dirs.get(so.sellerId).display_name : '',
            userType: seller.userType,
            subject: `New order ${so.sellerOrderNumber}`,
            title: 'You have a new paid order',
            lines: [
              `${buyerName} ordered from you (${so.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}). The payment is received and held by AFA.`,
              `Please confirm the order before ${fmtDate(so.confirmBy)} in your AFA account (My Sales).`,
              'The invoice issued in your name is attached.',
            ],
            box: so.buyerNote ? { title: 'Note from the buyer', text: so.buyerNote } : null,
            items,
            totals: [
              ['Subtotal', money(so.subtotal)],
              ['Delivery', Number(so.deliveryFee) ? money(so.deliveryFee) : 'Free'],
              ['VAT', money(so.vatTotal)],
              ['Total', money(so.total)],
            ],
            attachments: await attach({ sellerOrderId: so.id, type: 'invoice' }),
          })
        );
      })
    );
  });
}

function paymentRejected(orderId, paymentId) {
  return background(`rejected ${orderId}`, async () => {
    const data = await loadForEmail(orderId);
    const payment = await Payment.findByPk(paymentId);
    if (!data || !payment) return;
    const { order, buyer, dirs } = data;
    await notify.toUser(order.userId, {
      type: 'payment.rejected',
      title: `Payment not confirmed: ${order.orderNumber}`,
      body: `${payment.rejectionReason || 'Your proof of payment was not accepted.'} Upload a new proof before ${fmtDate(order.paymentDeadline)}.`,
      data: { screen: 'order', orderId: order.id },
    });
    await emailService.sendOrderEmail({
      to: buyer.email,
      name: dirs.get(order.userId) ? dirs.get(order.userId).display_name : '',
      userType: buyer.userType,
      subject: `Payment not confirmed for ${order.orderNumber}`,
      title: 'We could not confirm your payment',
      lines: [
        `The proof of payment you uploaded for ${order.orderNumber} was not accepted.`,
        `Please upload a new proof of payment before ${fmtDate(order.paymentDeadline)}, or the order will be cancelled.`,
      ],
      box: { title: 'Reason', text: payment.rejectionReason || '' },
    });
  });
}

function onlinePaymentFailed(orderId) {
  return background(`online failed ${orderId}`, async () => {
    const data = await loadForEmail(orderId);
    if (!data || data.order.status !== ORDER_STATUS.AWAITING_PAYMENT) return;
    const { order, buyer, dirs } = data;
    await notify.toUser(order.userId, {
      type: 'payment.failed',
      title: `Payment failed: ${order.orderNumber}`,
      body: `No money was taken. Try again or pay by bank transfer before ${fmtDate(order.paymentDeadline)}.`,
      data: { screen: 'order', orderId: order.id },
    });
    await emailService.sendOrderEmail({
      to: buyer.email,
      name: dirs.get(order.userId) ? dirs.get(order.userId).display_name : '',
      userType: buyer.userType,
      subject: `Payment failed for ${order.orderNumber}`,
      title: 'Your online payment did not go through',
      lines: [
        `The online payment for ${order.orderNumber} failed. No money was taken.`,
        `You can try again, or switch to bank transfer, before ${fmtDate(order.paymentDeadline)}.`,
      ],
    });
  });
}

function orderCancelled(orderId) {
  return background(`cancelled ${orderId}`, async () => {
    const data = await loadForEmail(orderId);
    if (!data) return;
    const { order, buyer, dirs } = data;
    await notify.toUser(order.userId, {
      type: 'order.cancelled',
      title: `Order ${order.orderNumber} cancelled`,
      body: order.cancelledBy === 'system' ? 'It was not paid in time. No money was taken.' : 'Your order has been cancelled.',
      data: { screen: 'order', orderId: order.id },
    });
    await emailService.sendOrderEmail({
      to: buyer.email,
      name: dirs.get(order.userId) ? dirs.get(order.userId).display_name : '',
      userType: buyer.userType,
      subject: `Order ${order.orderNumber} cancelled`,
      title: 'Order cancelled',
      lines: [
        order.cancelledBy === 'system'
          ? `Your order ${order.orderNumber} was cancelled because it was not paid in time. No money was taken.`
          : `Your order ${order.orderNumber} has been cancelled.`,
        'You can place the order again from the marketplace.',
      ],
      items: itemsOf(order.sellerOrders),
    });
  });
}

// ---------- admin ----------
function proofUploaded(orderId, paymentId) {
  return background(`proof ${orderId}`, async () => {
    const [to, order, payment] = await Promise.all([adminEmail(), Order.findByPk(orderId), Payment.findByPk(paymentId)]);
    if (!order || !payment) return;
    await notify.toAdmins({
      type: 'admin.payment_proof',
      title: `Bank transfer to check: ${order.orderNumber}`,
      body: `Proof for ${money(payment.amountPaid)} (order total ${money(order.total)})${payment.bankReference ? `, ref ${payment.bankReference}` : ''}.`,
      data: { screen: 'admin_payment', paymentId: payment.id, orderId: order.id },
    });
    if (!to) return;
    const dir = (await directory.findMany([order.userId])).get(order.userId);
    await emailService.sendOrderEmail({
      to,
      subject: `Bank transfer to check: ${order.orderNumber}`,
      title: 'Proof of payment uploaded',
      lines: [
        `${dir ? dir.display_name : 'A buyer'} uploaded a proof of payment for ${order.orderNumber}.`,
        `Order total: ${money(order.total)}. Amount on the proof: ${money(payment.amountPaid)}${payment.bankReference ? `, bank reference ${payment.bankReference}` : ''}.`,
        'Check it in the AFA admin panel: Payments.',
      ],
    });
  });
}

function paidAfterCancel(orderId) {
  return background(`paid after cancel ${orderId}`, async () => {
    const [to, order] = await Promise.all([adminEmail(), Order.findByPk(orderId)]);
    if (!to || !order) return;
    await emailService.sendOrderEmail({
      to,
      subject: `Refund needed: payment received for cancelled order ${order.orderNumber}`,
      title: 'Payment received after cancellation',
      lines: [`An online payment of ${money(order.total)} arrived after ${order.orderNumber} was cancelled. Please refund the buyer.`],
    });
  });
}

// ---------- status updates ----------
function sellerOrderStatusChanged(sellerOrderId) {
  return background(`status ${sellerOrderId}`, async () => {
    const so = await SellerOrder.findByPk(sellerOrderId, { include: [{ model: Order, as: 'order' }] });
    if (!so) return;
    const last = await OrderStatusHistory.findOne({ where: { sellerOrderId }, order: [['id', 'DESC']] });
    const byBuyer = last && last.actorType === 'buyer';
    const toUserId = byBuyer ? so.sellerId : so.order.userId;
    const [user, dirs] = await Promise.all([User.findByPk(toUserId, { attributes: ['id', 'email', 'userType'] }), directory.findMany([toUserId])]);
    if (!user) return;
    const label = SELLER_ORDER_STATUS_LABELS[so.status];
    await notify.toUser(
      toUserId,
      byBuyer
        ? {
            type: 'order.received',
            title: `${so.sellerOrderNumber}: received by the buyer`,
            body: 'The buyer confirmed they received the order.',
            data: { screen: 'sale', sellerOrderId: so.id, orderId: so.orderId },
          }
        : {
            type: 'order.status',
            title: `${so.sellerOrderNumber}: ${label}`,
            body:
              so.status === 'ready_for_pickup'
                ? 'Your order is ready. Collect it from the pickup location shown in your order.'
                : so.status === 'delivered' || so.status === 'collected'
                  ? 'If something is wrong, report it in the app before the claim window ends.'
                  : (last && last.note) || `Your order is now "${label}".`,
            data: { screen: 'order', orderId: so.orderId, sellerOrderId: so.id },
          }
    );
    await emailService.sendOrderEmail({
      to: user.email,
      name: dirs.get(toUserId) ? dirs.get(toUserId).display_name : '',
      userType: user.userType,
      subject: `${so.sellerOrderNumber}: ${label}`,
      title: `Order ${label}`,
      lines: byBuyer
        ? [`The buyer confirmed they received order ${so.sellerOrderNumber}.`]
        : [
            `Your order ${so.sellerOrderNumber} is now "${label}".`,
            ...(so.status === 'ready_for_pickup' ? ['You can collect it from the pickup location shown in your order.'] : []),
            ...(so.status === 'delivered' || so.status === 'collected'
              ? ['If something is wrong with your order, report it in the app before the claim window ends.']
              : []),
          ],
      box: last && last.note && !byBuyer ? { title: 'Note from the seller', text: last.note } : null,
    });
  });
}

module.exports = {
  orderPlaced,
  orderPaid,
  paymentRejected,
  onlinePaymentFailed,
  orderCancelled,
  proofUploaded,
  paidAfterCancel,
  sellerOrderStatusChanged,
};
