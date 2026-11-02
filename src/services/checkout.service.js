// Checkout: turns the buyer's cart into an order (POST /me/orders).
//
//   - Approved buyers only (checked in the route). The cart must be ready (cart.canCheckout).
//   - One ORDER for the whole checkout (one payment), one SELLER ORDER per seller group.
//   - Prices, VAT, delivery fees and the address are COPIED into the order.
//   - Stock goes down NOW (listing rows are locked so two buyers can't buy the same last kg).
//   - Payment method: bank_transfer (pay into AFA's account + upload proof) or online (gateway).
//     Unpaid by the deadline -> cancelled by the background job, stock goes back.
//   - Idempotency-Key header: the same key returns the same order (double click / retry safe).
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const cartService = require('./cart.service');
const { getGateway } = require('../payments/gateways');
const { round2, num, addHours, addMinutes, recordHistory } = require('./orderShared');
const { PAYMENT_METHODS, orderNumber, sellerOrderNumber } = require('../config/orders');
const { LISTING_STATUS } = require('../config/listingOptions');
const { DEFAULT_REFUND_POLICY_BY_SELLER } = require('../config/categories');
const { VAT_STATUS } = require('../config/vat');

const { sequelize, Order, SellerOrder, OrderItem, CartItem, Listing, Category, User } = models;

// ---------- payment methods ----------
function bankDetails(s) {
  return {
    bankName: s.afa_bank_name,
    accountName: s.afa_bank_account_name,
    accountNumber: s.afa_bank_account_number,
    branchCode: s.afa_bank_branch_code || null,
    swiftCode: s.afa_bank_swift_code || null,
  };
}

// GET /me/orders/payment-methods  (also used to check the method at checkout)
async function paymentOptions() {
  const s = await settings.getAll();
  const bankReady = Boolean(s.afa_bank_name && s.afa_bank_account_name && s.afa_bank_account_number);
  const active = getGateway();
  const gateway = active && (typeof active.isReady !== 'function' || active.isReady()) ? active : null;
  return {
    methods: [
      {
        method: 'bank_transfer',
        label: PAYMENT_METHODS.bank_transfer,
        available: bankReady,
        description: 'Pay into the AFA bank account, then upload your proof of payment. The AFA team confirms it.',
        timeLimitHours: s.bank_transfer_time_limit_hours,
      },
      {
        method: 'online',
        label: PAYMENT_METHODS.online,
        available: Boolean(gateway),
        description: 'Pay now with the secure online payment page.',
        timeLimitMinutes: s.payment_time_limit_minutes,
        testMode: Boolean(gateway && gateway.name === 'test'),
        provider: gateway ? gateway.name : null,
        // Options to choose for online payment (ePayNet: MoMo, eMali, card ...). Empty = no choice needed
        channels: gateway && typeof gateway.channels === 'function' ? gateway.channels() : [],
      },
    ],
    bankDetails: bankReady ? bankDetails(s) : null,
  };
}

async function assertMethodAvailable(method) {
  const { methods } = await paymentOptions();
  const m = methods.find((x) => x.method === method);
  if (!m || !m.available) {
    throw new ApiError(422, `${PAYMENT_METHODS[method] || method} is not available right now`, {
      code: 'PAYMENT_METHOD_UNAVAILABLE',
      errors: [{ field: 'paymentMethod', message: 'Choose another payment method' }],
    });
  }
}

// Deadline for a method, counted from "from" (the time the order was placed)
async function deadlineFor(method, from) {
  const s = await settings.getAll();
  return method === 'bank_transfer'
    ? addHours(from, s.bank_transfer_time_limit_hours)
    : addMinutes(from, s.payment_time_limit_minutes);
}

