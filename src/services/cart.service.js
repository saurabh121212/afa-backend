// BUYER cart (/me/cart). Buyers only; saved on the server (same cart on web and phone).
//
// Rules (Phase 2, agreed):
//   - Only live PRODUCT listings: active, not on VAT hold, seller approved, category active.
//   - quantity is in the listing's PRICE unit (stock and minimum order use the same unit).
//   - Items are grouped by seller. Each group has ONE choice: pickup (free) or delivery.
//     Delivery fee = the HIGHEST fee among the group's items for the buyer's region (one trip).
//     Listings where the buyer arranges transport count as pickup.
//   - Nothing in the cart is changed silently: problems are shown as "issues" on the item.
//   - VAT (System Settings rate) on VAT-applicable items; on the delivery fee too when the
//     "VAT on delivery fee" setting is on and the seller is VAT-registered.
//     Prices are entered WITHOUT VAT; VAT is added in the summary.
//   - Saved-for-later items are kept but are not in the order summary.
const models = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const settings = require('./setting.service');
const addressService = require('./address.service');
const { baseShape, listingInclude, sellerDelivers, listingIsVat } = require('./listing.service');
const { sellerShape } = require('./marketplace.service');
const { USER_STATUS } = require('../utils/constants');
const { LISTING_STATUS, CURRENCY } = require('../config/listingOptions');
const { CART, FULFILMENT, CART_ISSUES } = require('../config/cart');
const { VAT_STATUS } = require('../config/vat');

const { sequelize, CartItem, CartSellerOption, Listing, User, Address } = models;

// Problems that stop checkout (price_changed is only a warning)
const BLOCKING = ['not_available', 'out_of_stock', 'below_minimum', 'unit_mismatch', 'pickup_not_available', 'no_delivery_to_region'];

