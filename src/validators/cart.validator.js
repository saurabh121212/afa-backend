// Validation for the buyer cart (/me/cart).
const { body, param, query } = require('express-validator');
const { CART, FULFILMENT } = require('../config/cart');

const FULFILMENTS = Object.keys(FULFILMENT);

const idParam = param('id').isInt({ min: 1 }).withMessage('Cart item id must be a positive number').toInt();
const addressQuery = query('addressId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('addressId must be a positive number').toInt();

// Quantity in the listing's price unit, up to 2 decimals (e.g. 12.5 kg)
const quantityField = body('quantity')
  .exists({ values: 'null' })
  .withMessage('quantity is required')
  .bail()
  .isFloat({ gt: 0, max: CART.maxQuantity })
  .withMessage('quantity must be more than 0')
  .bail()
  .custom((v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim()))
  .withMessage('quantity can have at most 2 decimal places')
  .bail()
  .toFloat();

// GET /me/cart
const getCart = [addressQuery];

// POST /me/cart/items
const addItem = [
  body('listingId').exists({ values: 'falsy' }).withMessage('listingId is required').bail().isInt({ min: 1 }).withMessage('listingId must be a positive number').toInt(),
  quantityField,
];

// PATCH /me/cart/items/:id
const updateItem = [idParam, addressQuery, quantityField];

// PATCH /me/cart/items/:id/save-for-later
const saveForLater = [
  idParam,
  addressQuery,
  body('saved')
    .exists({ values: 'null' })
    .withMessage('saved is required')
    .bail()
    .isBoolean({ strict: false })
    .withMessage('saved must be true or false')
    .toBoolean(true),
];

// DELETE /me/cart/items/:id
const removeItem = [idParam, addressQuery];

// PATCH /me/cart/sellers/:sellerId
const setFulfilment = [
  param('sellerId').isInt({ min: 1 }).withMessage('Seller id must be a positive number').toInt(),
  addressQuery,
  body('fulfilment')
    .trim()
    .notEmpty()
    .withMessage('fulfilment is required')
    .bail()
    .toLowerCase()
    .isIn(FULFILMENTS)
    .withMessage(`fulfilment must be one of: ${FULFILMENTS.join(', ')}`),
];

module.exports = { getCart, addItem, updateItem, saveForLater, removeItem, setFulfilment };
