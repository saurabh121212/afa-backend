// Cart rules (Phase 2). Quantities are always in the listing's PRICE unit.
const CART = {
  maxItems: 50, // items in the cart (saved-for-later included)
  maxQuantity: 1000000000,
};

const FULFILMENT = { pickup: 'Pickup', delivery: 'Delivery' };

// Problems shown on a cart item (the cart never changes an item by itself)
const CART_ISSUES = {
  not_available: 'This item is no longer available',
  out_of_stock: 'Not enough stock',
  below_minimum: 'Below the minimum order quantity',
  price_changed: 'The price has changed since you added it',
  unit_mismatch: 'The seller must fix this listing before it can be ordered',
  pickup_not_available: 'Pickup is not available for this item',
  no_delivery_to_region: 'The seller does not deliver this item to your region',
};

module.exports = { CART, FULFILMENT, CART_ISSUES };
