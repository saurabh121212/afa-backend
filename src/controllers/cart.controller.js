// Buyer cart. Input is already validated (req.validated).
// Every change returns the whole cart again, so the screen can simply re-draw it.
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/cart.service');

const opts = (req) => ({ addressId: req.validated.addressId });

const getCart = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getCart(req.user, opts(req)) });
});

const count = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.count(req.user) });
});

const addItem = asyncHandler(async (req, res) => {
  const data = await service.addItem(req.user, req.validated);
  res.status(201).json({ success: true, message: 'Added to your cart', data });
});

const updateItem = asyncHandler(async (req, res) => {
  const data = await service.updateItem(req.user, req.validated.id, req.validated, opts(req));
  res.json({ success: true, message: 'Cart updated', data });
});

const saveForLater = asyncHandler(async (req, res) => {
  const data = await service.saveForLater(req.user, req.validated.id, req.validated, opts(req));
  res.json({ success: true, message: req.validated.saved ? 'Saved for later' : 'Moved back to your cart', data });
});

const removeItem = asyncHandler(async (req, res) => {
  const data = await service.removeItem(req.user, req.validated.id, opts(req));
  res.json({ success: true, message: 'Removed from your cart', data });
});

const clear = asyncHandler(async (req, res) => {
  const data = await service.clear(req.user);
  res.json({ success: true, message: 'Your cart is empty', data });
});

const setFulfilment = asyncHandler(async (req, res) => {
  const data = await service.setFulfilment(req.user, req.validated.sellerId, req.validated, opts(req));
  res.json({ success: true, message: `${req.validated.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'} selected`, data });
});

module.exports = { getCart, count, addItem, updateItem, saveForLater, removeItem, clear, setFulfilment };