// ---------- checks right before placing ----------
function cartProblems(cart) {
  const errors = [];
  cart.groups.forEach((g) => {
    g.issues.filter((x) => x.blocking).forEach((x) => errors.push({ field: `seller ${g.seller.id}`, message: x.message }));
    g.items.forEach((i) =>
      i.issues
        .filter((x) => x.blocking)
        .forEach((x) => errors.push({ field: `cartItem ${i.id}`, message: `${i.listing ? i.listing.name : 'Item'}: ${x.message}` }))
    );
  });
  return errors;
}

// ---------- POST /me/orders ----------
//   data: { addressId?, paymentMethod, sellerNotes?: [{ sellerId, note }], acceptTerms: true,
//           expectedTotal? (the Total shown to the buyer; refused with TOTAL_CHANGED if it differs) }
// Returns { orderId, created } (created = false when the Idempotency-Key was used before)
async function placeOrder(user, data, { idempotencyKey = null } = {}) {
  await assertMethodAvailable(data.paymentMethod);
  const notes = new Map((data.sellerNotes || []).map((n) => [n.sellerId, n.note]));

  return sequelize.transaction(async (transaction) => {
    // One checkout at a time per buyer
    await User.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE });

    if (idempotencyKey) {
      const existing = await Order.findOne({ where: { userId: user.id, idempotencyKey }, transaction });
      if (existing) return { orderId: existing.id, created: false };
    }

    const cart = await cartService.getCart(user, { addressId: data.addressId }, { transaction });
    if (!cart.groups.length) {
      throw new ApiError(409, 'Your cart is empty', { code: 'CART_EMPTY' });
    }
    if (!cart.canCheckout) {
      throw new ApiError(409, 'Please fix the items in your cart before placing the order', {
        code: 'CART_NOT_READY',
        errors: cartProblems(cart),
      });
    }

    // The total the buyer saw on screen must still be right (price / fee / VAT changed meanwhile)
    if (data.expectedTotal !== undefined && round2(data.expectedTotal) !== round2(cart.summary.total)) {
      throw new ApiError(409, `The order total changed to ${cart.summary.labels.total}. Please check your cart again.`, {
        code: 'TOTAL_CHANGED',
        errors: [{ field: 'expectedTotal', message: `New total: ${cart.summary.labels.total}` }],
      });
    }

    // Lock the listings, then check stock and price again (another buyer may have just bought)
    const lines = cart.groups.flatMap((g) => g.items.map((item) => ({ group: g, item })));
    const listingIds = lines.map((l) => l.item.listing.id);
    const locked = await Listing.findAll({
      where: { id: listingIds },
      attributes: ['id', 'quantity', 'price', 'status', 'vatHold'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const byId = new Map(locked.map((l) => [l.id, l]));
    const changed = [];
    lines.forEach(({ item }) => {
      const l = byId.get(item.listing.id);
      const name = item.listing.name;
      if (!l || l.status !== LISTING_STATUS.ACTIVE || l.vatHold) changed.push({ field: `cartItem ${item.id}`, message: `${name} is no longer available` });
      else if (num(l.price) !== item.price) changed.push({ field: `cartItem ${item.id}`, message: `${name}: the price has just changed` });
      else if (l.quantity !== null && num(l.quantity) < item.quantity) {
        changed.push({ field: `cartItem ${item.id}`, message: `${name}: only ${num(l.quantity)} ${item.listing.priceUnitLabel || ''} left` });
      }
    });
    if (changed.length) {
      throw new ApiError(409, 'Some items changed while you were checking out. Please review your cart.', {
        code: 'CART_CHANGED',
        errors: changed,
      });
    }

    // Stock goes down now
    for (const { item } of lines) {
      const l = byId.get(item.listing.id);
      if (l.quantity !== null) {
        // eslint-disable-next-line no-await-in-loop
        await l.update({ quantity: round2(num(l.quantity) - item.quantity) }, { transaction });
      }
    }

    // Refund policy (main category, else by seller type) and seller VAT status
    const categoryIds = [...new Set(lines.map((l) => l.item.listing.category && l.item.listing.category.id).filter(Boolean))];
    const sellerIds = cart.groups.map((g) => g.seller.id);
    const [categories, sellers] = await Promise.all([
      Category.findAll({ where: { id: categoryIds }, attributes: ['id', 'refundPolicy'], transaction }),
      User.findAll({ where: { id: sellerIds }, attributes: ['id', 'userType', 'vatStatus'], transaction }),
    ]);
    const policyOf = new Map(categories.map((c) => [c.id, c.refundPolicy]));
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    // The order
    const now = new Date();
    const needsAddress = cart.groups.some((g) => g.fulfilment === 'delivery');
    const order = await Order.create(
      {
        userId: user.id,
        paymentMethod: data.paymentMethod,
        paymentDeadline: await deadlineFor(data.paymentMethod, now),
        deliveryAddress: needsAddress ? cart.address : null,
        subtotal: cart.summary.subtotal,
        deliveryTotal: cart.summary.deliveryTotal,
        vatTotal: cart.summary.vatTotal,
        total: cart.summary.total,
        vatRate: cart.summary.vatRate,
        idempotencyKey,
        termsAcceptedAt: now,
      },
      { transaction }
    );
    const number = orderNumber(order.id);
    await order.update({ orderNumber: number }, { transaction });

    // One seller order per group
    for (const [index, g] of cart.groups.entries()) {
      const seller = sellerById.get(g.seller.id);
      const itemsVat = round2(g.items.reduce((s, i) => s + i.vatAmount, 0));
      // eslint-disable-next-line no-await-in-loop
      const so = await SellerOrder.create(
        {
          orderId: order.id,
          sellerId: g.seller.id,
          sellerOrderNumber: sellerOrderNumber(number, index + 1),
          fulfilment: g.fulfilment,
          subtotal: g.subtotal,
          deliveryFee: g.deliveryFee,
          deliveryVat: round2(g.vat - itemsVat),
          vatTotal: g.vat,
          total: g.total,
          payoutAmount: g.total,
          buyerNote: notes.get(g.seller.id) || null,
          sellerVatRegistered: Boolean(seller && seller.vatStatus === VAT_STATUS.APPROVED),
        },
        { transaction }
      );
      // eslint-disable-next-line no-await-in-loop
      await OrderItem.bulkCreate(
        g.items.map((i) => ({
          orderId: order.id,
          sellerOrderId: so.id,
          listingId: i.listing.id,
          name: i.listing.name,
          photoUrl: i.listing.coverPhotoUrl,
          categoryName: i.listing.category ? i.listing.category.name : null,
          subCategoryName: i.listing.subCategory ? i.listing.subCategory.name : null,
          unit: i.listing.priceUnit,
          unitLabel: i.listing.priceUnitLabel,
          unitPrice: i.price,
          quantity: i.quantity,
          lineTotal: i.lineTotal,
          isVatApplicable: i.listing.isVatApplicable,
          vatAmount: i.vatAmount,
          refundPolicy:
            (i.listing.category && policyOf.get(i.listing.category.id)) ||
            (seller ? DEFAULT_REFUND_POLICY_BY_SELLER[seller.userType] : null) ||
            null,
          nonReturnable: Boolean(i.listing.nonReturnable),
          pickupLocation: g.fulfilment === 'pickup' ? i.listing.pickupLocation : null,
        })),
        { transaction }
      );
    }

    await recordHistory(
      { orderId: order.id, to: 'placed', actor: { type: 'buyer', id: user.id }, note: `Payment method: ${PAYMENT_METHODS[data.paymentMethod]}` },
      transaction
    );

    // Ordered items leave the cart (soft delete). Saved-for-later items stay.
    await CartItem.destroy({ where: { userId: user.id, id: lines.map((l) => l.item.id) }, transaction });

    return { orderId: order.id, created: true };
  });
}

module.exports = { paymentOptions, assertMethodAvailable, deadlineFor, bankDetails, placeOrder };
