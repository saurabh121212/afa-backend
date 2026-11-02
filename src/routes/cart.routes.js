// BUYER cart, mounted at /api/v1/me/cart. Buyer login required (other user types get 403).
// Buyers waiting for account approval can use the cart; placing the order needs approval.
//
//   GET    /me/cart?addressId=                       whole cart: seller groups, issues, Order Summary
//                                                   (addressId = which saved address; default = Default address)
//   GET    /me/cart/count                            number for the cart icon
//   POST   /me/cart/items                            { listingId, quantity } add (adds to the quantity if already there)
//   PATCH  /me/cart/items/:id                        { quantity } change (also accepts a changed price)
//   PATCH  /me/cart/items/:id/save-for-later         { saved: true | false }
//   DELETE /me/cart/items/:id                        remove (soft delete)
//   DELETE /me/cart                                  empty the cart (saved-for-later items are kept)
//   PATCH  /me/cart/sellers/:sellerId                { fulfilment: "pickup" | "delivery" } per seller group
//
// Every change returns the whole cart (same as GET). Quantities are in the listing's price unit.
const express = require('express');
const controller = require('../controllers/cart.controller');
const rules = require('../validators/cart.validator');
const validate = require('../middlewares/validate');
const { protectUser, requireUserType } = require('../middlewares/userAuth');

const router = express.Router();
router.use(protectUser, requireUserType('buyer'));

router.get('/', rules.getCart, validate, controller.getCart);
router.get('/count', controller.count);
router.post('/items', rules.addItem, validate, controller.addItem);
router.patch('/items/:id', rules.updateItem, validate, controller.updateItem);
router.patch('/items/:id/save-for-later', rules.saveForLater, validate, controller.saveForLater);
router.delete('/items/:id', rules.removeItem, validate, controller.removeItem);
router.delete('/', controller.clear);
router.patch('/sellers/:sellerId', rules.setFulfilment, validate, controller.setFulfilment);

module.exports = router;