// ---------- money ----------
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n) =>
  `${CURRENCY.symbol} ${round2(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => (v === null || v === undefined ? null : Number(v));

// ---------- listing checks ----------

// Same rules as the public marketplace
function isVisible(l) {
  return Boolean(
    l &&
      !l.deletedAt &&
      l.kind === 'product' &&
      l.status === LISTING_STATUS.ACTIVE &&
      !l.vatHold &&
      l.category &&
      l.category.isActive &&
      (!l.subCategory || l.subCategory.isActive) &&
      l.seller &&
      l.seller.status === USER_STATUS.APPROVED
  );
}

const unitsMatch = (l) =>
  (!l.quantityUnit || l.quantityUnit === l.priceUnit) && (!l.minOrderUnit || l.minOrderUnit === l.priceUnit);

// Pickup is possible unless the seller ONLY delivers (buyer-arranged transport = pickup)
const canPickup = (l) => !sellerDelivers(l) || l.deliveryType === 'both';

// Seller's delivery fee to a region, or null when they don't deliver there
function deliveryFeeTo(l, regionId) {
  if (!regionId || !sellerDelivers(l)) return null;
  const row = (l.deliveryFees || []).find((d) => Number(d.regionId) === Number(regionId));
  return row ? Number(row.fee) : null;
}

// Quantity problems (used when adding / changing, and shown in the cart)
function quantityIssues(l, quantity) {
  const issues = [];
  const stock = num(l.quantity);
  const min = num(l.minOrderQuantity);
  if (stock !== null && quantity > stock) issues.push('out_of_stock');
  if (min !== null && quantity < min) issues.push('below_minimum');
  return issues;
}

function quantityError(l, quantity) {
  const errors = [];
  const unit = l.priceUnit || '';
  quantityIssues(l, quantity).forEach((code) => {
    if (code === 'out_of_stock') errors.push({ field: 'quantity', message: `Only ${num(l.quantity)} ${unit} available` });
    if (code === 'below_minimum') errors.push({ field: 'quantity', message: `Minimum order is ${num(l.minOrderQuantity)} ${unit}` });
  });
  if (errors.length) throw new ApiError(422, errors[0].message, { code: 'VALIDATION_ERROR', errors });
}

// ---------- loading ----------
const listingWithSeller = () => ({
  model: Listing,
  as: 'listing',
  paranoid: false, // a listing the seller deleted still shows (as "not available")
  include: [...listingInclude(), { model: User, as: 'seller', attributes: ['id', 'status', 'userType', 'vatStatus'] }],
});

const loadItems = (userId, transaction) =>
  CartItem.findAll({
    where: { userId },
    include: [listingWithSeller()],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    transaction,
  });

async function loadVisibleListing(listingId, transaction) {
  const listing = await Listing.findByPk(listingId, {
    include: [...listingInclude(), { model: User, as: 'seller', attributes: ['id', 'status', 'userType', 'vatStatus'] }],
    transaction,
  });
  if (!isVisible(listing)) {
    throw new ApiError(404, 'This item is not available on the marketplace', { code: 'LISTING_NOT_AVAILABLE' });
  }
  if (!unitsMatch(listing)) {
    throw new ApiError(409, 'This listing cannot be ordered until the seller fixes its units', { code: 'LISTING_UNIT_MISMATCH' });
  }
  return listing;
}

// The address used for delivery fees: the one asked for, else the buyer's Default address
async function pickAddress(user, addressId) {
  if (addressId) return addressService.getOne(user, addressId); // 404 if not the buyer's
  const def = await Address.findOne({ where: { userId: user.id, isDefault: true }, attributes: ['id'] });
  return def ? addressService.getOne(user, def.id) : null;
}

// ---------- shapes ----------
function listingCard(l) {
  const b = baseShape(l);
  return {
    id: b.id,
    name: b.name,
    coverPhotoUrl: b.coverPhotoUrl,
    category: b.category,
    subCategory: b.subCategory,
    price: b.price,
    priceUnit: b.priceUnit,
    priceUnitLabel: b.priceUnitLabel,
    priceLabel: b.priceLabel,
    stock: b.quantity,
    minOrderQuantity: b.minOrderQuantity,
    availability: b.availability,
    availabilityLabel: b.availabilityLabel,
    availableFrom: b.availableFrom, // pre-order: "Available from <date>"
    isVatApplicable: b.isVatApplicable,
    nonReturnable: b.nonReturnable,
    pickupAvailable: canPickup(l),
    pickupLocation: b.location, // where the buyer collects it
    deliveryFees: b.deliveryFees,
  };
}

const issueList = (codes) => codes.map((code) => ({ code, message: CART_ISSUES[code], blocking: BLOCKING.includes(code) }));

// ---------- GET /me/cart ----------
async function getCart(user, { addressId } = {}, { transaction } = {}) {
  const [rows, address, options, vatRate, vatOnDelivery] = await Promise.all([
    loadItems(user.id, transaction),
    pickAddress(user, addressId),
    CartSellerOption.findAll({ where: { userId: user.id }, transaction }),
    settings.get('vat_rate'),
    settings.get('vat_on_delivery_fee'),
  ]);
  const regionId = address && address.region ? address.region.id : null;
  const choiceBySeller = new Map(options.map((o) => [o.sellerId, o.fulfilment]));

  // 1. Every item with its own checks
  const items = rows.map((row) => {
    const l = row.listing;
    const quantity = num(row.quantity);
    const available = isVisible(l);
    const issues = [];
    if (!available) issues.push('not_available');
    else {
      if (!unitsMatch(l)) issues.push('unit_mismatch');
      issues.push(...quantityIssues(l, quantity));
      if (row.priceAtAdd !== null && num(row.priceAtAdd) !== num(l.price)) issues.push('price_changed');
    }
    const price = available ? num(l.price) : null;
    const lineTotal = price === null ? 0 : round2(price * quantity);
    const isVat = available && listingIsVat(l.category, l.subCategory);
    return {
      row,
      listing: l,
      available,
      sellerId: l ? l.userId : null,
      out: {
        id: row.id,
        quantity,
        savedForLater: row.savedForLater,
        priceAtAdd: num(row.priceAtAdd),
        price,
        lineTotal,
        lineTotalLabel: money(lineTotal),
        vatAmount: isVat ? round2((lineTotal * vatRate) / 100) : 0,
        listing: l ? listingCard(l) : null,
        issues: [], // filled in below (fulfilment issues need the group)
        _codes: issues,
      },
    };
  });

  // 2. Seller groups (items in the cart, not saved for later)
  const active = items.filter((i) => !i.out.savedForLater);
  const sellerIds = [...new Set(active.map((i) => i.sellerId).filter(Boolean))];
  const dirs = await directory.findMany(sellerIds);

  const groups = sellerIds.map((sellerId) => {
    const groupItems = active.filter((i) => i.sellerId === sellerId);
    const live = groupItems.filter((i) => i.available);
    const seller = live.length ? live[0].listing.seller : groupItems[0].listing && groupItems[0].listing.seller;

    const pickupPossible = live.length > 0 && live.every((i) => canPickup(i.listing));
    const fees = live.map((i) => deliveryFeeTo(i.listing, regionId));
    const deliveryPossible = live.length > 0 && fees.every((f) => f !== null);
    const saved = choiceBySeller.get(sellerId);
    const fulfilment = saved || (deliveryPossible ? 'delivery' : 'pickup');

    // Items that can't follow the group's choice
    live.forEach((i, idx) => {
      if (fulfilment === 'pickup' && !canPickup(i.listing)) i.out._codes.push('pickup_not_available');
      if (fulfilment === 'delivery' && fees[idx] === null) i.out._codes.push('no_delivery_to_region');
    });

    const counted = groupItems.filter((i) => i.available);
    const subtotal = round2(counted.reduce((s, i) => s + i.out.lineTotal, 0));
    const itemsVat = round2(counted.reduce((s, i) => s + i.out.vatAmount, 0));
    const deliverable = fees.filter((f) => f !== null);
    const deliveryFee = fulfilment === 'delivery' && deliverable.length ? Math.max(...deliverable) : 0;
    const deliveryVat =
      deliveryFee > 0 && vatOnDelivery && seller && seller.vatStatus === VAT_STATUS.APPROVED
        ? round2((deliveryFee * vatRate) / 100)
        : 0;
    const vat = round2(itemsVat + deliveryVat);

    groupItems.forEach((i) => {
      i.out.issues = issueList(i.out._codes);
    });
    const groupIssues = [];
    if (fulfilment === 'delivery' && !address) {
      groupIssues.push({ code: 'address_required', message: 'Add a delivery address to see the delivery fee', blocking: true });
    }

    return {
      seller: sellerShape(sellerId, dirs.get(sellerId)),
      fulfilment,
      fulfilmentLabel: FULFILMENT[fulfilment],
      fulfilmentChosenByBuyer: Boolean(saved),
      options: {
        pickup: { available: pickupPossible, fee: 0, feeLabel: 'Free' },
        delivery: {
          available: deliveryPossible,
          fee: deliveryPossible ? Math.max(...fees) : null,
          feeLabel: deliveryPossible ? (Math.max(...fees) === 0 ? 'Free delivery' : money(Math.max(...fees))) : null,
          region: address ? address.region : null,
        },
      },
      items: groupItems.map((i) => i.out),
      issues: groupIssues,
      subtotal,
      deliveryFee,
      vat,
      total: round2(subtotal + deliveryFee + vat),
      labels: { subtotal: money(subtotal), deliveryFee: deliveryFee ? money(deliveryFee) : 'Free', vat: money(vat), total: money(subtotal + deliveryFee + vat) },
    };
  });

  items.forEach((i) => {
    if (i.out.savedForLater) i.out.issues = issueList(i.out._codes);
    delete i.out._codes; // internal only
  });

  // 3. Order Summary
  const sum = (key) => round2(groups.reduce((s, g) => s + g[key], 0));
  const subtotal = sum('subtotal');
  const deliveryTotal = sum('deliveryFee');
  const vatTotal = sum('vat');
  const total = round2(subtotal + deliveryTotal + vatTotal);
  const blockingCount =
    groups.reduce((n, g) => n + g.issues.length + g.items.filter((i) => i.issues.some((x) => x.blocking)).length, 0);

  return {
    address,
    groups,
    savedForLater: items.filter((i) => i.out.savedForLater).map((i) => i.out),
    summary: {
      itemsCount: active.length,
      subtotal,
      deliveryTotal,
      vatRate,
      vatTotal,
      total,
      currency: CURRENCY.code,
      labels: {
        subtotal: money(subtotal),
        delivery: deliveryTotal ? money(deliveryTotal) : 'Free',
        vat: `${money(vatTotal)}`,
        vatTitle: `VAT (${vatRate}%)`,
        total: money(total),
      },
    },
    canCheckout: active.length > 0 && blockingCount === 0,
    problems: blockingCount, // items / groups to fix before checkout
  };
}

// ---------- GET /me/cart/count ----------
async function count(user) {
  const items = await CartItem.count({ where: { userId: user.id, savedForLater: false } });
  return { items };
}

// ---------- POST /me/cart/items  { listingId, quantity } ----------
// Adding a listing already in the cart adds to its quantity (and takes it out of "saved for later").
async function addItem(user, { listingId, quantity }) {
  await sequelize.transaction(async (transaction) => {
    const listing = await loadVisibleListing(listingId, transaction);
    const existing = await CartItem.findOne({
      where: { userId: user.id, listingId },
      paranoid: false,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const isActive = existing && !existing.deletedAt;

    if (!isActive) {
      const inCart = await CartItem.count({ where: { userId: user.id }, transaction });
      if (inCart >= CART.maxItems) {
        throw new ApiError(409, `Your cart can have at most ${CART.maxItems} items`, { code: 'CART_FULL' });
      }
    }
    const newQty = round2((isActive ? num(existing.quantity) : 0) + quantity);
    quantityError(listing, newQty);

    const values = { quantity: newQty, savedForLater: false, priceAtAdd: listing.price };
    if (existing) {
      if (existing.deletedAt) await existing.restore({ transaction });
      await existing.update(values, { transaction });
    } else {
      await CartItem.create({ userId: user.id, listingId, ...values }, { transaction });
    }
  });
  return getCart(user);
}

async function findOwnItem(user, id, transaction) {
  const item = await CartItem.findOne({ where: { id, userId: user.id }, include: [listingWithSeller()], transaction });
  if (!item) throw new ApiError(404, 'Cart item not found', { code: 'CART_ITEM_NOT_FOUND' });
  return item;
}

// ---------- PATCH /me/cart/items/:id  { quantity } ----------
// Also "accepts" a changed price (the price shown when added is updated).
async function updateItem(user, id, { quantity }, { addressId } = {}) {
  await sequelize.transaction(async (transaction) => {
    const item = await findOwnItem(user, id, transaction);
    if (!isVisible(item.listing)) {
      throw new ApiError(409, 'This item is no longer available. Remove it from your cart.', { code: 'LISTING_NOT_AVAILABLE' });
    }
    quantityError(item.listing, quantity);
    await item.update({ quantity, priceAtAdd: item.listing.price }, { transaction });
  });
  return getCart(user, { addressId });
}

// ---------- PATCH /me/cart/items/:id/save-for-later  { saved } ----------
async function saveForLater(user, id, { saved }, { addressId } = {}) {
  const item = await findOwnItem(user, id);
  await item.update({ savedForLater: saved });
  return getCart(user, { addressId });
}

// ---------- DELETE /me/cart/items/:id ----------
async function removeItem(user, id, { addressId } = {}) {
  const item = await findOwnItem(user, id);
  await item.destroy(); // soft delete
  return getCart(user, { addressId });
}

// ---------- DELETE /me/cart ----------  (saved-for-later items are kept)
async function clear(user) {
  const removed = await CartItem.destroy({ where: { userId: user.id, savedForLater: false } });
  return { removed };
}

// ---------- PATCH /me/cart/sellers/:sellerId  { fulfilment } ----------
async function setFulfilment(user, sellerId, { fulfilment }, { addressId } = {}) {
  const has = await CartItem.count({
    where: { userId: user.id, savedForLater: false },
    include: [{ model: Listing, as: 'listing', attributes: [], where: { userId: sellerId }, required: true, paranoid: false }],
  });
  if (!has) throw new ApiError(404, 'No items from this seller in your cart', { code: 'SELLER_NOT_IN_CART' });

  const existing = await CartSellerOption.findOne({ where: { userId: user.id, sellerId } });
  if (existing) await existing.update({ fulfilment });
  else await CartSellerOption.create({ userId: user.id, sellerId, fulfilment });
  return getCart(user, { addressId });
}

module.exports = {
  getCart,
  count,
  addItem,
  updateItem,
  saveForLater,
  removeItem,
  clear,
  setFulfilment,
  // shared with checkout (Phase 3)
  isVisible,
  canPickup,
  deliveryFeeTo,
  round2,
  money,
  BLOCKING,
};
